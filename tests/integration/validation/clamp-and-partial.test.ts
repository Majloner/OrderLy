import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as menuCategoriesPost } from "@/pages/api/menu/categories";
import { PATCH as tablePositionPatch } from "@/pages/api/room/tables/[id]/position";
import { PATCH as objectTransformPatch } from "@/pages/api/room/objects/[id]/transform";
import { PUT as staffPut } from "@/pages/api/staff/[id]";
import { serviceRoleClient } from "../helpers/clients";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #5, the other half: three behaviours that deliberately are NOT 400.
// Pinning them stops a future "tighten everything to reject" change from being
// made by accident, and stops a reader mistaking them for validation gaps.
//
//  1. In-canvas coordinates are CLAMPED by footprint, not rejected — that is why
//     the zod bounds can stay shape-agnostic (src/lib/room-geometry.ts).
//  2. Schemas are not .strict(), so unknown keys are stripped, not rejected.
//  3. A schema-valid but empty staff patch is refused by the ROUTE (400), not the
//     schema — a different layer, so it is asserted here rather than in the
//     parity matrix.

describe("Risk #5 — intentional non-400 boundaries", () => {
  let seed: SeedResult;
  const service = serviceRoleClient();

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  it("clamps a table dropped at the canvas edge instead of rejecting it", async () => {
    // 1200 is the schema maximum (in contract), but a square table's 80px
    // footprint would hang off the plan, so the server clamps to 1200-80.
    const res = await Promise.resolve(
      tablePositionPatch(
        buildContext(seed.companyA.owner, {
          method: "PATCH",
          params: { id: seed.companyA.resources.tableId },
          body: { pos_x: 1200, pos_y: 800 },
        }),
      ),
    );
    expect(res.status).toBe(200);

    const { data } = await service
      .from("tables")
      .select("pos_x, pos_y")
      .eq("id", seed.companyA.resources.tableId)
      .single<{ pos_x: number; pos_y: number }>();
    expect(data?.pos_x).toBe(1120);
    expect(data?.pos_y).toBe(720);
  });

  it("clamps a room object's centre by its rotated footprint instead of rejecting it", async () => {
    // Centre at the canvas edge with a 40x40 unrotated box → clamped to half the
    // width inside the boundary (1200-20).
    const res = await Promise.resolve(
      objectTransformPatch(
        buildContext(seed.companyA.owner, {
          method: "PATCH",
          params: { id: seed.companyA.resources.objectId },
          body: { pos_x: 1200, pos_y: 400, width: 40, height: 40, rotation: 0 },
        }),
      ),
    );
    expect(res.status).toBe(200);

    const { data } = await service
      .from("room_objects")
      .select("pos_x")
      .eq("id", seed.companyA.resources.objectId)
      .single<{ pos_x: number }>();
    expect(data?.pos_x).toBe(1180);
  });

  it("strips an unknown key rather than rejecting the request", async () => {
    const res = await Promise.resolve(
      menuCategoriesPost(
        buildContext(seed.companyA.owner, {
          method: "POST",
          body: { name: "Extra-key probe", bogusField: "ignored" },
        }),
      ),
    );
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).not.toHaveProperty("bogusField");
    expect(body.data.name).toBe("Extra-key probe");
  });

  it("refuses an empty staff patch at the route layer (400, not a schema error)", async () => {
    const waiterId = seed.companyA.waiter.user?.id;
    if (!waiterId) {
      throw new Error("seed missing company A waiter id");
    }

    const res = await Promise.resolve(
      staffPut(buildContext(seed.companyA.owner, { method: "PUT", params: { id: waiterId }, body: {} })),
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Brak zmian");
  });
});
