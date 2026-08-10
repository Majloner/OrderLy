import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type Principal, type SeedResult } from "../helpers/fixtures";
import { WRITE_ROUTES } from "./route-matrix";

// Risk #3 — request-layer authorization. Drives every guarded mutating route as
// four principals through a synthetic context (real guard code, real RLS, no
// HTTP server). The guard is the first statement in every handler, so waiter /
// kitchen / anon are rejected before any body or param is read — no valid
// payloads needed. The owner assertion checks only that the guard ADMITS the
// owner (status is not 401/403); the functional happy path per entity lives in
// the Risk #1 isolation suite, so this stays a pure authorization matrix.

describe("Risk #3 — write-route authorization matrix", () => {
  let seed: SeedResult;

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  for (const route of WRITE_ROUTES) {
    describe(route.label, () => {
      const call = (principal: Principal): Promise<Response> =>
        Promise.resolve(
          route.handler(buildContext(principal, { method: route.method, params: route.params, body: {} })),
        );

      it("rejects an anonymous caller with 401", async () => {
        const res = await call(seed.anon);
        expect(res.status).toBe(401);
      });

      it("rejects a waiter with 403", async () => {
        const res = await call(seed.companyA.waiter);
        expect(res.status).toBe(403);
      });

      it("rejects the kitchen with 403", async () => {
        const res = await call(seed.companyA.kitchen);
        expect(res.status).toBe(403);
      });

      it("admits the owner past the guard (not 401/403)", async () => {
        const res = await call(seed.companyA.owner);
        expect([401, 403]).not.toContain(res.status);
      });
    });
  }
});
