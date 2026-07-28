import type { APIRoute } from "astro";
import { z } from "zod";
import { guardMenuRequest, jsonData, jsonError } from "@/lib/api";
import { removePhotoObjects } from "@/lib/storage";
import type { MenuItem } from "@/types";

export const prerender = false;

const idSchema = z.uuid();

// Attach a photo to an item AFTER the browser has uploaded full.webp + thumb.webp
// to `{company_id}/{id}`. The path is built server-side (never trusted from the
// client); photo_updated_at bumps the cache-bust token.
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

// Clear an item's photo: null the row reference, then best-effort remove the
// Storage objects server-side with the service role (see removePhotoObjects).
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
    .update({ photo_path: null, photo_updated_at: null })
    .eq("id", id.data)
    .select("id");

  if (error) {
    return jsonError("Nie udało się usunąć zdjęcia", 500);
  }
  if (data.length === 0) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  // Best-effort object cleanup (service role); the row already dropped the ref.
  await removePhotoObjects(`${guard.companyId}/${id.data}`);

  return jsonData({ id: id.data });
};
