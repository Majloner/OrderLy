import { describe, expect, it } from "vitest";
import { runMiddleware } from "../helpers/middleware";

// Smoke: proves the harness drives src/middleware.ts end to end (import via
// the astro:middleware alias, createContext, redirect vs pass-through). The
// real Risk #3 assertions — role bounces, deactivation sign-out, the full
// route matrix — build on this harness in later phases of
// context/changes/middleware-route-protection/plan.md.
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
