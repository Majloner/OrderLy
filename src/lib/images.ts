// Client-side image handling for menu photos (S-04). Thumbnails are generated
// in the browser (WebP) because sharp does not run on workerd and Supabase
// image transforms require a paid plan. Runs only inside the /menu island.

export const MENU_PHOTOS_BUCKET = "menu-photos";
export const FULL_MAX_DIMENSION = 1600;
export const THUMB_MAX_DIMENSION = 400;
const WEBP_QUALITY = 0.8;

export interface ResizedPhoto {
  full: Blob;
  thumb: Blob;
}

// Produce a full-size and a thumbnail WebP from a picked image file. The library
// is dynamically imported so it never weighs on the public menu-browsing bundle;
// it handles EXIF orientation and runs off the main thread via a web worker.
export async function resizeForUpload(file: File): Promise<ResizedPhoto> {
  const { default: imageCompression } = await import("browser-image-compression");
  const common = {
    fileType: "image/webp",
    initialQuality: WEBP_QUALITY,
    useWebWorker: true,
    preserveExif: false, // orientation is baked in during canvas resize
  } as const;

  const [full, thumb] = await Promise.all([
    imageCompression(file, { ...common, maxWidthOrHeight: FULL_MAX_DIMENSION }),
    imageCompression(file, { ...common, maxWidthOrHeight: THUMB_MAX_DIMENSION }),
  ]);
  return { full, thumb };
}

// Upload a blob to an absolute Supabase signed upload URL (token in the URL).
// Mirrors storage-js uploadToSignedUrl's multipart body so no client SDK/key is
// needed; bytes go straight to Storage, bypassing the Worker.
export async function putSignedBlob(signedUrl: string, blob: Blob): Promise<void> {
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", blob, "photo.webp");
  const response = await fetch(signedUrl, { method: "PUT", headers: { "x-upsert": "true" }, body: form });
  if (!response.ok) {
    throw new Error(`Nie udało się przesłać zdjęcia (${response.status})`);
  }
}

// Public CDN URL for a stored menu photo variant, cache-busted by the row's
// photo_updated_at so a replaced image refreshes immediately.
export function publicPhotoUrl(
  supabaseUrl: string,
  photoPath: string,
  variant: "full" | "thumb",
  version: string | null,
): string {
  const base = `${supabaseUrl}/storage/v1/object/public/menu-photos/${photoPath}/${variant}.webp`;
  return version ? `${base}?v=${Date.parse(version)}` : base;
}
