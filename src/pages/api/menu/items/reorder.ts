import type { APIRoute } from "astro";
import { guardMenuRequest, jsonData, jsonError, parseBody } from "@/lib/api";
import { reorderSchema } from "@/lib/schemas/menu";

export const prerender = false;

// Persist drag&drop order within one section (a category or "Bez kategorii");
// moving between categories goes through PUT items/[id] with a new category_id.
export const PUT: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, reorderSchema);
  if ("error" in body) {
    return body.error;
  }

  // One atomic statement (sort_order = position in the array) instead of N
  // per-row UPDATEs — no partial-failure corruption, no Worker subrequest fan-out.
  const { error } = await guard.supabase.rpc("reorder_menu_items", { item_ids: body.input });
  if (error) {
    return jsonError("Nie udało się zapisać kolejności pozycji", 500);
  }

  return jsonData({ ok: true });
};
