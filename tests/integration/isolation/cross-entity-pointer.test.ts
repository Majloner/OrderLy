import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as menuItemsPost } from "@/pages/api/menu/items";
import { PUT as menuItemPut } from "@/pages/api/menu/items/[id]";
import { POST as tablesPost } from "@/pages/api/room/tables";
import { PUT as tablePut } from "@/pages/api/room/tables/[id]";
import { POST as objectsPost } from "@/pages/api/room/objects";
import { PUT as objectPut } from "@/pages/api/room/objects/[id]";
import { serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #4 (cross-entity) — an owner must not be able to point their own row at
// another company's parent. FK validation runs BELOW RLS, so a bare FK is not
// proof of ownership: the route has to check it (RLS-scoped SELECT) first.
//
// Coverage note: tables.room_id and room_objects.room_id also carry a composite
// (company_id, room_id) FK, so the DB backs the app check up. menu_items.category_id
// does NOT — the route check is the only defence, which is why the DB-layer gap is
// demonstrated separately in supabase/tests/rls_isolation.sql.

const itemBody = (categoryId: string | null) => ({
  name: "Cross-entity probe",
  description: null,
  price: 12.5,
  category_id: categoryId,
  availability: "available",
  allergens: [],
});

const tableBody = (roomId: string) => ({
  room_id: roomId,
  number: 77,
  label: null,
  shape: "square",
  pos_x: 100,
  pos_y: 100,
  is_active: true,
});

const objectBody = (roomId: string) => ({
  room_id: roomId,
  kind: "chair",
  label: null,
  pos_x: 100,
  pos_y: 100,
  width: 40,
  height: 40,
  rotation: 0,
});

describe("Risk #4 — cross-entity pointers cannot cross the tenant boundary", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("POST /api/menu/items rejects a company-B category_id and writes nothing", async () => {
    const res = await Promise.resolve(
      menuItemsPost(
        buildContext(seed.companyA.owner, { method: "POST", body: itemBody(seed.companyB.resources.categoryId) }),
      ),
    );
    expect([401, 403]).not.toContain(res.status);
    expect(res.status).toBe(400);

    const { data } = await service
      .from("menu_items")
      .select("id")
      .eq("company_id", seed.companyA.company_id)
      .eq("category_id", seed.companyB.resources.categoryId);
    expect((data ?? []).length).toBe(0);
  });

  it("PUT /api/menu/items/[id] rejects a company-B category_id and leaves the item's category unchanged", async () => {
    const before = await service
      .from("menu_items")
      .select("category_id")
      .eq("id", seed.companyA.resources.itemId)
      .single<{ category_id: string | null }>();

    const res = await Promise.resolve(
      menuItemPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyA.resources.itemId },
          body: itemBody(seed.companyB.resources.categoryId),
        }),
      ),
    );
    expect(res.status).toBe(400);

    const after = await service
      .from("menu_items")
      .select("category_id")
      .eq("id", seed.companyA.resources.itemId)
      .single<{ category_id: string | null }>();
    expect(after.data?.category_id).toBe(before.data?.category_id);
    expect(after.data?.category_id).not.toBe(seed.companyB.resources.categoryId);
  });

  it("POST /api/room/tables rejects a company-B room_id and writes nothing", async () => {
    const res = await Promise.resolve(
      tablesPost(
        buildContext(seed.companyA.owner, { method: "POST", body: tableBody(seed.companyB.resources.roomId) }),
      ),
    );
    expect(res.status).toBe(400);

    const { data } = await service
      .from("tables")
      .select("id")
      .eq("company_id", seed.companyA.company_id)
      .eq("room_id", seed.companyB.resources.roomId);
    expect((data ?? []).length).toBe(0);
  });

  it("PUT /api/room/tables/[id] rejects a company-B room_id and leaves the table's room unchanged", async () => {
    const res = await Promise.resolve(
      tablePut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyA.resources.tableId },
          body: tableBody(seed.companyB.resources.roomId),
        }),
      ),
    );
    expect(res.status).toBe(400);

    const { data } = await service
      .from("tables")
      .select("room_id")
      .eq("id", seed.companyA.resources.tableId)
      .single<{ room_id: string }>();
    expect(data?.room_id).toBe(seed.companyA.resources.roomId);
  });

  it("POST /api/room/objects rejects a company-B room_id and writes nothing", async () => {
    const res = await Promise.resolve(
      objectsPost(
        buildContext(seed.companyA.owner, { method: "POST", body: objectBody(seed.companyB.resources.roomId) }),
      ),
    );
    expect(res.status).toBe(400);

    const { data } = await service
      .from("room_objects")
      .select("id")
      .eq("company_id", seed.companyA.company_id)
      .eq("room_id", seed.companyB.resources.roomId);
    expect((data ?? []).length).toBe(0);
  });

  it("PUT /api/room/objects/[id] rejects a company-B room_id and leaves the object's room unchanged", async () => {
    const res = await Promise.resolve(
      objectPut(
        buildContext(seed.companyA.owner, {
          method: "PUT",
          params: { id: seed.companyA.resources.objectId },
          body: objectBody(seed.companyB.resources.roomId),
        }),
      ),
    );
    expect(res.status).toBe(400);

    const { data } = await service
      .from("room_objects")
      .select("room_id")
      .eq("id", seed.companyA.resources.objectId)
      .single<{ room_id: string }>();
    expect(data?.room_id).toBe(seed.companyA.resources.roomId);
  });
});
