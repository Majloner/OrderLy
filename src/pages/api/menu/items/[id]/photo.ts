import type { APIRoute } from "astro";
import { z } from "zod";
import { guardMenuRequest, itemExistsInCompany, jsonData, jsonError } from "@/lib/api";
import type { MenuItem } from "@/types";

export const prerender = false;

const BUCKET = "menu-photos";
const idSchema = z.uuid();

// Attach a photo to an item AFTER the browser has uploaded full.webp + thumb.webp
// to `{company_id}/{id}` via the signed URLs. The path is built server-side
// (never trusted from the client); photo_updated_at bumps the cache-bust token.
export const PUT: APIRoute = async (context) => {
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
    .update({ photo_path: `${guard.companyId}/${id.data}`, photo_updated_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("archived_at", null)
    .select("*");

  if (error) {
    return jsonError("Nie udało się zapisać zdjęcia", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  return jsonData(data[0] as MenuItem);
};

// Remove an item's photo: clear the reference and delete both Storage objects.
export const DELETE: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator pozycji", 400);
  }

  if (!(await itemExistsInCompany(guard.supabase, id.data))) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  const base = `${guard.companyId}/${id.data}`;
  // Clear the reference first, then delete objects (owner DELETE policy scopes
  // removal to the caller's own prefix). Leftover objects on a failed remove are
  // harmless — the row no longer points at them.
  const { error } = await guard.supabase
    .from("menu_items")
    .update({ photo_path: null, photo_updated_at: null })
    .eq("id", id.data);

  if (error) {
    return jsonError("Nie udało się usunąć zdjęcia", 500);
  }

  await guard.supabase.storage.from(BUCKET).remove([`${base}/full.webp`, `${base}/thumb.webp`]);

  return jsonData({ id: id.data });
};
