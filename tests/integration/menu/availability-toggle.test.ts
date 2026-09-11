import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as menuItemAvailabilityPatch } from "@/pages/api/menu/items/[id]/availability";
import { serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// S-05 route-level happy path (impl-review F5): the authz matrix proves the
// waiter gets PAST the guard and the RLS suite proves the DB-level invariant,
// but neither pins the middle — a waiter PATCH on an OWNED item returning 200
// with the updated row, persisted. Promoted from the phase-2 throwaway
// spot-check into a permanent case.

describe("S-05 — waiter availability toggle happy path", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("waiter A PATCHes own item to sold_out → 200 and persisted", async () => {
    const res = await Promise.resolve(
      menuItemAvailabilityPatch(
        buildContext(seed.companyA.waiter, {
          method: "PATCH",
          params: { id: seed.companyA.resources.itemId },
          body: { availability: "sold_out" },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { availability: string } };
    expect(payload.data.availability).toBe("sold_out");

    const { data } = await service
      .from("menu_items")
      .select("availability")
      .eq("id", seed.companyA.resources.itemId)
      .single<{ availability: string }>();
    expect(data?.availability).toBe("sold_out");
  });
});
