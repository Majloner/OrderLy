import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PASSWORD, seedTwoCompanies, type SeedResult } from "../helpers/fixtures";
import { signInAs } from "../helpers/clients";
import { runMiddleware, sessionCookieFromClient } from "../helpers/middleware";

// Regression for a swallowed error (m3l5 debugging exercise): the middleware
// destructured only `data` from the profiles lookup and ignored `error`, so a
// TRANSIENT infrastructure failure (PostgREST timeout, network blip) read as
// "no profile" and took the deactivation branch — a GLOBAL signOut revoking
// every session the user has, behind a misleading "account inactive" redirect.
// Contract pinned here: a failed lookup is a 5xx and never touches the session.
//
// Own file on purpose: the vi.mock below wraps @/lib/supabase for this module
// registry only, so the main middleware matrix keeps the real client.

let failProfiles = false;

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  const createClient: typeof actual.createClient = (headers, cookies) => {
    const client = actual.createClient(headers, cookies);
    if (!client) {
      return client;
    }
    const realFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (failProfiles && table === "profiles") {
        // Minimal chain the middleware walks: .select().eq().maybeSingle().
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: { message: "transient lookup failure (test)" } }),
            }),
          }),
        } as unknown as ReturnType<typeof realFrom>;
      }
      return realFrom(table);
    }) as typeof client.from;
    return client;
  };
  return { ...actual, createClient };
});

let seed: SeedResult;

beforeAll(async () => {
  seed = await seedTwoCompanies();
});

afterAll(async () => {
  await seed.cleanup();
});

// Fresh sign-in per test: on the pre-fix code the deactivation branch revokes
// the user's sessions globally, so a reused seeded session would poison the
// following tests (same pitfall as documented in middleware.test.ts).
async function freshOwnerCookie(): Promise<string> {
  const email = seed.companyA.owner.user?.email;
  if (!email) {
    throw new Error("owner email missing from seed");
  }
  const client = await signInAs({ email, password: PASSWORD });
  return sessionCookieFromClient(client);
}

describe("profiles lookup failure is an infra error, not a deactivated account", () => {
  it("answers a page request with 500 and neither redirects nor clears the session", async () => {
    const cookie = await freshOwnerCookie();
    failProfiles = true;
    try {
      const { response, cookies, nextCalled } = await runMiddleware("/dashboard", { cookie });
      expect(response.status).toBe(500);
      expect(response.headers.get("Location")).toBeNull();
      expect(nextCalled).toBe(false);
      // The deactivation branch clears the auth cookies through ctx.cookies —
      // a failed lookup must leave them untouched.
      expect(Array.from(cookies.headers())).toHaveLength(0);
    } finally {
      failProfiles = false;
    }
  });

  it("answers an API request with JSON 500, not the 401 deactivation shape", async () => {
    const cookie = await freshOwnerCookie();
    failProfiles = true;
    try {
      const { response } = await runMiddleware("/api/menu", { cookie });
      expect(response.status).toBe(500);
      const body: unknown = await response.json();
      expect(body).toHaveProperty("error");
    } finally {
      failProfiles = false;
    }
  });

  it("still resolves a healthy owner normally (mock pass-through)", async () => {
    const cookie = await freshOwnerCookie();
    const { nextCalled, locals } = await runMiddleware("/dashboard", { cookie });
    expect(nextCalled).toBe(true);
    expect(locals.role).toBe("owner");
  });
});
