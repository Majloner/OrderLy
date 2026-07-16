import type { APIRoute } from "astro";
import { guardMenuRequest, isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { menuCategoryInputSchema } from "@/lib/schemas/menu";
import type { MenuCategory } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, menuCategoryInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // sort_order is assigned by a BEFORE INSERT trigger (append at end); drag&drop
  // reorder owns the final ordering afterwards.
  const { data, error } = await guard.supabase
    .from("menu_categories")
    .insert({
      company_id: guard.companyId,
      name: body.input.name,
    })
    .select("*")
    .single<MenuCategory>();

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("Kategoria o tej nazwie już istnieje", 409);
    }
    return jsonError("Nie udało się utworzyć kategorii", 500);
  }

  return jsonData(data, 201);
};
