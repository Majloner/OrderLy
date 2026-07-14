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

  // Append at the end; drag&drop reorder owns the final ordering.
  const { data: last } = await guard.supabase
    .from("menu_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { data, error } = await guard.supabase
    .from("menu_categories")
    .insert({
      company_id: guard.companyId,
      name: body.input.name,
      sort_order: (last?.sort_order ?? 0) + 1,
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
