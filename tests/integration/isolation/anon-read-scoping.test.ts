import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceRoleClient } from "../helpers/clients";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #2 — the anon key must have no tenant read surface.
//
// This suite exists because the SQL suite and the route tests both miss the actual
// attacker path:
//   - rls_isolation.sql runs `set local role anon` inside psql as superuser. It
//     proves the POLICY predicate, but never traverses the API gateway, PostgREST's
//     schema exposure, the anon-key -> role mapping, or the table GRANTs.
//   - the authz matrix asserts anon -> 401 on every route, which proves the guard
//     refuses anon BEFORE any query runs. It says nothing about what the database
//     would have returned.
//
// What runs here is the real thing: the public anon key, no session, straight at
// PostgREST — the same credential and the same path an attacker holds. Closed by
// 20260813010000_drop_unscoped_anon_read_policies.sql; before it, every table below
// returned rows for both companies.

interface Row {
  id: string;
}

describe("Risk #2 — the anon key reads no tenant data", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  // Control: the fixtures really are in the database. Without this, every
  // zero-rows assertion below would also pass against an empty database — the
  // classic way an isolation test proves nothing.
  it("control: the service-role client DOES see both companies' rows", async () => {
    const companies = await service
      .from("companies")
      .select("id")
      .in("id", [seed.companyA.company_id, seed.companyB.company_id])
      .overrideTypes<Row[], { merge: false }>();
    expect((companies.data ?? []).length).toBe(2);

    const items = await service
      .from("menu_items")
      .select("id")
      .in("company_id", [seed.companyA.company_id, seed.companyB.company_id])
      .overrideTypes<Row[], { merge: false }>();
    expect((items.data ?? []).length).toBeGreaterThan(0);
  });

  it("cannot read companies — no venue codes, names or addresses", async () => {
    const { data, error } = await seed.anon.client
      .from("companies")
      .select("id")
      .in("id", [seed.companyA.company_id, seed.companyB.company_id])
      .overrideTypes<Row[], { merge: false }>();
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  // One case per table rather than a loop: each names the asset that must not leak,
  // so a failure says what an attacker just obtained.
  const HIDDEN_TABLES: { table: string; asset: string }[] = [
    { table: "tables", asset: "floor-plan geometry and table numbers" },
    { table: "menu_categories", asset: "menu structure" },
    { table: "menu_items", asset: "prices, allergens, sold_out state and photo_path" },
    { table: "rooms", asset: "room names (never had an anon policy)" },
    { table: "room_objects", asset: "furnishing layout (never had an anon policy)" },
    { table: "profiles", asset: "staff accounts (never had an anon policy)" },
  ];

  for (const { table, asset } of HIDDEN_TABLES) {
    it(`cannot read ${table} — ${asset}`, async () => {
      const { data, error } = await seed.anon.client
        .from(table)
        .select("company_id")
        .in("company_id", [seed.companyA.company_id, seed.companyB.company_id])
        .overrideTypes<{ company_id: string }[], { merge: false }>();
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  }

  it("cannot write a menu item", async () => {
    const row = { company_id: seed.companyA.company_id, name: "anon-probe", price: 1.0 };
    const { data } = await seed.anon.client
      .from("menu_items")
      .insert(row as never)
      .select("id");
    expect(data ?? []).toEqual([]);

    const check = await service
      .from("menu_items")
      .select("id")
      .eq("company_id", seed.companyA.company_id)
      .eq("name", "anon-probe")
      .overrideTypes<Row[], { merge: false }>();
    expect((check.data ?? []).length).toBe(0);
  });
});
