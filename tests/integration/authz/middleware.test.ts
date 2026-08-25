import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { staffAuthEmail } from "@/lib/staff-identity";
import { PASSWORD, seedTwoCompanies, type SeedResult } from "../helpers/fixtures";
import { serviceRoleClient, signInAs } from "../helpers/clients";
import { runMiddleware, sessionCookieFromClient, sessionCookieName } from "../helpers/middleware";

// Page-route gating (test-plan Risk #3, middleware half). Drives
// src/middleware.ts onRequest directly — no HTTP server. Oracle sources:
// PRD Access Control ("panele personelu pozostają za logowaniem", roles) and
// the S-02 deactivation contract (staff-accounts-roles/plan.md:492-501).
// Deliberately NOT asserted: the Polish error message wording — it exists only
// in the implementation, so a test would mirror it; the `error` query param's
// presence is the documented mechanism and that is what tests check.

let seed: SeedResult;

beforeAll(async () => {
  seed = await seedTwoCompanies();
}, 120_000);

afterAll(async () => {
  await seed.cleanup();
});

// A FRESH waiter session per test. The middleware's sign-out branch revokes
// every session of the user globally (GoTrue rejects the old JWTs afterwards),
// so reusing the seeded Principal's session across deactivation tests would
// poison later tests in this file.
async function freshWaiterCookie(): Promise<string> {
  const client = await signInAs({
    email: staffAuthEmail(seed.companyA.venue_code, "waiter"),
    password: PASSWORD,
  });
  return sessionCookieFromClient(client);
}

describe("middleware harness smoke", () => {
  it("redirects an anonymous request on a protected route to /auth/signin", async () => {
    const { response, nextCalled } = await runMiddleware("/dashboard");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/auth/signin");
    expect(nextCalled).toBe(false);
  });

  it("passes an anonymous request on a public route through to the page", async () => {
    const { response, nextCalled } = await runMiddleware("/");
    expect(nextCalled).toBe(true);
    expect(await response.text()).toBe("next-called");
  });
});

describe("owner-only /settings (FR-002)", () => {
  it("bounces a waiter requesting /settings to /dashboard", async () => {
    const cookie = await freshWaiterCookie();
    const { response, nextCalled } = await runMiddleware("/settings", { cookie });
    expect(nextCalled).toBe(false);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
  });
});

describe("deactivated staff with a live session (S-02 contract)", () => {
  // Flip deactivated_at with the service-role client (bypasses RLS) and always
  // restore it — the seeded waiter is shared by every other test in this file.
  async function withDeactivatedWaiter(run: () => Promise<void>): Promise<void> {
    const service = serviceRoleClient();
    const waiterId = seed.companyA.waiter.user?.id;
    if (!waiterId) {
      throw new Error("seed waiter has no user id");
    }
    const flip = async (deactivatedAt: string | null): Promise<void> => {
      const { error } = await service
        .from("profiles")
        .update({ deactivated_at: deactivatedAt } as never)
        .eq("user_id", waiterId);
      if (error) {
        throw new Error(`deactivated_at flip failed: ${error.message}`);
      }
    };
    await flip(new Date().toISOString());
    try {
      await run();
    } finally {
      await flip(null);
    }
  }

  it("signs out a deactivated waiter on their next request to the public /", async () => {
    const cookie = await freshWaiterCookie();
    await withDeactivatedWaiter(async () => {
      const { response, cookies, nextCalled } = await runMiddleware("/", { cookie });
      expect(nextCalled).toBe(false);
      expect(response.status).toBe(302);
      const location = response.headers.get("Location") ?? "";
      expect(location.startsWith("/auth/signin?")).toBe(true);
      const params = new URLSearchParams(location.split("?")[1]);
      expect(params.get("error")).toBeTruthy();
      // The session cookie must be cleared through the context, otherwise the
      // user can loop straight back (S-02 contract).
      expect(cookies.get(sessionCookieName())?.value).toBeFalsy();
    });
  });

  it("does not redirect-loop on /auth/signin: one hop, then a cookie-less request renders", async () => {
    const cookie = await freshWaiterCookie();
    await withDeactivatedWaiter(async () => {
      const first = await runMiddleware("/auth/signin", { cookie });
      expect(first.nextCalled).toBe(false);
      expect(first.response.status).toBe(302);
      expect((first.response.headers.get("Location") ?? "").startsWith("/auth/signin?")).toBe(true);
      expect(first.cookies.get(sessionCookieName())?.value).toBeFalsy();
      // The redirect arrives with the clearing headers, so the follow-up
      // request carries no session cookie — and must render the page.
      const followUp = await runMiddleware("/auth/signin");
      expect(followUp.nextCalled).toBe(true);
    });
  });

  it("leaves an active (non-deactivated) waiter alone on public routes", async () => {
    const cookie = await freshWaiterCookie();
    const { nextCalled, locals } = await runMiddleware("/", { cookie });
    expect(nextCalled).toBe(true);
    expect(locals.role).toBe("waiter");
  });
});
