import type { APIRoute } from "astro";
import { POST as menuCategoriesPost } from "@/pages/api/menu/categories";
import { PUT as menuCategoryPut, DELETE as menuCategoryDelete } from "@/pages/api/menu/categories/[id]";
import { PUT as menuCategoriesReorderPut } from "@/pages/api/menu/categories/reorder";
import { POST as menuItemsPost } from "@/pages/api/menu/items";
import { PUT as menuItemPut, DELETE as menuItemDelete } from "@/pages/api/menu/items/[id]";
import { PATCH as menuItemAvailabilityPatch } from "@/pages/api/menu/items/[id]/availability";
import { PUT as menuItemsReorderPut } from "@/pages/api/menu/items/reorder";
import { POST as roomsPost } from "@/pages/api/room/rooms";
import { PUT as roomPut, DELETE as roomDelete } from "@/pages/api/room/rooms/[id]";
import { POST as tablesPost } from "@/pages/api/room/tables";
import { PUT as tablePut } from "@/pages/api/room/tables/[id]";
import { PATCH as tableActivationPatch } from "@/pages/api/room/tables/[id]/activation";
import { PATCH as tablePositionPatch } from "@/pages/api/room/tables/[id]/position";
import { POST as objectsPost } from "@/pages/api/room/objects";
import { PUT as objectPut, DELETE as objectDelete } from "@/pages/api/room/objects/[id]";
import { PATCH as objectPositionPatch } from "@/pages/api/room/objects/[id]/position";
import { PATCH as objectTransformPatch } from "@/pages/api/room/objects/[id]/transform";
import { GET as menuGet } from "@/pages/api/menu/index";
import { GET as roomGet } from "@/pages/api/room/index";
import { GET as staffGet, POST as staffPost } from "@/pages/api/staff/index";
import { PUT as staffPut } from "@/pages/api/staff/[id]";

// A valid-looking id for [id] routes. It never matches a seeded row, so a route
// that admits the caller past the guard falls through to 404 — which is exactly
// what the owner assertion wants (any non-401/403 status proves the guard let
// the owner in). Negative principals are rejected by the guard before the id or
// body is ever read, so the value is irrelevant to them.
export const DUMMY_UUID = "00000000-0000-0000-0000-000000000000";

export interface WriteRouteCase {
  label: string;
  path: string; // canonical route path, matched by the completeness check
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  handler: APIRoute;
  params?: Record<string, string>;
  // S-05: the availability PATCH is the first (and so far only) write a waiter
  // may perform. Omitted (default false) = the classic owner-only contract, so
  // pre-S-05 rows stay untouched. The kitchen expectation never varies: 403.
  waiterAllowed?: boolean;
}

const withId = { id: DUMMY_UUID };

// Every guarded mutating route under menu / room / staff (photo routes excluded —
// they belong to the rollout's Phase 2). Keep in sync with the completeness test.
export const WRITE_ROUTES: WriteRouteCase[] = [
  { label: "POST /api/menu/categories", path: "/api/menu/categories", method: "POST", handler: menuCategoriesPost },
  {
    label: "PUT /api/menu/categories/[id]",
    path: "/api/menu/categories/[id]",
    method: "PUT",
    handler: menuCategoryPut,
    params: withId,
  },
  {
    label: "DELETE /api/menu/categories/[id]",
    path: "/api/menu/categories/[id]",
    method: "DELETE",
    handler: menuCategoryDelete,
    params: withId,
  },
  {
    label: "PUT /api/menu/categories/reorder",
    path: "/api/menu/categories/reorder",
    method: "PUT",
    handler: menuCategoriesReorderPut,
  },
  { label: "POST /api/menu/items", path: "/api/menu/items", method: "POST", handler: menuItemsPost },
  {
    label: "PUT /api/menu/items/[id]",
    path: "/api/menu/items/[id]",
    method: "PUT",
    handler: menuItemPut,
    params: withId,
  },
  {
    label: "DELETE /api/menu/items/[id]",
    path: "/api/menu/items/[id]",
    method: "DELETE",
    handler: menuItemDelete,
    params: withId,
  },
  {
    label: "PATCH /api/menu/items/[id]/availability",
    path: "/api/menu/items/[id]/availability",
    method: "PATCH",
    handler: menuItemAvailabilityPatch,
    params: withId,
    waiterAllowed: true,
  },
  {
    label: "PUT /api/menu/items/reorder",
    path: "/api/menu/items/reorder",
    method: "PUT",
    handler: menuItemsReorderPut,
  },
  { label: "POST /api/room/rooms", path: "/api/room/rooms", method: "POST", handler: roomsPost },
  { label: "PUT /api/room/rooms/[id]", path: "/api/room/rooms/[id]", method: "PUT", handler: roomPut, params: withId },
  {
    label: "DELETE /api/room/rooms/[id]",
    path: "/api/room/rooms/[id]",
    method: "DELETE",
    handler: roomDelete,
    params: withId,
  },
  { label: "POST /api/room/tables", path: "/api/room/tables", method: "POST", handler: tablesPost },
  {
    label: "PUT /api/room/tables/[id]",
    path: "/api/room/tables/[id]",
    method: "PUT",
    handler: tablePut,
    params: withId,
  },
  {
    label: "PATCH /api/room/tables/[id]/activation",
    path: "/api/room/tables/[id]/activation",
    method: "PATCH",
    handler: tableActivationPatch,
    params: withId,
  },
  {
    label: "PATCH /api/room/tables/[id]/position",
    path: "/api/room/tables/[id]/position",
    method: "PATCH",
    handler: tablePositionPatch,
    params: withId,
  },
  // room_objects. DELETE is the one method that has no table counterpart: an object
  // carries no permanent QR code, so unlike a table it may be removed outright.
  { label: "POST /api/room/objects", path: "/api/room/objects", method: "POST", handler: objectsPost },
  {
    label: "PUT /api/room/objects/[id]",
    path: "/api/room/objects/[id]",
    method: "PUT",
    handler: objectPut,
    params: withId,
  },
  {
    label: "DELETE /api/room/objects/[id]",
    path: "/api/room/objects/[id]",
    method: "DELETE",
    handler: objectDelete,
    params: withId,
  },
  {
    label: "PATCH /api/room/objects/[id]/position",
    path: "/api/room/objects/[id]/position",
    method: "PATCH",
    handler: objectPositionPatch,
    params: withId,
  },
  {
    label: "PATCH /api/room/objects/[id]/transform",
    path: "/api/room/objects/[id]/transform",
    method: "PATCH",
    handler: objectTransformPatch,
    params: withId,
  },
  { label: "POST /api/staff", path: "/api/staff", method: "POST", handler: staffPost },
  { label: "PUT /api/staff/[id]", path: "/api/staff/[id]", method: "PUT", handler: staffPut, params: withId },
];

export interface ReadRouteCase {
  label: string;
  handler: APIRoute;
  // true → any authenticated staff may read (menu, room); false → owner-only (staff).
  allowStaff: boolean;
}

export const READ_ROUTES: ReadRouteCase[] = [
  { label: "GET /api/menu", handler: menuGet, allowStaff: true },
  { label: "GET /api/room", handler: roomGet, allowStaff: true },
  { label: "GET /api/staff", handler: staffGet, allowStaff: false },
];
