import type { APIRoute } from "astro";
import { guardMenuRequest, jsonData, jsonError, parseBody } from "@/lib/api";
import { reorderSchema } from "@/lib/schemas/menu";

export const prerender = false;

// Persist drag&drop order: sort_order = position in the submitted id array.
// One atomic RPC; ids outside the owner's company match zero rows under RLS.
export const PUT: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, reorderSchema);
  if ("error" in body) {
    return body.error;
  }

  const { error } = await guard.supabase.rpc("reorder_menu_categories", { category_ids: body.input });
  if (error) {
    return jsonError("Nie udało się zapisać kolejności kategorii", 500);
  }

  return jsonData({ ok: true });
};
