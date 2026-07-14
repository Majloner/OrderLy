import type { APIRoute } from "astro";
import { guardMenuRequest, jsonData, jsonError, parseBody } from "@/lib/api";
import { reorderSchema } from "@/lib/schemas/menu";

export const prerender = false;

// Persist drag&drop order: sort_order = position in the submitted id array.
// Ids outside the owner's company match zero rows under RLS — harmless no-op.
export const PUT: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, reorderSchema);
  if ("error" in body) {
    return body.error;
  }

  const results = await Promise.all(
    body.input.map((id, index) =>
      guard.supabase
        .from("menu_categories")
        .update({ sort_order: index + 1 })
        .eq("id", id),
    ),
  );

  if (results.some((result) => result.error)) {
    return jsonError("Nie udało się zapisać kolejności kategorii", 500);
  }

  return jsonData({ ok: true });
};
