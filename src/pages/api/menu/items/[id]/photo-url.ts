import type { APIRoute } from "astro";
import { z } from "zod";
import { guardMenuRequest, itemExistsInCompany, jsonData, jsonError, parseBody } from "@/lib/api";
import { photoUploadRequestSchema } from "@/lib/schemas/menu";

export const prerender = false;

const BUCKET = "menu-photos";
const idSchema = z.uuid();

// Owner-only: mint signed upload URLs for an item's full + thumbnail objects.
// The RLS INSERT policy on storage.objects is evaluated here, in the owner's
// tenant context, and each token is bound to its exact server-built path — so
// the browser upload needs no session and can't target another tenant's prefix.
export const POST: APIRoute = async (context) => {
  const guard = guardMenuRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator pozycji", 400);
  }

  const body = await parseBody(context, photoUploadRequestSchema);
  if ("error" in body) {
    return body.error;
  }

  if (!(await itemExistsInCompany(guard.supabase, id.data))) {
    return jsonError("Nie znaleziono pozycji", 404);
  }

  const base = `${guard.companyId}/${id.data}`;
  const [full, thumb] = await Promise.all([
    guard.supabase.storage.from(BUCKET).createSignedUploadUrl(`${base}/full.webp`, { upsert: true }),
    guard.supabase.storage.from(BUCKET).createSignedUploadUrl(`${base}/thumb.webp`, { upsert: true }),
  ]);

  if (full.error || thumb.error) {
    return jsonError("Nie udało się przygotować przesyłania zdjęcia", 500);
  }

  return jsonData({
    path: base,
    full: { path: full.data.path, token: full.data.token },
    thumb: { path: thumb.data.path, token: thumb.data.token },
  });
};
