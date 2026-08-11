---
date: 2026-08-11T07:26:23+0200
researcher: Intebuco_Milosz
git_commit: 73f786e3ba880403442b105381a64165d29561f6
branch: test/phase2-ownership-input
repository: 10x
topic: "Phase 2 (Risks #4/#5/#6): ownership/IDOR, input-validation parity, staff self-privilege — grounded for a route-layer test plan"
tags: [research, codebase, idor, storage, validation, staff-invariant, room_objects, test-harness]
status: complete
last_updated: 2026-08-11
last_updated_by: Intebuco_Milosz
---

# Research: Phase 2 — Ownership + input boundaries (#4/#5/#6)

**Date**: 2026-08-11T07:26:23+0200
**Git Commit**: 73f786e (main, incl. #27 room_objects)
**Branch**: test/phase2-ownership-input

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md` — Risks **#4** (IDOR on photo/Storage + cross-entity pointers), **#5** (server input-validation parity), **#6** (staff self-privilege invariant) — against current code, for a route-layer integration test plan built on the Phase 1 harness.

## Summary

Like Phase 1, the defenses already exist and are sound; Phase 2 **pins them at the route layer** (the SQL layer already proves the RLS/trigger predicates). Three findings shape the plan:

1. **#4 is structurally blocked on every path.** Storage object paths are **server-built from `company_id`** (`{company_id}/{item_id}` — the client never supplies a prefix), and every service-role Storage op is preceded by an ownership gate. Cross-entity pointers split by strength: `tables.room_id` and `room_objects.room_id` have **composite FKs (app + DB)**; **`menu_items.category_id` is app-layer-only** (no `(company_id,id)` composite FK) — the single highest-value regression target.
2. **#5 has no parity gap.** Every mutating route calls `parseBody(schema)` with the right schema; nothing is client-trusted beyond what a schema or an ownership SELECT constrains. Schemas are already thoroughly unit-tested — so the integration angle is "**the route returns 400 end-to-end**", plus route-level non-schema branches, **not** re-testing zod. Two traps: position/transform routes **clamp (→200), not reject**; schemas aren't `.strict()`, so extra keys are dropped (→200), not rejected.
3. **#6's route defenses pre-empt the trigger.** The `/api/staff/[id]` route **self-guard** returns 403 for self role/deactivate *before the DB*, and the **schema enum** rejects `role:"owner"` with 400 *before the DB* — so the trigger's `42501→403` mapping is essentially unreachable via the route (it's proven at SQL). Route tests assert **status + effect (role/deactivated_at unchanged)**, distinguishing the 403-self-guard cases from the 400-schema cases.

**Harness:** reuse `seedTwoCompanies`/`buildContext`/`serviceRoleClient`; `isolation/cross-tenant-write.test.ts` is the copy-pattern. Additions needed: an `objectId` resource, photo-route tests (decide real-Storage vs `vi.mock`), and a `cleanup()` extension if real Storage objects are written. The Risk #3 authz matrix **already covers all five room_objects routes** — don't re-do guard coverage.

## Detailed Findings

### Risk #4 — IDOR on photo/Storage + cross-entity pointers

**Storage path is server-built; client can't forge a prefix.** `src/lib/storage.ts` only appends fixed leaves to a caller-provided `base`: `createSignedUploadUrl(\`${base}/full.webp\`)` / `remove([\`${base}/full.webp\`,...])` ([storage.ts:30-31,45](src/lib/storage.ts:30)). Every caller builds `base = \`${guard.companyId}/${id.data}\`` where `companyId` comes from `locals`, never the body. Service-role `admin()` ([storage.ts:14-21](src/lib/storage.ts:14)) bypasses RLS but is only reachable after the route authorizes.

**Ownership gate precedes every service-role op:**
- `photo-url.ts` POST — `itemExistsInCompany` (RLS-scoped SELECT) → 404 **before** `mintPhotoUploadUrls` ([photo-url.ts:32,36](src/pages/api/menu/items/[id]/photo-url.ts:32)).
- `photo.ts` PUT/DELETE — RLS-scoped UPDATE; `data.length===0` → 404 **before** `removePhotoObjects` ([photo.ts:55-59,69](src/pages/api/menu/items/[id]/photo.ts:55)).
- Signed-URL nuance: the browser PUTs bytes with a service-role-minted token, so `menu_photos_insert_owner` RLS does **not** gate that upload — the server-built path + pre-mint ownership check are the defense. Bucket caps still apply: `image/webp` only, 2 MB ([20260722100000_menu_photos_bucket_limits.sql:8-11]).

**Cross-entity pointer strength:**

| Pointer | App check | DB backstop | Verdict |
|---|---|---|---|
| `menu_items.category_id` | `categoryExistsInCompany` → 400 ([api.ts:101-104](src/lib/api.ts:101); items.ts:29, items/[id].ts:34) | **single-column FK only** ([menu_categories_items.sql:78](supabase/migrations/20260708124756_menu_categories_items.sql:78)) — **no composite** | **App-layer is the sole defense** — highest-value regression target |
| `tables.room_id` | `roomExistsInCompany` → 400 ([room-api.ts:47-50](src/lib/room-api.ts:47)) | composite FK `(company_id,room_id)→rooms(company_id,id)` ([room_tables_composite_fk.sql:28-40]) | app + DB |
| `room_objects.room_id` | `roomExistsInCompany` → 400 | composite FK from day one ([20260804120000_room_objects.sql:72-76]) | app + DB (self-documented) |

**Storage RLS** (`menu_photos_insert/update/delete_owner`) scopes by `(storage.foldername(name))[1] = current_company_id()::text` ([menu_item_photos.sql:34-64]) — already proven in SQL (assertions 7-8).

**#4 test cases** (owner A → company-B id): photo-url POST → 404; photo PUT/DELETE → 404 (no service-role op fires on B); item POST/PUT with B's `category_id` → 400 (+ a companion note: DB would accept it if the app check regressed); table POST/PUT with B's `room_id` → 400; object POST/PUT with B's `room_id` → 400. Verify no row/object written under B.

### Risk #5 — server input-validation parity

**Mechanism:** every JSON-body route calls `parseBody(context, schema)` → first zod issue as 400 ([api.ts:113-130](src/lib/api.ts:113)). UUID path params validated separately (`z.uuid()`) → 400 before `parseBody`. **No route does ad-hoc parsing or skips validation.** Body-less mutating routes (photo PUT/DELETE, plain DELETEs) carry no client body by design.

**Schema contracts** (all with thorough existing unit tests in `src/lib/schemas/*.test.ts`):
- `menuItemInputSchema` — price `.positive().max(99999999.99)` + ≤2-decimals refine; name trim 1–120; `availability` enum; `allergens` enum+unique; `category_id` uuid.
- `roomInputSchema`/`tableInputSchema`/`roomObjectInputSchema` — canvas-bounded int coords, `shape`/`kind` enums, table number 1–999, object width 10–1200 / height 10–800 / rotation 0–359.
- `staffCreateInputSchema`/`staffUpdateInputSchema` — login regex+len, password ≥8, `role` = `z.enum(STAFF_ASSIGNABLE_ROLES)` (**owner not assignable**); update fields all optional.
- `photoUploadRequestSchema` — `literal("image/webp")`, fullSize ≤2 MB, thumbSize ≤300 KB.

**Two traps for the plan:**
- **Clamp, not reject** — table/object position & transform clamp in-canvas coords by footprint (→ **200**), reject only out-of-canvas ([room-geometry.ts clampPosition/clampObjectCenter]). Don't assert 400 for near-edge coords.
- **Not `.strict()`** — extra keys are silently dropped → **200**, not 400. If testing "server ignores extra fields", assert 200 + not-persisted.
- Route-level non-schema branches: `categoryExistsInCompany`/`roomExistsInCompany` → 400 (need real DB rows); staff self-change → 403; staff empty-patch `{}` → 400 "Brak zmian" ([staff/[id].ts:65]).

**#5 integration angle:** one representative bad-input request per route → assert 400 (proves `parseBody` wiring end-to-end); plus the route-specific 400/403 branches; plus clamp-cases as 200. Do **not** re-enumerate every zod constraint (unit tests own that).

### Risk #6 — staff self-privilege invariant

**Trigger `guard_profile_self_change`** ([staff_accounts_roles.sql:112-140]) — BEFORE UPDATE, raises `42501` on: (a) changing own role (`auth.uid()=old.user_id`), (b) own `deactivated_at` delta (blocks self-deactivate AND self-reactivate), (c) **any** promotion non-owner→`owner`. No explicit "last owner" logic — the invariant holds because owners are only minted by `handle_new_user` (never by the route), so exactly one owner exists.

**RLS:** `profiles_insert_owner` has `role <> 'owner'`; `profiles_delete_owner` has `user_id <> auth.uid()` (no self-delete). `STAFF_ASSIGNABLE_ROLES = [waiter, kitchen]` ([types.ts:88-97]); both staff schemas use it → `role:"owner"` fails validation before the DB.

**Route pre-empts the trigger:** `staff/[id].ts` self-guard ([:36-39]) returns **403** for self role/active *before* the DB call; the schema enum returns **400** for `role:"owner"` *before* the DB. So the `isInsufficientPrivilege→403` mapping ([api.ts:139-141]; [staff/[id].ts:76-84]) is effectively **unreachable via the route** — it's proven at the SQL layer (assertion 13b/15).

**#6 test cases** (owner on own company): self `{role:"waiter"}` → **403** (self-guard), role still owner; self `{active:false}` → **403**, still active; waiter `{role:"owner"}` → **400** (schema), unchanged; POST `{role:"owner"}` → **400** (schema), no row/orphan; self `{full_name}` → **200**. Distinguish 403-self-guard vs 400-schema per case; assert the DB effect (role/deactivated_at unchanged), don't re-run raw UPDATE SQL.

### Harness fit + what's already proven

- **Reuse:** `seedTwoCompanies()` → `{companyA,companyB,anon,cleanup}`, each company `{company_id,venue_code,owner,waiter,kitchen,resources:{categoryId,itemId,roomId,tableId}}` ([fixtures.ts:35-58]); `buildContext(principal, {method,url?,body?,params?})` ([context.ts:18]); `serviceRoleClient()`/`anonClient()`. Copy-pattern: `isolation/cross-tenant-write.test.ts`.
- **`resources.itemId` is ready** for photo IDOR tests. **No `objectId`, no seeded photo** — Phase 2 must add `objectId` to `CompanyResources` + a `seedResources` insert (`room_objects` needs `kind`/`width`/`height` NOT NULL).
- **Photo routes import fine under the astro:env stub** (it exposes `SUPABASE_SERVICE_ROLE_KEY`); against a running local Supabase, `storage.ts` calls hit real local Storage. Decide: **real Storage** (matches suite, but must extend `cleanup()` — it deletes neither `room_objects` (swept by company cascade) nor `storage.objects`) vs adding a `vi.mock("@/lib/storage")` (none exists).
- **Already covered — do NOT re-prove:** Risk #3 authz matrix covers all five room_objects routes ([route-matrix.ts:118-146]); SQL proves Storage prefix scoping (assertions 7-8), staff invariants (13-18), room_objects RLS/FK/cascade (24-26). Phase 2 targets the **route layer** only.

## Code References

- `src/lib/storage.ts:14-21,24,30-31,40,45` — service-role client; server-built path.
- `src/pages/api/menu/items/[id]/photo-url.ts:32,36` · `photo.ts:55-59,69` — ownership gate before service-role op.
- `src/lib/api.ts:101-104,108-111,113-130,139-141` — categoryExists/itemExists, parseBody, isInsufficientPrivilege.
- `src/lib/room-api.ts:18-57` — guardTablesRequest, roomExistsInCompany.
- `src/pages/api/room/objects.ts`, `objects/[id].ts`, `objects/[id]/position.ts`, `objects/[id]/transform.ts` — object routes (guardTablesRequest; roomExistsInCompany on POST/PUT; clampObjectCenter).
- `src/lib/schemas/{menu,room,staff}.ts` + `*.test.ts` — schema contracts + existing unit coverage.
- `src/pages/api/staff/[id].ts:36-39,76-88` · `staff/index.ts:112-113` — self-guard, 42501→403.
- `supabase/migrations/20260727220415_staff_accounts_roles.sql:81-140` — profiles policies + self-change trigger.
- `supabase/migrations/20260804120000_room_objects.sql:51-114` — room_objects table, CHECKs, composite FK, RLS.
- `supabase/migrations/20260708124756_menu_categories_items.sql:78` — id-only `category_id` FK (the gap).
- `supabase/tests/rls_isolation.sql:290-332` (Storage), `:464-645` (staff), `:829-948` (room_objects) — SQL already proven.
- `tests/integration/helpers/{fixtures,context,clients}.ts`, `authz/route-matrix.ts:118-146` — harness.

## Architecture Insights

- **Server-built identifiers are the IDOR firewall**: Storage prefix and `photo_path` are composed from `locals.company_id`, so the client's only lever is an id that RLS/ownership-SELECT then rejects. This is why #4 is hard to break — there's no client-controlled path.
- **Composite FKs are the durable cross-entity guard**; the one place it's missing (`menu_items.category_id`) is exactly where a regression could reintroduce IDOR — so a test that pins the app-layer check (and documents the missing DB backstop) is the highest-signal #4 test.
- **Defense layering means status codes differ by input**: the same "make me an owner" intent yields 400 (schema), 403 (self-guard/trigger), or 42501 (raw SQL) depending on the layer reached — tests must assert the *route's* actual status per case, not a generic "denied".
- **SQL suite already owns the predicate-level proofs**; Phase 2's value is proving the HTTP handlers wire guards + validation + error-translation correctly on top.

## Historical Context (from prior changes)

- `context/changes/testing-tenant-isolation-integration/` — Phase 1 harness + KNOWN-GAPS.md (already flags the `category_id` gap and the anon-RLS gap).
- `context/foundation/lessons.md` — "Supabase Storage doesn't honor the user token → service_role" (why photo ops use service-role + endpoint authz) and "anon RLS reads must be scoped by company_id".
- `context/foundation/test-plan.md` §2 rows #4/#5/#6 and §3 Phase 2.

## Open Questions (for /10x-plan to resolve)

- **Photo tests: real local Storage vs `vi.mock("@/lib/storage")`?** Real Storage matches the suite and exercises the true path, but writes objects that `cleanup()` doesn't currently remove (needs extension). Mock isolates the route from Storage but doesn't prove the real service-role path. Cost × signal.
- **`menu_items.category_id` gap:** route-layer test only, + a documented DB-gap regression assertion, or also fix the schema (composite FK migration — scope creep)? (KNOWN-GAPS.md already logs it.)
- **`objectId` fixture:** add to `CompanyResources` (needed for object cross-tenant/IDOR route tests) — confirm the seed shape (`kind:"chair", width:40, height:40`).
- **#5 breadth:** one representative bad-input per route (recommended) vs a fuller per-field matrix (duplicates unit tests).
- **#6:** the 5 route cases assert status + effect; confirm we do NOT try to force the trigger's 42501→403 via the route (unreachable — schema/self-guard pre-empt).

## Related Research

- `context/changes/testing-tenant-isolation-integration/research.md` — Phase 1 grounding (harness, guards, RLS model).
