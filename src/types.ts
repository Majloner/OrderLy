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
  // The credential, unique within the company and immutable after creation.
  // null for owners, who authenticate with their real email instead.
  login: string | null;
  // Optional contact data since the staff-login change — may repeat across
  // staff in one venue, or be absent. No longer a credential.
  email: string | null;
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

// Single payload served by GET /api/room.
export interface RoomLayoutPayload {
  rooms: Room[];
  tables: RoomTable[];
}
