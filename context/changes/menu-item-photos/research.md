---
date: 2026-07-21T00:00:00Z
researcher: Intebuco_Milosz
git_commit: b591c7a02e7102d55106d413ddb0d70456569de9
branch: chore/migrate-dotnet-to-astro
repository: Majloner/OrderLy
topic: "S-04 menu-item-photos — storing food photos + thumbnail generation"
tags: [research, codebase, menu, storage, images, cloudflare, supabase]
status: complete
last_updated: 2026-07-21
last_updated_by: Intebuco_Milosz
---

# Research: S-04 menu-item-photos

**Date**: 2026-07-21
**Researcher**: Intebuco_Milosz
**Git Commit**: b591c7a02e7102d55106d413ddb0d70456569de9
**Branch**: chore/migrate-dotnet-to-astro
**Repository**: Majloner/OrderLy

## Research Question

How to implement S-04 (`menu-item-photos`, PRD US-02 / FR-005): owner adds a food photo to a
menu item and the system generates a thumbnail shown in the item list — on Astro 6 SSR / Cloudflare
Workers (workerd, **no `sharp`**) + Supabase Storage, under a **$0 / free-tier** priority. Settle the
roadmap's open Unknown: how to generate thumbnails when `sharp` can't run on the edge.

Scope agreed with user: keep **$0** (client-side resize as the leading candidate, paid transforms as
plan B); output a full research doc as input to `/10x-plan`.

## Summary

**Recommendation: generate the thumbnail client-side in the browser** (`browser-image-compression`,
Canvas → WebP), upload **two objects** (full + thumbnail) to a **public Supabase Storage bucket** via
**signed upload URLs** minted by an authenticated Astro API route, and persist a `photo_path` (or full
+ thumb URLs) on `menu_items`. This is the only option that is simultaneously **$0**, free of any
external image service, and free of workerd exposure — it directly neutralizes the infra risk
"thumbnails can't use `sharp` on the edge" (FR-005) with zero server-side image processing.

Decision drivers:
- **`sharp` does not run on workerd** — server-side generation on the edge is impossible
  (`context/foundation/infrastructure.md:84`, risk register `:123`).
- **Supabase image transformations are Pro-plan only (~$25/mo)** — verified on the pricing page
  2026-07-21; fails the $0 priority. (`supabase/config.toml:125` already noted this.)
- **Cloudflare Images now has a $0 tier** (5,000 unique transforms/month, works with an external
  origin) — a genuine plan-B, but needs a configured CF zone + Supabase added as an allowed source
  origin, i.e. non-trivial edge config for one thumbnail size.
- Client-side keeps the full-res original in Storage, so switching to CF Images or Supabase transforms
  later is a **non-destructive, additive** change — the only lock-in is the "one baked thumbnail size"
  limitation.

## Detailed Findings

### 1. Data model + integration points (current codebase)

- **`menu_items` has no photo column yet** — extend via ALTER (never re-CREATE), following the S-03
  pattern at [supabase/migrations/20260708124756_menu_categories_items.sql:76](supabase/migrations/20260708124756_menu_categories_items.sql). A nullable text column (`photo_path` or `image_url` + `thumbnail_url`) has no policy/enum dependency, so no "detach dependencies" dance.
- **Anon read is already covered**: policy `menu_items_anon_read_visible` ([:106](supabase/migrations/20260708124756_menu_categories_items.sql)) is `select *` for `to anon`, so a new image column is automatically readable by the future S-08 anon client menu — no policy change.
- **Owner writes already covered**: `menu_items_insert_owner` / `menu_items_update_owner` ([:123](supabase/migrations/20260708124756_menu_categories_items.sql)) gate on `current_company_id()` + owner role. A photo path written through the existing POST/PUT rides these — no new DB policy for the row.
- **Types**: add the field to `MenuItem` at [src/types.ts:59](src/types.ts) (free-form URL/path → no new label/const map). Propagates to `MenuPayload` ([:74](src/types.ts)) automatically.
- **API is explicit allow-list**: [src/pages/api/menu/items.ts:33](src/pages/api/menu/items.ts) (insert) and [src/pages/api/menu/items/[id].ts:38](src/pages/api/menu/items/[id].ts) (update) build the row field-by-field — a photo field must be added to the schema AND these objects.
- **`parseBody` and `callMenuApi` are JSON-only** ([src/lib/api.ts:63](src/lib/api.ts), [src/components/hooks/useMenu.ts:11](src/components/hooks/useMenu.ts)) — they can carry a **string URL/path**, not a binary file. A file upload is net-new (see §3: solved by signed upload URL, so the JSON path still carries just the resulting path).
- **UI attach points**: photo picker in the form at [src/components/menu/MenuItemDialog.tsx:134](src/components/menu/MenuItemDialog.tsx) (near the description block); thumbnail render at the start of the row at [src/components/menu/MenuItemRow.tsx:52](src/components/menu/MenuItemRow.tsx).
- **Zod**: `menuItemInputSchema` at [src/lib/schemas/menu.ts:17](src/lib/schemas/menu.ts) — copy the `description` nullish→null pattern for an optional `photo_path`/`image_url`.
- **No existing storage/upload/multipart code anywhere** — the only `formData()` ([src/pages/api/company/profile.ts:12](src/pages/api/company/profile.ts)) reads text fields only.

### 2. Storage + upload + bucket security (Supabase, on workerd)

- **Bucket**: one **public** bucket `menu-photos`, objects keyed by immutable UUID path
  `{company_id}/{item_id}/full.webp` and `.../thumb.webp`. UUID keys mean **renames never move objects**
  and re-upload with `upsert:true` overwrites in place.
- **Public vs private**: public bucket recommended. Food photos aren't sensitive; the anon QR client
  (S-08) just renders them via `getPublicUrl()` (a pure string builder — no listing). A **private +
  signed-URL** approach would cost a signed-URL call per photo per render (CPU + subrequests against
  the free-tier 10ms budget) and — crucially — **cannot actually be company-scoped for anon** (anon
  carries no `current_company_id()`; the company is resolved at runtime from the scanned table, which
  plain RLS can't see). So private buys no real tenant scoping here, only cost.
- **Lesson reconciliation** ([[anon-rls-reads-must-be-scoped-by-company-id]], `context/foundation/lessons.md`):
  the lesson targets DB-*table* anon reads where `using(true)` lets anon enumerate every tenant's rows.
  The Storage equivalent leak is **object listing**, which a public bucket does **not** expose without
  an explicit anon SELECT/list policy. Mitigation: grant anon **no** SELECT policy on `storage.objects`;
  reads go through the CDN by exact UUID path. Record this as a conscious, lesson-aware trade-off in the plan.
- **Storage RLS** (`storage.objects`, path via `storage.foldername(name)`): owner-only INSERT/UPDATE/DELETE
  scoped to `(storage.foldername(name))[1] = current_company_id()::text AND current_staff_role() = 'owner'`,
  mirroring the tenancy helpers in [supabase/migrations/20260705212949_tenancy_core.sql](supabase/migrations/20260705212949_tenancy_core.sql). **No anon SELECT policy.** (Full SQL sketch in Appendix A.)
- **Upload flow (recommended): direct browser → Storage via signed upload URL.** Do NOT proxy image
  bytes through the Worker (avoids CPU/memory/body-size limits). An Astro route
  (`POST /api/menu/items/[id]/photo-url`, `prerender=false`, owner-guarded via `guardMenuRequest`)
  mints `createSignedUploadUrl(...)` for both `full.webp` and `thumb.webp` using
  `context.locals.supabase` — **RLS INSERT policy is evaluated at URL-generation time and the token is
  bound to the exact path**, so tenant isolation holds and the browser upload needs no session. Browser
  then `uploadToSignedUrl(path, token, blob)`. The item row's `photo_path` is persisted through the
  existing owner-only JSON PUT.
- **App has only the anon-key SSR client** ([src/lib/supabase.ts](src/lib/supabase.ts)) — no service-role
  client. The signed-URL flow deliberately stays within RLS, so no service role is needed.
- **Lifecycle**: replace = re-upload same path (`upsert`); rename = no-op (UUID path); archive
  (soft-delete) = keep objects (reversible, cheap); hard "remove photo" = `storage.remove([...])` under
  the owner DELETE policy. Note: public-CDN caching may serve a stale image after overwrite — use a
  cache-busting query param or versioned filename if instant refresh matters.

### 3. Thumbnail strategy decision (external research, verified 2026-07-21)

| Strategy | Cost (current) | Quality | workerd fit | Complexity | Re-derive sizes later? |
|---|---|---|---|---|---|
| **1. Client-side resize** (browser-image-compression → WebP) | **$0**, no external dep | Good | Perfect (nothing on server) | Low–Med | ❌ No |
| **2. Supabase transforms** (`render/image?width=`) | **~$25/mo** (Pro-only) + $5/1k origin imgs | Very good (auto-WebP, no AVIF yet) | Excellent (just a URL) | Very low | ✅ Yes |
| **3. Cloudflare Images** (transform from external origin) | **$0** ≤5k unique transf/mo, then $0.50/1k | Best (WebP + AVIF) | First-party (Images binding) | Med (needs CF zone + Supabase as allowed origin) | ✅ Yes |

- **Client-side library**: `browser-image-compression` (MIT) — off-main-thread via `useWebWorker:true`,
  handles **EXIF orientation** (`preserveExif` / `getExifOrientation`) so phone photos upload
  rightside-up (the main reason to use a lib over hand-rolled Canvas). Options `maxWidthOrHeight`
  (e.g. 400 thumb / 1600 full), `maxSizeMB`, `fileType:'image/webp'`. Lazy-load via dynamic `import()`
  in the upload island only, so it never touches the public menu-browsing bundle.
- **Format**: encode **WebP** (`canvas.toBlob('image/webp')`) — universal in current browsers. **AVIF
  encoding is NOT available client-side** (browsers decode but can't `toBlob('image/avif')`); JPEG as
  universal fallback.
- **Client-side downsides (accept for MVP)**: no server source of truth for derived sizes — can't add
  new thumbnail sizes later without re-processing/re-upload; trust client output (validate content-type
  + size server-side). Mobile memory risk on huge photos (mitigate: `maxWidthOrHeight`, web-worker mode).
- **Why not the paid/edge options now**: Supabase transforms fail $0 outright. CF Images is $0 but adds
  a CF zone + allowed-origin config (a second edge moving part) during an in-flux .NET→Astro migration —
  avoidable for one thumbnail size.

## Code References

- `supabase/migrations/20260708124756_menu_categories_items.sql:76` — ALTER pattern for the new photo column
- `supabase/migrations/20260708124756_menu_categories_items.sql:106` — anon read policy (auto-covers new column)
- `supabase/migrations/20260708124756_menu_categories_items.sql:123` — owner write policies
- `supabase/migrations/20260705212949_tenancy_core.sql` — `current_company_id()` / `current_staff_role()` helpers for Storage RLS
- `src/types.ts:59` — `MenuItem` interface (add photo field)
- `src/lib/schemas/menu.ts:17` — `menuItemInputSchema` (add optional photo field, copy `description` pattern)
- `src/pages/api/menu/items.ts:33` / `src/pages/api/menu/items/[id].ts:38` — explicit insert/update objects
- `src/lib/api.ts:29` — `guardMenuRequest` (reuse for the photo-url endpoint); `:63` `parseBody` JSON-only
- `src/lib/supabase.ts` / `src/middleware.ts` — anon-key SSR client in `locals.supabase` (no service role)
- `src/components/menu/MenuItemDialog.tsx:134` — photo picker attach point
- `src/components/menu/MenuItemRow.tsx:52` — thumbnail render attach point
- `src/components/hooks/useMenu.ts:11` — `callMenuApi` JSON-only (photo path travels as a string)

## Architecture Insights

- **String-URL/path approach keeps S-04 mostly within the S-03 JSON pipeline** — the only binary hop is
  browser → Storage via signed URL; the DB row still carries a plain path through the existing
  owner-only JSON PUT. Minimal net-new surface: one ALTER migration, one storage-RLS migration, one
  signed-URL endpoint, form + row UI, schema/type field.
- **RLS-at-signed-URL-generation** is the load-bearing security property: it lets an anon-key-only app
  enforce owner + company tenant isolation on uploads without a service role.
- **Keep the full-res original** — it's the escape hatch that makes any later switch to server/edge
  transforms additive rather than a rewrite.

## Historical Context (from prior changes)

- `context/foundation/infrastructure.md:84` — "Image thumbnails (FR-005) can't use `sharp` — route through Cloudflare Images (paid) or Supabase Storage transforms."
- `context/foundation/infrastructure.md:123` (risk register) — "Decide up front: Supabase Storage image transforms (preferred — co-located) or Cloudflare Images; do NOT plan a server-side `sharp` step." (Note: this research revises "preferred" — Supabase transforms are Pro-only/$25, so client-side is preferred under $0.)
- `context/foundation/infrastructure.md:82` — free-tier ceiling is **10ms CPU/invocation**, informing the "don't proxy bytes through the Worker" decision.
- `context/foundation/prd.md:140` — FR-005 must-have; `:141` Socrates note: thumbnails kept (20+ photo menu loads slowly on mobile without them); `:66` success metric ≥80% items have a photo; `:108` "added photo generates a thumbnail used in the item list".
- `context/archive/2026-07-08-menu-items-management/` — S-03 delivered the `menu_items` model + `/menu` island this builds on.
- `context/foundation/lessons.md` — [[anon-rls-reads-must-be-scoped-by-company-id]] (reconciled for Storage in §2).

## Related Research

- `context/foundation/infrastructure.md` — platform choice + risk register (Cloudflare Workers).
- No prior `research.md` artifacts exist for other changes (S-01/S-03 shipped without a research phase).

## Open Questions

- **Column shape**: single `photo_path` (derive full/thumb URLs by convention) vs two explicit columns
  `image_url` + `thumbnail_url`. Path-based is leaner; two columns are more explicit for the anon client.
  Decide in `/10x-plan`.
- **Full-image max dimension / quality budget** (e.g. 1600px / 0.8) and **thumbnail size** (e.g. 400px) —
  tune for mobile payload vs quality; PRD wants fast mobile menu loads.
- **Upload UX**: replace-in-place vs preview-before-save; progress + cancel (`browser-image-compression`
  supports `onProgress` + `AbortController`).
- **Cache-busting** on photo replace (public CDN) — query param vs versioned filename.
- **Server-side validation** of client-produced blobs (content-type allow-list, max size) since we trust
  the browser output.
- **CF zone / custom domain**: not needed for client-side, but a prerequisite if a future slice adopts
  Cloudflare Images — worth noting when/if S-04's "one baked size" limitation bites.

## Appendix A — Storage RLS sketch (from R2)

```sql
-- public bucket: insert into storage.buckets (id, name, public) values ('menu-photos','menu-photos', true);

create policy "menu_photos_insert_owner" on storage.objects for insert to authenticated
with check (
  bucket_id = 'menu-photos'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.current_staff_role() = 'owner'
);

create policy "menu_photos_update_owner" on storage.objects for update to authenticated
using (
  bucket_id = 'menu-photos'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.current_staff_role() = 'owner'
)
with check (
  bucket_id = 'menu-photos'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.current_staff_role() = 'owner'
);

create policy "menu_photos_delete_owner" on storage.objects for delete to authenticated
using (
  bucket_id = 'menu-photos'
  and (storage.foldername(name))[1] = public.current_company_id()::text
  and public.current_staff_role() = 'owner'
);
-- NO anon SELECT policy: reads go through the public CDN by exact UUID path (no listing).
```

## Appendix B — Sources (external, fetched 2026-07-21; re-verify pricing before committing)

- Supabase pricing — https://supabase.com/pricing (Pro $25/mo; Image Transformations Pro+ only, 100 origin images incl. then $5/1,000; Free = no transforms)
- Supabase Storage Image Transformations — https://supabase.com/docs/guides/storage/serving/image-transformations
- Supabase Storage access control / helper functions — https://supabase.com/docs/guides/storage/security/access-control
- Cloudflare Images pricing — https://developers.cloudflare.com/images/pricing/ (Free: 5,000 unique transforms/mo)
- Cloudflare transformations overview — https://developers.cloudflare.com/images/transform-images/ (must enable on zone; only accepts same-zone sources by default → add Supabase as allowed origin)
- `browser-image-compression` (context7 `/donaldcwl/browser-image-compression`) — options, EXIF, web-worker
