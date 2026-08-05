import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PUT as menuCategoryPut } from "@/pages/api/menu/categories/[id]";
import { PUT as menuItemPut } from "@/pages/api/menu/items/[id]";
import { PUT as roomPut } from "@/pages/api/room/rooms/[id]";
import { PATCH as tableActivationPatch } from "@/pages/api/room/tables/[id]/activation";
import { PUT as staffPut } from "@/pages/api/staff/[id]";
import { serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #1 — a company-A request never MUTATES a company-B row. Each case drives a
// real write handler as owner A against a company-B id, expects a 404 (RLS filters
// the row so the guard admits the owner but the update matches nothing), and then
// re-reads the B row with the service-role client to prove it is byte-for-byte
// unchanged. Asserting the effect in the DB — not just the status — is the point:
// a 404 alone would not prove nothing leaked.

describe("Risk #1 — cross-tenant writes are denied and leave company B unchanged", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("owner A cannot rename company B's menu category", async () => {
    const res = await Promise.resolve(
      menuCategoryPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyB.resources.categoryId },
          body: { name: "HACKED" },
        }),
      ),
    );
    expect([401, 403]).not.toContain(res.status);
    expect(res.status).toBe(404);

    const { data } = await service
      .from("menu_categories")
      .select("name")
      .eq("id", seed.companyB.resources.categoryId)
      .single<{ name: string }>();
    expect(data?.name).not.toBe("HACKED");
  });

  it("owner A cannot edit company B's menu item", async () => {
    const res = await Promise.resolve(
      menuItemPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyB.resources.itemId },
          body: {
            name: "HACKED",
            description: null,
            price: 9.99,
            category_id: null,
            availability: "available",
            allergens: [],
          },
        }),
      ),
    );
    expect(res.status).toBe(404);

    const { data } = await service
      .from("menu_items")
      .select("name")
      .eq("id", seed.companyB.resources.itemId)
      .single<{ name: string }>();
    expect(data?.name).toBe("Seed Item");
  });

  it("owner A cannot rename company B's room", async () => {
    const res = await Promise.resolve(
      roomPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyB.resources.roomId },
          body: { name: "HACKED" },
        }),
      ),
    );
    expect(res.status).toBe(404);

    const { data } = await service
      .from("rooms")
      .select("name")
      .eq("id", seed.companyB.resources.roomId)
      .single<{ name: string }>();
    expect(data?.name).not.toBe("HACKED");
  });

  it("owner A cannot deactivate company B's table", async () => {
    const res = await Promise.resolve(
      tableActivationPatch(
        buildContext(seed.companyA.owner, {
          method: "PATCH",
          params: { id: seed.companyB.resources.tableId },
          body: { is_active: false },
        }),
      ),
    );
    expect(res.status).toBe(404);

    const { data } = await service
      .from("tables")
      .select("is_active")
      .eq("id", seed.companyB.resources.tableId)
      .single<{ is_active: boolean }>();
    expect(data?.is_active).toBe(true);
  });

  it("owner A cannot edit company B's staff member", async () => {
    const bWaiterId = seed.companyB.waiter.user?.id;
    if (!bWaiterId) {
      throw new Error("seed missing company B waiter id");
    }

    const res = await Promise.resolve(
      staffPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: bWaiterId },
          body: { full_name: "HACKED" },
        }),
      ),
    );
    expect(res.status).toBe(404);

    const { data } = await service
      .from("profiles")
      .select("full_name")
      .eq("user_id", bWaiterId)
      .single<{ full_name: string }>();
    expect(data?.full_name).toBe("Waiter");
  });

  it("owner A cannot update company B's company row via a direct RLS write", async () => {
    const { data } = await seed.companyA.owner.client
      .from("companies")
      .update({ name: "HACKED" } as never)
      .eq("id", seed.companyB.company_id)
      .select("id");
    expect((data ?? []).length).toBe(0);

    const check = await service
      .from("companies")
      .select("name")
      .eq("id", seed.companyB.company_id)
      .single<{ name: string }>();
    expect(check.data?.name).not.toBe("HACKED");
  });
});
