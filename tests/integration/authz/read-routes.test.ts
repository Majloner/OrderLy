import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type Principal, type SeedResult } from "../helpers/fixtures";
import { READ_ROUTES } from "./route-matrix";

// Risk #3 — read-route authorization asymmetry. Menu and room reads are open to
// any authenticated staff (owner/waiter/kitchen) but closed to anon; the staff
// roster is owner-only. Guards run first, so anon is 401 before any query.

describe("Risk #3 — read-route authorization", () => {
  let seed: SeedResult;

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  for (const route of READ_ROUTES) {
    describe(route.label, () => {
      const call = (principal: Principal): Promise<Response> =>
        Promise.resolve(route.handler(buildContext(principal, { method: "GET" })));

      it("rejects an anonymous caller with 401", async () => {
        const res = await call(seed.anon);
        expect(res.status).toBe(401);
      });

      it("allows the owner (200)", async () => {
        const res = await call(seed.companyA.owner);
        expect(res.status).toBe(200);
      });

      if (route.allowStaff) {
        it("allows a waiter (200)", async () => {
          const res = await call(seed.companyA.waiter);
          expect(res.status).toBe(200);
        });

        it("allows the kitchen (200)", async () => {
          const res = await call(seed.companyA.kitchen);
          expect(res.status).toBe(200);
        });
      } else {
        it("rejects a waiter with 403", async () => {
          const res = await call(seed.companyA.waiter);
          expect(res.status).toBe(403);
        });

        it("rejects the kitchen with 403", async () => {
          const res = await call(seed.companyA.kitchen);
          expect(res.status).toBe(403);
        });
      }
    });
  }
});
