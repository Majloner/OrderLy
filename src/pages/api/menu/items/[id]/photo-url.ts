import type { APIRoute } from "astro";
import { z } from "zod";
import { guardMenuRequest, itemExistsInCompany, jsonData, jsonError, parseBody } from "@/lib/api";
import { mintPhotoUploadUrls } from "@/lib/storage";
import { photoUploadRequestSchema } from "@/lib/schemas/menu";

export const prerender = false;

const idSchema = z.uuid();

// Owner-only: mint signed upload URLs for an item's full + thumbnail objects.
// Authorization is enforced here (owner guard + item-in-company + server-built
// path); the signed URLs are minted with the service role because Storage does
// not honor the user JWT for RLS in this project. The browser PUTs the blobs
// straight to the returned URLs, so bytes bypass the Worker.
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

  const urls = await mintPhotoUploadUrls(`${guard.companyId}/${id.data}`);
  if (!urls) {
    return jsonError("Nie udało się przygotować przesyłania zdjęcia", 500);
  }

  return jsonData({ full: { signedUrl: urls.full }, thumb: { signedUrl: urls.thumb } });
};
