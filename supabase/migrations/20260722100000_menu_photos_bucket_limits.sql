-- Enforce photo upload constraints at the Storage layer (impl-review F1).
-- The browser PUTs bytes straight to the signed URL, so the zod caps in the
-- mint request are only advisory. Constrain the bucket itself so Storage
-- rejects oversized or non-WebP uploads regardless of the client.
--   file_size_limit: 2 MB (matches the full-image budget; thumbs are far under)
--   allowed_mime_types: image/webp only (the client always encodes WebP)
update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/webp']
where id = 'menu-photos';
