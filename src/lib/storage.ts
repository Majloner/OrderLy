import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

// Server-side Storage operations for menu photos. Supabase Storage does not
// honor the signed-in user's JWT for RLS in this project (PostgREST does, but
// the Storage service rejects it and falls back to anon), so signing/removing
// runs with the service-role key, which bypasses RLS. This is safe because the
// calling API route authorizes every request (owner guard + itemExistsInCompany
// + a server-built {company_id}/{item_id} path the client cannot forge). Image
// bytes never pass through here — the browser PUTs them to the signed URL.

const BUCKET = "menu-photos";

function admin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Absolute signed upload URLs (host + token) for an item's full + thumb objects.
export async function mintPhotoUploadUrls(base: string): Promise<{ full: string; thumb: string } | null> {
  const client = admin();
  if (!client) {
    return null;
  }
  const [full, thumb] = await Promise.all([
    client.storage.from(BUCKET).createSignedUploadUrl(`${base}/full.webp`, { upsert: true }),
    client.storage.from(BUCKET).createSignedUploadUrl(`${base}/thumb.webp`, { upsert: true }),
  ]);
  if (full.error || thumb.error) {
    return null;
  }
  return { full: full.data.signedUrl, thumb: thumb.data.signedUrl };
}

// Best-effort removal of an item's photo objects.
export async function removePhotoObjects(base: string): Promise<void> {
  const client = admin();
  if (!client) {
    return;
  }
  await client.storage.from(BUCKET).remove([`${base}/full.webp`, `${base}/thumb.webp`]);
}
