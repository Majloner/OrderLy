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
