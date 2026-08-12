import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { APIRoute } from "astro";
import { POST as menuCategoriesPost } from "@/pages/api/menu/categories";
import { PUT as menuCategoryPut } from "@/pages/api/menu/categories/[id]";
import { PUT as menuCategoriesReorderPut } from "@/pages/api/menu/categories/reorder";
import { POST as menuItemsPost } from "@/pages/api/menu/items";
import { PUT as menuItemPut } from "@/pages/api/menu/items/[id]";
import { PUT as menuItemsReorderPut } from "@/pages/api/menu/items/reorder";
import { POST as photoUrlPost } from "@/pages/api/menu/items/[id]/photo-url";
import { POST as roomsPost } from "@/pages/api/room/rooms";
import { PUT as roomPut } from "@/pages/api/room/rooms/[id]";
import { POST as tablesPost } from "@/pages/api/room/tables";
import { PUT as tablePut } from "@/pages/api/room/tables/[id]";
import { PATCH as tableActivationPatch } from "@/pages/api/room/tables/[id]/activation";
import { PATCH as tablePositionPatch } from "@/pages/api/room/tables/[id]/position";
import { POST as objectsPost } from "@/pages/api/room/objects";
import { PUT as objectPut } from "@/pages/api/room/objects/[id]";
import { PATCH as objectPositionPatch } from "@/pages/api/room/objects/[id]/position";
import { PATCH as objectTransformPatch } from "@/pages/api/room/objects/[id]/transform";
import { POST as staffPost } from "@/pages/api/staff/index";
import { PUT as staffPut } from "@/pages/api/staff/[id]";
import { buildContext } from "../helpers/context";
import { seedTwoCompanies, type SeedResult } from "../helpers/fixtures";

// Risk #5 — input-validation parity. The zod schema is the contract; this proves
// each route actually ENFORCES it end-to-end (parseBody wiring), not that zod
// mirrors itself. Every field-level constraint is already covered by the schema
// unit tests (src/lib/schemas/*.test.ts), so one representative out-of-contract
// request per route is the right cost x signal here.
//
// All cases run as owner A so the guard admits them, and every [id] param is a
// REAL owned id — a bad uuid would 400 at the path check and the test would pass
// for the wrong reason. Each bad body targets a named schema constraint, and in
// every route parseBody runs before the ownership/DB work, so the 400 is the
// schema's.

interface ParityCase {
  label: string;
  handler: APIRoute;
  method: "POST" | "PUT" | "PATCH";
  // The constraint the bad body is meant to trip — kept next to the case so a
  // failure names the contract, not just a status code.
  violates: string;
  // Seed-aware: parseBody reports only the FIRST zod issue, so every other field
  // must be valid (e.g. a real room_id) or the 400 would come from the wrong
  // constraint and the label would lie.
  badBody: (seed: SeedResult) => unknown;
  params?: (seed: SeedResult) => Record<string, string>;
}

const ownedItem = (seed: SeedResult) => ({ id: seed.companyA.resources.itemId });
const ownedCategory = (seed: SeedResult) => ({ id: seed.companyA.resources.categoryId });
const ownedRoom = (seed: SeedResult) => ({ id: seed.companyA.resources.roomId });
const ownedTable = (seed: SeedResult) => ({ id: seed.companyA.resources.tableId });
const ownedObject = (seed: SeedResult) => ({ id: seed.companyA.resources.objectId });

const validItem = {
  name: "Parity probe",
  description: null,
  price: 12.5,
  category_id: null,
  availability: "available",
  allergens: [],
};

const validTable = (seed: SeedResult) => ({
  room_id: seed.companyA.resources.roomId,
  number: 42,
  label: null,
  shape: "square",
  pos_x: 10,
  pos_y: 10,
  is_active: true,
});

const validObject = (seed: SeedResult) => ({
  room_id: seed.companyA.resources.roomId,
  kind: "chair",
  label: null,
  pos_x: 10,
  pos_y: 10,
  width: 40,
  height: 40,
  rotation: 0,
});

const CASES: ParityCase[] = [
  {
    label: "POST /api/menu/categories — whitespace-only name",
    handler: menuCategoriesPost,
    method: "POST",
    violates: "menuCategoryInputSchema.name trim().min(1)",
    badBody: () => ({ name: "   " }),
  },
  {
    label: "PUT /api/menu/categories/[id] — name over 80 chars",
    handler: menuCategoryPut,
    method: "PUT",
    violates: "menuCategoryInputSchema.name max(80)",
    badBody: () => ({ name: "x".repeat(81) }),
    params: ownedCategory,
  },
  {
    label: "PUT /api/menu/categories/reorder — empty id list",
    handler: menuCategoriesReorderPut,
    method: "PUT",
    violates: "reorderSchema.min(1)",
    badBody: () => [],
  },
  {
    label: "POST /api/menu/items — negative price",
    handler: menuItemsPost,
    method: "POST",
    violates: "menuItemInputSchema.price positive()",
    badBody: () => ({ ...validItem, price: -5 }),
  },
  {
    label: "PUT /api/menu/items/[id] — unknown availability",
    handler: menuItemPut,
    method: "PUT",
    violates: "menuItemInputSchema.availability enum",
    badBody: () => ({ ...validItem, availability: "hidden" }),
    params: ownedItem,
  },
  {
    label: "PUT /api/menu/items/reorder — non-uuid entry",
    handler: menuItemsReorderPut,
    method: "PUT",
    violates: "reorderSchema uuid()",
    badBody: () => ["not-a-uuid"],
  },
  {
    label: "POST /api/menu/items/[id]/photo-url — non-WebP content type",
    handler: photoUrlPost,
    method: "POST",
    violates: 'photoUploadRequestSchema.contentType literal("image/webp")',
    badBody: () => ({ contentType: "image/png", fullSize: 500_000, thumbSize: 40_000 }),
    params: ownedItem,
  },
  {
    label: "POST /api/room/rooms — empty name",
    handler: roomsPost,
    method: "POST",
    violates: "roomInputSchema.name min(1)",
    badBody: () => ({ name: "" }),
  },
  {
    label: "PUT /api/room/rooms/[id] — name over 60 chars",
    handler: roomPut,
    method: "PUT",
    violates: "roomInputSchema.name max(60)",
    badBody: () => ({ name: "x".repeat(61) }),
    params: ownedRoom,
  },
  {
    label: "POST /api/room/tables — unknown shape",
    handler: tablesPost,
    method: "POST",
    violates: "tableInputSchema.shape enum",
    badBody: (seed) => ({ ...validTable(seed), shape: "hexagon" }),
  },
  {
    label: "PUT /api/room/tables/[id] — number over the 999 cap",
    handler: tablePut,
    method: "PUT",
    violates: "tableInputSchema.number max(MAX_TABLE_NUMBER)",
    badBody: (seed) => ({ ...validTable(seed), number: 1000 }),
    params: ownedTable,
  },
  {
    label: "PATCH /api/room/tables/[id]/activation — non-boolean is_active",
    handler: tableActivationPatch,
    method: "PATCH",
    violates: "tableActivationSchema.is_active boolean",
    badBody: () => ({ is_active: "yes" }),
    params: ownedTable,
  },
  {
    label: "PATCH /api/room/tables/[id]/position — pos_x beyond the canvas",
    handler: tablePositionPatch,
    method: "PATCH",
    violates: "tablePositionSchema.pos_x max(LOGICAL_CANVAS.width)",
    badBody: () => ({ pos_x: 1201, pos_y: 100 }),
    params: ownedTable,
  },
  {
    label: "POST /api/room/objects — unknown kind",
    handler: objectsPost,
    method: "POST",
    violates: "roomObjectInputSchema.kind enum",
    badBody: (seed) => ({ ...validObject(seed), kind: "throne" }),
  },
  {
    label: "PUT /api/room/objects/[id] — rotation of 360 degrees",
    handler: objectPut,
    method: "PUT",
    violates: "roomObjectInputSchema.rotation max(MAX_ROTATION_DEGREES)",
    badBody: (seed) => ({ ...validObject(seed), rotation: 360 }),
    params: ownedObject,
  },
  {
    label: "PATCH /api/room/objects/[id]/position — negative pos_y",
    handler: objectPositionPatch,
    method: "PATCH",
    violates: "roomObjectPositionSchema.pos_y min(0)",
    badBody: () => ({ pos_x: 100, pos_y: -1 }),
    params: ownedObject,
  },
  {
    label: "PATCH /api/room/objects/[id]/transform — width below the 10px floor",
    handler: objectTransformPatch,
    method: "PATCH",
    violates: "roomObjectTransformSchema.width min(OBJECT_SIZE_BOUNDS.minWidth)",
    badBody: () => ({ pos_x: 100, pos_y: 100, width: 5, height: 40, rotation: 0 }),
    params: ownedObject,
  },
  {
    label: "POST /api/staff — password below the 8-char floor",
    handler: staffPost,
    method: "POST",
    violates: "staffCreateInputSchema.password min(MIN_STAFF_PASSWORD_LENGTH)",
    badBody: () => ({ login: "parity", email: null, password: "short", full_name: null, role: "waiter" }),
  },
  {
    label: "PUT /api/staff/[id] — owner is not an assignable role",
    handler: staffPut,
    method: "PUT",
    violates: "staffUpdateInputSchema.role enum(STAFF_ASSIGNABLE_ROLES)",
    badBody: () => ({ role: "owner" }),
    // A non-self target, so the self-guard (403) cannot mask the schema 400.
    params: (seed) => ({ id: seed.companyA.waiter.user?.id ?? "" }),
  },
];

describe("Risk #5 — the server enforces the input contract", () => {
  let seed: SeedResult;

  beforeAll(async () => {
    seed = await seedTwoCompanies();
  });

  afterAll(async () => {
    await seed.cleanup();
  });

  for (const parityCase of CASES) {
    it(`${parityCase.label} → 400 (${parityCase.violates})`, async () => {
      const res = await Promise.resolve(
        parityCase.handler(
          buildContext(seed.companyA.owner, {
            method: parityCase.method,
            params: parityCase.params?.(seed),
            body: parityCase.badBody(seed),
          }),
        ),
      );

      // Not 401/403: the owner passed the guard, so the rejection is the contract's.
      expect([401, 403]).not.toContain(res.status);
      expect(res.status).toBe(400);
    });
  }
});
