import type { APIRoute } from "astro";
import { z } from "zod";
import { guardMenuRequest, isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { menuCategoryInputSchema } from "@/lib/schemas/menu";

export const prerender = false;

const idSchema = z.uuid();

export const PUT: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator kategorii", 400);
  }

  const body = await parseBody(context, menuCategoryInputSchema);
  if ("error" in body) {
    return body.error;
  }

  const { data, error } = await guard.supabase
    .from("menu_categories")
    .update({ name: body.input.name })
    .eq("id", id.data)
    .select("*");

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("Kategoria o tej nazwie już istnieje", 409);
    }
    return jsonError("Nie udało się zapisać kategorii", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono kategorii", 404);
  }

  return jsonData(data[0]);
};

// Physical DELETE: the FK on menu_items is ON DELETE SET NULL, so items move
// to the "Bez kategorii" section instead of blocking the delete.
export const DELETE: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator kategorii", 400);
  }

  const { data, error } = await guard.supabase.from("menu_categories").delete().eq("id", id.data).select("id");

  if (error) {
    return jsonError("Nie udało się usunąć kategorii", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono kategorii", 404);
  }

  return jsonData({ id: id.data });
};
