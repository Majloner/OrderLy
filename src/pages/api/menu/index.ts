import type { APIRoute } from "astro";
import { guardMenuRequest, jsonData, jsonError } from "@/lib/api";

export const prerender = false;

// Whole-staff read: one payload for the /menu island and the future S-05 polling.
export const GET: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: false });
  if ("error" in guard) {
    return guard.error;
  }

  const [categories, items] = await Promise.all([
    guard.supabase.from("menu_categories").select("*").order("sort_order").order("name"),
    guard.supabase.from("menu_items").select("*").is("archived_at", null).order("sort_order").order("name"),
  ]);

  if (categories.error || items.error) {
    return jsonError("Nie udało się pobrać menu", 500);
  }

  return jsonData({ categories: categories.data, items: items.data });
};
