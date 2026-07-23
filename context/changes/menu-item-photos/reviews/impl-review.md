<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Menu Item Photos (S-04)

- **Plan**: context/changes/menu-item-photos/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-22
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (automated)

- `npm run lint` — PASS (0 errors)
- `npm run typecheck` — PASS (0 errors)
- `npm test` — PASS (25/25)
- `npm run build` — PASS

Manual (2.5, 2.6, 3.5–3.11) confirmed by the user ("działa"). Security containment of the
service-role key was independently verified clean (used only in src/lib/storage.ts, server-only,
endpoint authorizes owner + server-built path before use; no cross-tenant signed URL reachable).

## Context

Phase 3 deviated from the plan's upload mechanism: Supabase Storage does not honor the user JWT
for RLS in this project, so signing/removal moved to a server-side service-role client. The
deviation is documented (p3 commit `880e882` + context/foundation/lessons.md). This review confirms
the deviation is implemented cleanly and authorizes correctly; the findings below are mostly about
the plan text no longer matching the code, plus one real hardening gap (bucket-level enforcement).

## Findings

### F1 — Photo size/type validation is advisory, not enforced

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260721120000_menu_item_photos.sql:19, src/lib/schemas/menu.ts:59
- **Detail**: The bucket is created with no `file_size_limit` and no `allowed_mime_types`, and the browser PUTs the real bytes straight to the signed URL. `photoUploadRequestSchema` (image/webp, 2 MB / 300 KB) only validates the *claimed* values in the mint request — an owner could upload arbitrarily large or non-image content to their own public prefix, served from the Storage CDN. Self-tenant only (not cross-tenant), so it's storage-abuse, not a leak — but the validation gives false confidence.
- **Fix**: Set the bucket's `allowed_mime_types := array['image/webp']` and `file_size_limit` (e.g. 2 MB) so the signed-URL PUT is actually constrained by Storage. A small follow-up migration (bucket config is a DB row).
  - Strength: Real server-side enforcement; matches the intent behind the zod caps.
  - Tradeoff: One more migration; must be applied to hosted.
  - Confidence: HIGH — bucket columns exist and Storage enforces them on upload.
  - Blind spot: Confirm the client always encodes exactly `image/webp` (it does — resizeForUpload).
- **Decision**: FIXED (migration 20260722100000_menu_photos_bucket_limits.sql — bucket file_size_limit 2 MB + allowed_mime_types ['image/webp']; pushed to hosted)

### F2 — Plan body no longer matches the shipped photo mechanism

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/menu-item-photos/plan.md (Phase 2 §1/§3, Phase 3 §2/§3)
- **Detail**: The plan describes carrying `photo_path` through `menuItemInputSchema` + the `items` routes, minting with the user-authenticated client, and `uploadToSignedUrl`/browser `getPublicUrl`. The shipped design uses a dedicated `photo.ts` route, a service-role mint, `photoUploadRequestSchema`, and a hand-rolled `putSignedBlob`. Functionally equivalent and documented in the commit/lesson, but the plan's Changes Required text is now inaccurate for future readers.
- **Fix**: Add a short "Implementation deviations" addendum to plan.md pointing at the lesson + commit `880e882`.
- **Decision**: FIXED (added "## Implementation Deviations (post-hoc)" section to plan.md; also covers F3)

### F3 — Service-role client adopted despite "What We're NOT Doing"; dedupe undocumented

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: plan.md:61 ("Out of scope: service-role client"), astro.config.mjs:16
- **Detail**: The plan explicitly excluded a service-role client; it was adopted as a forced discovery (documented in lessons.md). Separately, `resolve.dedupe: ["react","react-dom"]` was added to fix a dev-server duplicate-React error unrelated to S-04 and isn't documented in this change.
- **Fix**: Note the service-role adoption in plan.md's scope section (superseded by the lesson) and add a one-line rationale for the dedupe (or split it to its own chore).
- **Decision**: FIXED (covered by the "## Implementation Deviations" addendum added for F2 — notes service-role superseding "out of scope" + dedupe rationale)

### F4 — Upload progress / cancellation not implemented

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/menu/MenuItemDialog.tsx
- **Detail**: Plan Phase 3 §2 called for upload progress + `AbortController` cancellation. Only a disabled "Zapisywanie…" button exists. Acceptable for MVP (images are small, resized client-side first), but it's a planned item that's absent.
- **Fix**: Either add `onProgress`/abort later, or drop it from scope explicitly. Candidate follow-up.
- **Decision**: FIXED (end-to-end AbortController cancel via resizeForUpload/putSignedBlob/callMenuApi signal; dialog "Przerwij" + phase labels "Przetwarzanie…/Wysyłanie…". Numeric % skipped — fetch has no upload-progress without XHR.)

### F5 — Stale comment in photo.ts DELETE

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/menu/items/[id]/photo.ts:42
- **Detail**: Comment says "The Storage objects are removed by the browser client (which holds the owner session)" — leftover from the pre-deviation design. The code removes objects server-side via `removePhotoObjects` (service role) at line 69.
- **Fix**: Correct the comment to describe the best-effort server-side removal.
- **Decision**: FIXED (comment now describes null-row + best-effort service-role removal)

### F6 — Partial-failure leaves orphan objects (self-healing)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/menu/MenuManager.tsx:116
- **Detail**: `uploadItemPhoto` mints → PUTs both blobs → PUT attach with no compensation. If attach (or thumb PUT) fails after full uploads, Storage holds objects while the row has no `photo_path`. Low impact: the path is deterministic and mint uses `upsert:true`, so a retry overwrites rather than accumulates.
- **Fix**: Add a brief comment noting the deterministic-path self-healing; optionally attach-first-or-cleanup. No code change required.
- **Decision**: FIXED (added self-healing comment in uploadItemPhoto)

### F7 — putSignedBlob hand-rolls storage-js multipart wire format

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/images.ts:37
- **Detail**: `putSignedBlob` replicates storage-js `uploadToSignedUrl`'s multipart body (`cacheControl` field + empty-named file field + `x-upsert`). Matches current behavior and surfaces failures, but is coupled to an undocumented internal body shape that could break on a Storage change.
- **Fix**: Consider the SDK `uploadToSignedUrl(path, token, blob)` (no key needed — it takes the signed path+token), which decouples from the wire format. Tradeoff: needs a browser supabase client instance; current raw fetch is dependency-free.
- **Decision**: SKIPPED (raw PUT works, dependency-free, low risk; multipart coupling documented in the putSignedBlob comment — revisit only if Storage changes the wire format)

### F8 — RLS test asserts waiter INSERT denied but not DELETE

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/rls_isolation.sql:216
- **Detail**: Plan Phase 1 §5 asked for waiter INSERT/UPDATE/DELETE on storage.objects denied; the test asserts waiter INSERT denied and owner cross-company INSERT denied, but not a waiter DELETE case. Minor coverage gap; the DELETE policy mirrors INSERT so risk is low.
- **Fix**: Add a waiter DELETE-denied assertion (seed an object as owner, attempt delete as waiter).
- **Decision**: NOT-FEASIBLE (attempted; `storage.protect_delete()` blocks direct DELETE from storage.objects for ALL roles, so a SQL-level assertion isn't meaningful. Documented as a note in rls_isolation.sql; the API-layer DELETE policy mirrors the asserted INSERT.)
