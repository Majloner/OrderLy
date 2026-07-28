// Shared domain types for the menu model (S-03). Mirrors the DB shape from
// supabase/migrations/20260708124756_menu_categories_items.sql.

export const AVAILABILITY = ["available", "unavailable", "sold_out"] as const;

export type MenuItemAvailability = (typeof AVAILABILITY)[number];

export const AVAILABILITY_LABELS: Record<MenuItemAvailability, string> = {
  available: "Dostępne",
  unavailable: "Niedostępne",
  sold_out: "Wyprzedane",
};

// The 14 EU allergens (Regulation 1169/2011); slugs match the public.allergen enum.
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: "Zboża zawierające gluten",
  crustaceans: "Skorupiaki",
  eggs: "Jaja",
  fish: "Ryby",
  peanuts: "Orzeszki ziemne",
  soybeans: "Soja",
  milk: "Mleko (w tym laktoza)",
  nuts: "Orzechy",
  celery: "Seler",
  mustard: "Gorczyca",
  sesame: "Nasiona sezamu",
  sulphites: "Dwutlenek siarki i siarczyny",
  lupin: "Łubin",
  molluscs: "Mięczaki",
};

export interface MenuCategory {
  id: string;
  company_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  availability: MenuItemAvailability;
  allergens: Allergen[];
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  // Base Storage path `{company_id}/{id}`; full/thumb objects live at
  // `${photo_path}/full.webp` and `${photo_path}/thumb.webp`. null = no photo.
  photo_path: string | null;
  // Cache-bust token bumped whenever the photo bytes change.
  photo_updated_at: string | null;
}

// Single payload served by GET /api/menu (and the S-05 polling target).
export interface MenuPayload {
  categories: MenuCategory[];
  items: MenuItem[];
}

// --- Staff (S-02) -----------------------------------------------------------
// Mirrors public.staff_role and the profiles row shape after
// supabase/migrations/20260727220415_staff_accounts_roles.sql.

export const STAFF_ROLES = ["owner", "waiter", "kitchen"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

// Roles the owner may assign. `owner` is deliberately excluded: it belongs to
// the account that registered the company and is not grantable (enforced by
// profiles_insert_owner's `role <> 'owner'` and the self-change trigger).
export const STAFF_ASSIGNABLE_ROLES = ["waiter", "kitchen"] as const;

export type AssignableStaffRole = (typeof STAFF_ASSIGNABLE_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Właściciel",
  waiter: "Kelner",
  kitchen: "Kuchnia",
};

export interface StaffMember {
  user_id: string;
  company_id: string;
  email: string;
  full_name: string | null;
  role: StaffRole;
  // null = active. Set to a timestamp, both resolvers return NULL for this
  // user and every RLS policy in the schema default-denies them.
  deactivated_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Room layout model (S-06). Mirrors the DB shape from
// supabase/migrations/20260727120000_room_layout_tables.sql.
// ---------------------------------------------------------------------------

export const TABLE_SHAPES = ["square", "circle", "rectangle"] as const;

export type TableShape = (typeof TABLE_SHAPES)[number];

export const TABLE_SHAPE_LABELS: Record<TableShape, string> = {
  square: "Kwadratowy",
  circle: "Okrągły",
  rectangle: "Prostokątny",
};

export interface Room {
  id: string;
  company_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

// Named RoomTable rather than Table to avoid colliding with a future shadcn
// `table` component; the DB relation is public.tables.
export interface RoomTable {
  id: string;
  company_id: string;
  room_id: string;
  // Primary identifier of a table within the company (FR-010), unique per company.
  number: number;
  label: string | null;
  shape: TableShape;
  // Logical canvas coordinates (see src/lib/room-geometry.ts), NOT rendered
  // pixels — the canvas scales the logical space to its container.
  pos_x: number;
  pos_y: number;
  // Deactivation is the only lifecycle control: a table is never deleted, so
  // the permanent QR code from S-07 stays valid (FR-009).
  is_active: boolean;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Room furnishing objects. A separate relation from `tables` on purpose — the
// two differ in the one way that matters most: an object CAN be deleted. No QR
// code is ever pinned to a chair, so the "deactivate, never delete" guardrail
// that shapes `tables` (no delete policy in RLS at all) does not apply here.
// Objects also carry their own width/height instead of a fixed per-shape
// footprint, carry a free rotation, and have no guest-visible number.
// ---------------------------------------------------------------------------

export const ROOM_OBJECT_KINDS = [
  "wall",
  "chair",
  "door",
  "window",
  "bar",
  "plant",
  "stairs",
  "toilet",
  "till",
] as const;

export type RoomObjectKind = (typeof ROOM_OBJECT_KINDS)[number];

export const ROOM_OBJECT_KIND_LABELS: Record<RoomObjectKind, string> = {
  wall: "Ściana",
  chair: "Krzesło",
  door: "Drzwi",
  window: "Okno",
  bar: "Bar",
  plant: "Roślina",
  stairs: "Schody",
  toilet: "Toaleta",
  till: "Kasa",
};

export interface RoomObject {
  id: string;
  company_id: string;
  room_id: string;
  kind: RoomObjectKind;
  label: string | null;
  // CAUTION: unlike RoomTable, these are the object's CENTRE, not its top-left
  // corner. Rotation happens about the centre, and clamping a rotated rectangle
  // by its corner would yield legitimate NEGATIVE coordinates (a wall rotated
  // 90° and pushed left has its unrotated corner off-canvas) — values no sane
  // zod bound or CHECK constraint would accept. See src/lib/room-geometry.ts.
  pos_x: number;
  pos_y: number;
  // Logical pixels, per-row rather than derived from a shape: a wall is a long
  // thin rectangle and a chair is a small square.
  width: number;
  height: number;
  // Degrees, 0-359. Free rather than quarter-turns so bars and walls can sit at
  // an angle; the clamp accounts for the rotated bounding box.
  rotation: number;
  created_at: string;
}

// Single payload served by GET /api/room.
export interface RoomLayoutPayload {
  rooms: Room[];
  tables: RoomTable[];
  objects: RoomObject[];
}
