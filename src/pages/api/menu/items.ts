import type { APIRoute } from "astro";
import {
  categoryExistsInCompany,
  guardMenuRequest,
  isUniqueViolation,
  jsonData,
  jsonError,
  parseBody,
} from "@/lib/api";
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

  // A cross-tenant category_id would slip past RLS via FK validation, so verify
  // ownership before the insert. sort_order is assigned by a BEFORE INSERT
  // trigger (append at end of section) — no read-then-write race here.
  if (body.input.category_id && !(await categoryExistsInCompany(guard.supabase, body.input.category_id))) {
    return jsonError("Nie znaleziono wskazanej kategorii", 400);
  }

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
