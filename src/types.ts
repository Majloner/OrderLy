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
}

// Single payload served by GET /api/menu (and the S-05 polling target).
export interface MenuPayload {
  categories: MenuCategory[];
  items: MenuItem[];
}
