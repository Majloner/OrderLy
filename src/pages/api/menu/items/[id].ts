import type { APIRoute } from "astro";
import { z } from "zod";
import {
  categoryExistsInCompany,
  guardMenuRequest,
  isUniqueViolation,
  jsonData,
  jsonError,
  parseBody,
} from "@/lib/api";
import { menuItemInputSchema } from "@/lib/schemas/menu";

export const prerender = false;

const idSchema = z.uuid();

export const PUT: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator pozycji", 400);
  }

  const body = await parseBody(context, menuItemInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // Reject a category_id that isn't in the caller's company (RLS-bypassing FK).
  if (body.input.category_id && !(await categoryExistsInCompany(guard.supabase, body.input.category_id))) {
    return jsonError("Nie znaleziono wskazanej kategorii", 400);
  }

  const { data, error } = await guard.supabase
    .from("menu_items")
    .update({
      name: body.input.name,
      description: body.input.description,
      price: body.input.price,
      category_id: body.input.category_id,
      availability: body.input.availability,
      allergens: body.input.allergens,
    })
    .eq("id", id.data)
    .is("archived_at", null)
    .select("*");

  if (error) {
    if (isUniqueViolation(error)) {
      return jsonError("Pozycja o tej nazwie już istnieje", 409);
    }
    return jsonError("Nie udało się zapisać pozycji", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  return jsonData(data[0]);
};

// Soft delete: archive instead of DELETE so future order history (S-08) keeps
// valid references. Archived items disappear from GET /api/menu.
export const DELETE: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator pozycji", 400);
  }

  const { data, error } = await guard.supabase
    .from("menu_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("archived_at", null)
    .select("id");

  if (error) {
    return jsonError("Nie udało się zarchiwizować pozycji", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  return jsonData({ id: id.data });
};
