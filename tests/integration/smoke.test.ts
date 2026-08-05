import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceRoleClient } from "./helpers/clients";
import { seedTwoCompanies, type SeedResult } from "./helpers/fixtures";

// Phase 1 smoke test: proves the harness itself works end-to-end — fixtures seed
// two isolated tenants, a user-scoped client enforces RLS, and the service-role
// client can verify effects the tenant client cannot see. Later phases build the
// authz matrix (#3) and cross-tenant assertions (#1) on exactly these pieces.

describe("integration harness smoke", () => {
  let seed: SeedResult;

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("seeds two companies with distinct ids and venue codes", () => {
    expect(seed.companyA.company_id).not.toBe(seed.companyB.company_id);
    expect(seed.companyA.venue_code).not.toBe(seed.companyB.venue_code);
  });

  it("gives each company an owner, waiter and kitchen principal", () => {
    for (const company of [seed.companyA, seed.companyB]) {
      expect(company.owner.role).toBe("owner");
      expect(company.waiter.role).toBe("waiter");
      expect(company.kitchen.role).toBe("kitchen");
    }
  });

  it("scopes an owner-A read to company A (RLS engaged)", async () => {
    const { data, error } = await seed.companyA.owner.client
      .from("menu_categories")
      .select("id, company_id")
      .overrideTypes<{ id: string; company_id: string }[], { merge: false }>();
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
    expect((data ?? []).every((row) => row.company_id === seed.companyA.company_id)).toBe(true);
  });

  it("hides company-B rows from owner A while the service-role client sees them", async () => {
    const asOwnerA = await seed.companyA.owner.client
      .from("menu_categories")
      .select("id, company_id")
      .eq("company_id", seed.companyB.company_id);
    expect(asOwnerA.error).toBeNull();
    expect((asOwnerA.data ?? []).length).toBe(0);

    const asService = await serviceRoleClient()
      .from("menu_categories")
      .select("id, company_id")
      .eq("company_id", seed.companyB.company_id);
    expect(asService.error).toBeNull();
    expect((asService.data ?? []).length).toBeGreaterThan(0);
  });
});
