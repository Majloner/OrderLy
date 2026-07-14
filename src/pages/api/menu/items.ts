import type { APIRoute } from "astro";
import { guardMenuRequest, isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
import { menuItemInputSchema } from "@/lib/schemas/menu";
import type { MenuItem } from "@/types";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, menuItemInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // Append at the end of the target section (a category or "Bez kategorii").
  let lastQuery = guard.supabase
    .from("menu_items")
    .select("sort_order")
    .is("archived_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  lastQuery = body.input.category_id
    ? lastQuery.eq("category_id", body.input.category_id)
    : lastQuery.is("category_id", null);
  const { data: last } = await lastQuery.maybeSingle<{ sort_order: number }>();

  const { data, error } = await guard.supabase
    .from("menu_items")
    .insert({
      company_id: guard.companyId,
      name: body.input.name,
      description: body.input.description,
      price: body.input.price,
      category_id: body.input.category_id,
      availability: body.input.availability,
      allergens: body.input.allergens,
      sort_order: (last?.sort_order ?? 0) + 1,
    })
    .select("*")
    .single<MenuItem>();

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("Pozycja o tej nazwie już istnieje", 409);
    }
    return jsonError("Nie udało się utworzyć pozycji", 500);
  }

  return jsonData(data, 201);
};
