import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { staffAuthEmail } from "@/lib/staff-identity";
import { PASSWORD, seedTwoCompanies, type SeedResult } from "../helpers/fixtures";
import { serviceRoleClient, signInAs } from "../helpers/clients";
import { emptyLocals, runMiddleware, sessionCookieFromClient, sessionCookieName } from "../helpers/middleware";

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
});

afterAll(async () => {
  await seed.cleanup();
});

// A FRESH waiter session per test. The middleware's sign-out branch revokes
// every session of the user globally (GoTrue rejects the old JWTs afterwards),
// so reusing the seeded Principal's session across deactivation tests would
// poison later tests in this file.
async function freshStaffCookie(login: "waiter" | "kitchen"): Promise<string> {
  const client = await signInAs({
    email: staffAuthEmail(seed.companyA.venue_code, login),
    password: PASSWORD,
  });
  return sessionCookieFromClient(client);
}

function freshWaiterCookie(): Promise<string> {
  return freshStaffCookie("waiter");
}

// Route inventories for the matrix. Every route in the middleware's
// PROTECTED_ROUTES / OWNER_ROUTES gets a row here — the cookbook (test-plan §6)
// makes adding a row part of adding a protected route. Subpaths prove prefix
// matching; /menus proves the boundary the middleware comment reserves for a
// future public client-menu page.
const PROTECTED_PAGES = ["/dashboard", "/settings", "/menu", "/staff", "/room"];
const PROTECTED_SUBPATHS = ["/menu/anything", "/room/editor/nested"];
// /menu left this list in S-05 — the whole staff may open it (role-gated UI).
const OWNER_PAGES = ["/staff", "/room", "/settings"];
const PUBLIC_PAGES = ["/", "/auth/signin", "/auth/signup", "/auth/confirm-email", "/menus"];

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

  it("answers a deactivated session on /api/* with JSON 401, not a redirect", async () => {
    const cookie = await freshWaiterCookie();
    await withDeactivatedWaiter(async () => {
      const { response, nextCalled } = await runMiddleware("/api/menu/items", { cookie });
      expect(nextCalled).toBe(false);
      expect(response.status).toBe(401);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      const body = (await response.json()) as { error?: unknown };
      // Non-empty, not just "a string" — an empty error message would reach
      // API clients as a blank banner (survived-mutant finding).
      expect(typeof body.error).toBe("string");
      expect(body.error).toBeTruthy();
    });
  });

  it("clears the session cookie itself when the sign-out call fails (GoTrue outage)", async () => {
    // Hermetic failure at the network edge (test-plan §1: partial failures real
    // infra cannot trigger): only the /logout call fails, everything else goes
    // through. On such an error GoTrue keeps the local session, so without the
    // middleware's own cookie cleanup the redirect would loop forever. The
    // decoy cookie proves the cleanup deletes ONLY auth cookies.
    // Three decoys pin the cleanup filter exactly: `decoy` matches neither
    // predicate, `sb-decoy` only the prefix, `my-auth-token` only the suffix —
    // all three must survive while the real auth cookie dies.
    const cookie = `${await freshWaiterCookie()}; decoy=keep; sb-decoy=keep; my-auth-token=keep`;
    await withDeactivatedWaiter(async () => {
      const realFetch = globalThis.fetch.bind(globalThis);
      vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("/auth/v1/logout")) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 503 });
        }
        return realFetch(input, init);
      });
      try {
        const { response, cookies, nextCalled } = await runMiddleware("/", { cookie });
        expect(nextCalled).toBe(false);
        expect(response.status).toBe(302);
        expect((response.headers.get("Location") ?? "").startsWith("/auth/signin?")).toBe(true);
        expect(cookies.get(sessionCookieName())?.value).toBeFalsy();
        expect(cookies.get("decoy")?.value).toBe("keep");
        expect(cookies.get("sb-decoy")?.value).toBe("keep");
        expect(cookies.get("my-auth-token")?.value).toBe("keep");
        // The removal must carry Path=/ — a browser only drops a cookie when
        // the deletion path matches the one it was set with; a pathless delete
        // would leave the session cookie alive and redirect-loop the user.
        const removal = [...cookies.headers()].find((h) => h.startsWith(`${sessionCookieName()}=`));
        expect(removal).toBeDefined();
        expect(removal).toContain("Path=/");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("sends an active (non-deactivated) waiter from public entry pages to the panel, not to signout", async () => {
    // S-05 follow-up: "/" and the auth forms bounce a signed-in user with a
    // role to /dashboard. The load-bearing distinction vs the deactivation
    // branch above: an ACTIVE session is redirected WITHOUT touching cookies.
    const cookie = await freshWaiterCookie();
    for (const path of ["/", "/auth/signin", "/auth/signup"]) {
      const { response, nextCalled, cookies } = await runMiddleware(path, { cookie });
      expect(nextCalled).toBe(false);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard");
      expect([...cookies.headers()]).toEqual([]);
    }
  });

  it("resolves locals for an active waiter on a rendering route", async () => {
    const cookie = await freshWaiterCookie();
    const { nextCalled, locals } = await runMiddleware("/dashboard", { cookie });
    expect(nextCalled).toBe(true);
    expect(locals.role).toBe("waiter");
    // Exact display_name pins the fallback chain (full_name first). A mutated
    // chain can leak user.email — the SYNTHETIC staff address that must never
    // be rendered (S-09 rule) — so this one assertion guards that rule too.
    expect(locals.display_name).toBe("Waiter");
  });
});

describe("route-gating matrix (Risk #3)", () => {
  // Exact Location doubles as the OWNER ⊆ PROTECTED invariant: a route present
  // only in OWNER_ROUTES would send anon to /dashboard instead of signin.
  it.each([...PROTECTED_PAGES, ...PROTECTED_SUBPATHS])(
    "anon on %s → 302 /auth/signin, never /dashboard",
    async (path) => {
      const { response, nextCalled } = await runMiddleware(path);
      expect(nextCalled).toBe(false);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/auth/signin");
    },
  );

  it.each(OWNER_PAGES.flatMap((path) => (["waiter", "kitchen"] as const).map((role) => [role, path] as const)))(
    "bounces %s from owner route %s to /dashboard",
    async (role, path) => {
      const cookie = await freshStaffCookie(role);
      const { response, nextCalled } = await runMiddleware(path, { cookie });
      expect(nextCalled).toBe(false);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/dashboard");
    },
  );

  it("lets a waiter through to /dashboard (the bounce target renders for them)", async () => {
    const cookie = await freshWaiterCookie();
    const { nextCalled, locals } = await runMiddleware("/dashboard", { cookie });
    expect(nextCalled).toBe(true);
    expect(locals.role).toBe("waiter");
  });

  it.each(["waiter", "kitchen"] as const)("lets %s through to /menu (S-05: role-gated page)", async (role) => {
    const cookie = await freshStaffCookie(role);
    const { nextCalled, locals } = await runMiddleware("/menu", { cookie });
    expect(nextCalled).toBe(true);
    expect(locals.role).toBe(role);
  });

  it.each(PROTECTED_PAGES)("lets the owner through to %s", async (path) => {
    const cookie = await sessionCookieFromClient(seed.companyA.owner.client);
    const { nextCalled, locals } = await runMiddleware(path, { cookie });
    expect(nextCalled).toBe(true);
    expect(locals.role).toBe("owner");
    expect(locals.company_id).toBe(seed.companyA.company_id);
  });

  it.each(PUBLIC_PAGES)("passes anon through on public %s", async (path) => {
    const { nextCalled } = await runMiddleware(path);
    expect(nextCalled).toBe(true);
  });
});

describe("supabase === null (unconfigured worker)", () => {
  // The env stub (tests/integration/stubs/astro-env-server.ts) reads
  // process.env at module evaluation, so a fresh module registry is required
  // for createClient to see the cleared env and return null. Today anon is
  // bounced because locals.user stays null — this pins that a config outage
  // fails closed, not open.
  it("still bounces anon off a protected route when Supabase env is missing", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_KEY", "");
    vi.resetModules();
    try {
      const { onRequest } = await import("@/middleware");
      const { createContext } = await import("astro/middleware");
      const context = createContext({
        request: new Request("http://localhost/dashboard"),
        defaultLocale: "",
        locals: emptyLocals(),
      });
      const response = await onRequest(context, () => Promise.resolve(new Response("next-called")));
      if (!(response instanceof Response)) {
        throw new Error("middleware returned no Response");
      }
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe("/auth/signin");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
