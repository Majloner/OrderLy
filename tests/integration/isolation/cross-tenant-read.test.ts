import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as menuGet } from "@/pages/api/menu/index";
import { GET as roomGet } from "@/pages/api/room/index";
import { GET as staffGet } from "@/pages/api/staff/index";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #1 — a company-A request never READS a company-B row on any entity. Asserts
// the actual returned set (not just a status code): company B ids must be absent
// and company A ids present. Reads go through the real GET handlers + RLS.

describe("Risk #1 — cross-tenant reads never leak company B rows", () => {
  let seed: SeedResult;

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("GET /api/menu returns only company A categories and items", async () => {
    const res = await Promise.resolve(menuGet(buildContext(seed.companyA.owner, { method: "GET" })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { categories: { id: string }[]; items: { id: string }[] } };
    const categoryIds = body.data.categories.map((category) => category.id);
    const itemIds = body.data.items.map((item) => item.id);

    expect(itemIds).toContain(seed.companyA.resources.itemId);
    expect(categoryIds).not.toContain(seed.companyB.resources.categoryId);
    expect(itemIds).not.toContain(seed.companyB.resources.itemId);
  });

  it("GET /api/room returns only company A rooms and tables", async () => {
    const res = await Promise.resolve(roomGet(buildContext(seed.companyA.owner, { method: "GET" })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { rooms: { id: string }[]; tables: { id: string }[] } };
    const roomIds = body.data.rooms.map((room) => room.id);
    const tableIds = body.data.tables.map((table) => table.id);

    expect(tableIds).toContain(seed.companyA.resources.tableId);
    expect(roomIds).not.toContain(seed.companyB.resources.roomId);
    expect(tableIds).not.toContain(seed.companyB.resources.tableId);
  });

  it("GET /api/staff returns only company A staff", async () => {
    const res = await Promise.resolve(staffGet(buildContext(seed.companyA.owner, { method: "GET" })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user_id: string }[] };
    const userIds = body.data.map((member) => member.user_id);

    expect(userIds).toContain(seed.companyA.waiter.user?.id);
    expect(userIds).not.toContain(seed.companyB.waiter.user?.id);
    expect(userIds).not.toContain(seed.companyB.owner.user?.id);
  });

  it("companies: owner A sees only their own company via RLS", async () => {
    const { data, error } = await seed.companyA.owner.client
      .from("companies")
      .select("id")
      .overrideTypes<{ id: string }[], { merge: false }>();
    expect(error).toBeNull();
    const ids = (data ?? []).map((company) => company.id);

    expect(ids).toContain(seed.companyA.company_id);
    expect(ids).not.toContain(seed.companyB.company_id);
  });

  it("the owner role does not widen the tenant set — a waiter reads the same A-only scope", async () => {
    const res = await Promise.resolve(menuGet(buildContext(seed.companyA.waiter, { method: "GET" })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: { id: string }[] } };
    const itemIds = body.data.items.map((item) => item.id);

    expect(itemIds).not.toContain(seed.companyB.resources.itemId);
  });
});
