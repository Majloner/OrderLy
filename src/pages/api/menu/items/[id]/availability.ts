import type { APIRoute } from "astro";
import { z } from "zod";
import { guardMenuRequest, jsonData, jsonError, parseBody } from "@/lib/api";
import { menuItemAvailabilitySchema } from "@/lib/schemas/menu";

export const prerender = false;

const idSchema = z.uuid();

// FR-007 (S-05): the waiter's availability toggle, as a single-field write.
// Deliberately NOT the full PUT: rebuilding the whole body from client state
// lets a stale tab silently revert someone else's edit (impl-review F5) — and
// here it would also hand the waiter columns the PRD forbids them. The route
// admits owner+waiter; the menu_items_guard_staff_columns trigger is the hard
// enforcement that a non-owner changes availability and nothing else.
export const PATCH: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: "availability" });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator pozycji", 400);
  }

  const body = await parseBody(context, menuItemAvailabilitySchema);
  if ("error" in body) {
    return body.error;
  }

  const { data, error } = await guard.supabase
    .from("menu_items")
    .update({ availability: body.input.availability })
    .eq("id", id.data)
    .is("archived_at", null)
    .select("*");

  if (error) {
    return jsonError("Nie udało się zmienić dostępności pozycji", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  return jsonData(data[0]);
};
