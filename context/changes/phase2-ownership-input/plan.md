# Ownership + Input Boundaries (Test-Plan Phase 2) Implementation Plan

## Overview

Rollout Phase 2: pin the already-sound **ownership/IDOR (#4)**, **input-validation parity (#5)**, and **staff self-privilege (#6)** defenses at the **route layer**, on the Phase 1 integration harness. The SQL suite already proves the RLS/trigger predicates and the Risk #3 authz matrix already covers all five `room_objects` routes — Phase 2 proves the HTTP handlers wire guards + validation + error-translation correctly on top, and makes the one un-backstopped gap (`menu_items.category_id`) visible at the DB layer.

## Current State Analysis

Grounded in `context/changes/phase2-ownership-input/research.md` (git 73f786e, main incl. #27 room_objects):

- **#4 is structurally blocked.** Storage paths are server-built as `{company_id}/{item_id}` ([storage.ts:30-31,45](src/lib/storage.ts:30)); every service-role op is preceded by an ownership gate (`itemExistsInCompany` before mint in [photo-url.ts:32,36](src/pages/api/menu/items/[id]/photo-url.ts:32); RLS-scoped UPDATE before `removePhotoObjects` in [photo.ts:55-59,69](src/pages/api/menu/items/[id]/photo.ts:55)). Cross-entity pointers: `tables.room_id` and `room_objects.room_id` have composite FKs (app + DB); **`menu_items.category_id` is app-layer-only** ([menu_categories_items.sql:78](supabase/migrations/20260708124756_menu_categories_items.sql:78)).
- **#5 has no parity gap.** Every JSON-body route calls `parseBody(context, schema)` → first zod issue as 400 ([api.ts:113-130](src/lib/api.ts:113)). Schemas are already unit-tested (`src/lib/schemas/*.test.ts`). Traps: position/transform **clamp→200** (not reject); schemas aren't `.strict()` → extra keys dropped→200.
- **#6's route pre-empts the trigger.** Self-guard→403 ([staff/[id].ts:36-39](src/pages/api/staff/[id].ts:36)) and schema enum→400 (`role:"owner"` not in `STAFF_ASSIGNABLE_ROLES`) both fire before the DB; the `42501→403` mapping is unreachable via the route (proven at SQL).
- **Harness:** `seedTwoCompanies()` returns `resources:{categoryId,itemId,roomId,tableId}` — **no `objectId`, no seeded photo** ([fixtures.ts:35-58]). Copy-pattern: `tests/integration/isolation/cross-tenant-write.test.ts`. The `astro:env` stub exposes `SUPABASE_SERVICE_ROLE_KEY`, so photo routes import fine.

## Desired End State

`npm run test:integration` and `npm run test:rls:local` (local Supabase) deterministically prove, at the route layer:
- **#4**: waiter/kitchen cannot mint/attach/clear a photo (403); owner A cannot touch company-B item/category/room/object ids (404/400); the photo path handed to Storage is server-built `{companyId}/{itemId}`; and the `category_id` DB gap is demonstrated + labeled (flips to a hard assertion when a composite FK lands).
- **#5**: every body route returns 400 on a representative out-of-contract input; clamp routes return 200 (documented, not mistaken for a gap); staff empty-patch returns 400.
- **#6**: owner self role/deactivate → 403 (role/`deactivated_at` unchanged in DB); `role:"owner"` via PUT/POST → 400 (unchanged); owner self-rename → 200.

Cookbook §6 gains the Storage-mock pattern + `objectId` fixture note.

## What We're NOT Doing

- **Not** exercising real Supabase Storage — the Storage/service-role edge is **mocked** (`vi.mock("@/lib/storage")`), per the change brief. IDOR logic runs before Storage, so the mock doesn't weaken it; prefix-scoping RLS is already proven in SQL (assertions 7-8).
- **Not** fixing the `menu_items.category_id` gap (no composite-FK migration) — the route check is tested and the DB gap is labeled as a known-gap for a follow-up change.
- **Not** re-proving RLS/trigger predicates in SQL (staff invariants 13-18, Storage prefix 7-8, room_objects 24-26 already covered) — Phase 2 is route-layer.
- **Not** re-doing the 3-role authz matrix for `room_objects` (Risk #3 covers all five routes).
- **Not** re-enumerating every zod constraint per route (unit tests own that).

## Critical Implementation Details

- **Storage mock captures the path.** `vi.mock("@/lib/storage")` replaces `mintPhotoUploadUrls`/`removePhotoObjects` with `vi.fn()`s. The #4 photo assertions are: on denied paths (waiter 403, cross-tenant item 404) the mock is **not called**; on the owner happy path it's called exactly once with `` `${companyA.company_id}/${itemId}` ``. This proves the ownership-gate-before-service-role ordering without real Storage.
- **`category_id` known-gap is a raw authenticated insert, not a route call.** In `rls_isolation.sql`, as owner A (JWT claims), `insert into public.menu_items (company_id=<A>, …, category_id=<B's category>)` **succeeds today** (FK checked below RLS; `with check` pins only `company_id`). Emit `raise notice 'KNOWN GAP (#4) …'`, NOT `raise exception` — mirrors the Risk #2 block; flips to an assertion when the composite FK lands.
- **Clamp vs reject boundary is exactly the canvas edge.** `pos_x` in `[0,1200]` that pushes the footprint off-edge is clamped→200; only `pos_x>1200`/`<0` is a schema 400. Tests must not assert 400 for near-edge coords.
- **`locals.role` vs JWT** (carried from Phase 1): guard reads `locals.role`, RLS reads the JWT in `locals.supabase` — both come from the same seeded principal.

## Phase 1: Fixture + harness extension

### Overview
Give the isolation suites a company-B `room_objects` id to attack, ensure cleanup removes objects, and establish the shared Storage-mock pattern.

### Changes Required:

#### 1. `objectId` resource
**File**: `tests/integration/helpers/fixtures.ts`
**Intent**: Seed one `room_objects` row per company and expose its id, mirroring the existing `tableId` seed, so object cross-tenant/IDOR route tests have a real company-B id.
**Contract**: extend `CompanyResources` with `objectId: string`; in `seedResources`, insert `{ company_id, room_id, kind: "chair", width: 40, height: 40 }` (pos_x/pos_y/rotation default 0) via the service client and return its `id`. Add `"room_objects"` to the `cleanup()` child-delete list **before** `rooms` (it's swept by the company cascade anyway, but explicit delete keeps cleanup deterministic).

#### 2. Storage-mock helper/pattern
**File**: `tests/integration/isolation/photo-idor.test.ts` (new — pattern established here; reused inline)
**Intent**: A hoisted `vi.mock("@/lib/storage")` exposing `mintPhotoUploadUrls`/`removePhotoObjects` as spies, so photo-route tests assert authz + the server-built path without touching real Storage.
**Contract**: `vi.mock("@/lib/storage", () => ({ mintPhotoUploadUrls: vi.fn(...), removePhotoObjects: vi.fn(...) }))`; reset spies in `beforeEach`. (Kept co-located with the photo test that needs it; no shared helper file unless a second file needs it.)

### Success Criteria:
#### Automated Verification:
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests still pass, DB-free: `npm run test`
- `objectId` is populated for both companies (asserted by a smoke check in the isolation suite): `npm run test:integration`
#### Manual Verification:
- Two consecutive `npm run test:integration` runs leave no `room_objects` residue (cleanup extended correctly).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 2: Risk #4 — IDOR (photos + cross-entity pointers + category_id gap)

### Overview
Prove ownership is enforced on photo endpoints and cross-entity pointers, and label the `category_id` DB gap.

### Changes Required:

#### 1. Photo IDOR (mocked Storage)
**File**: `tests/integration/isolation/photo-idor.test.ts`
**Intent**: Drive `photo-url` POST and `photo` PUT/DELETE as principals; prove the ownership gate precedes the (mocked) service-role op.
**Contract**: waiter/kitchen → 403 (guard), mock **not** called; owner A vs a company-B `itemId` → 404, mock **not** called; owner A vs own `itemId` → 2xx, mock called once with path `` `${companyA.company_id}/${itemId}` ``. Body for photo-url uses a valid `photoUploadRequestSchema` payload.

#### 2. Cross-entity pointer IDOR
**File**: `tests/integration/isolation/cross-entity-pointer.test.ts`
**Intent**: Prove an owner cannot point their row at another company's parent on every pointer.
**Contract**: as owner A — `POST/PUT /api/menu/items` with `category_id`=B's category → 400, no A row written referencing it; `POST /api/room/tables` + `PUT /api/room/tables/[id]` with `room_id`=B's room → 400; `POST /api/room/objects` + `PUT /api/room/objects/[id]` with `room_id`=B's room → 400. Verify via service-role that no offending row exists / A's row unchanged.

#### 3. room_objects cross-tenant (representative)
**File**: `tests/integration/isolation/cross-tenant-write.test.ts` (extend) OR new `object-cross-tenant.test.ts`
**Intent**: Mirror the table cross-tenant pattern for objects: owner A targets company-B `objectId`.
**Contract**: `PUT /api/room/objects/[id]` (and one PATCH — position or transform) + `DELETE /api/room/objects/[id]` against B's `objectId` → 404; verify B's object row unchanged (service-role read).

#### 4. `category_id` DB known-gap
**File**: `supabase/tests/rls_isolation.sql`
**Intent**: Demonstrate + label that a raw authenticated insert with a foreign `category_id` currently succeeds (no composite FK backstop).
**Contract**: a `-- KNOWN GAP (#4): menu_items.category_id not company-scoped at the DB` block — as owner A JWT, insert a menu_item with `category_id`=B's category, `raise notice` on success (NOT exception), reference `menu_categories_items.sql:78` and the follow-up. Flip to `raise exception` when a composite FK lands.

### Success Criteria:
#### Automated Verification:
- `npm run test:integration` passes the photo-IDOR, cross-entity-pointer, and object cross-tenant suites.
- `npm run test:rls:local` runs to exit 0 and prints the `KNOWN GAP (#4)` notice.
- Lint + typecheck pass.
#### Manual Verification:
- The photo tests assert the mock is NOT called on 403/404 paths and IS called with the server-built path on the happy path.
- Flipping one cross-entity assertion to expect success fails loudly.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Risk #5 — input-validation parity

### Overview
Prove each body route rejects out-of-contract input end-to-end (400), and document the clamp/empty-patch behaviors that are intentionally not 400.

### Changes Required:

#### 1. Representative bad-input matrix
**File**: `tests/integration/validation/input-parity.test.ts`
**Intent**: One representative out-of-contract request per JSON-body mutating route → 400, proving the `parseBody(schema)` wiring end-to-end (not re-testing zod).
**Contract**: parametrized over routes with a `{ route, method, badBody }` registry — e.g. menu item negative price; category empty name; room empty name; table bad `shape`; object bad `kind`/out-of-range `rotation`; staff create weak password / `role:"owner"`; photo non-webp `contentType`. Assert `status === 400`. Reuse `buildContext` + owner principal (schema failures need only owner-through-guard).

#### 2. Clamp + empty-patch guardrails
**File**: `tests/integration/validation/clamp-and-partial.test.ts`
**Intent**: Lock in the intentional non-400 behaviors so a future "tighten to reject" change is a conscious decision.
**Contract**: table/object position with in-canvas-but-footprint-off coords → **200** with clamped `pos_x/pos_y` (verify persisted value clamped); an extra unknown key on a valid body → **200**, key not persisted; `PUT /api/staff/[id]` with `{}` → **400** "Brak zmian do zapisania".

### Success Criteria:
#### Automated Verification:
- `npm run test:integration` passes the parity + guardrail suites.
- Lint + typecheck pass.
#### Manual Verification:
- The registry covers every JSON-body mutating route (spot-check against `route-matrix.ts`).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Risk #6 — staff self-privilege invariant

### Overview
Prove the staff route enforces the self-privilege invariant with the right status per layer, and the DB effect holds.

### Changes Required:

#### 1. Staff invariant route tests
**File**: `tests/integration/isolation/staff-invariant.test.ts`
**Intent**: Drive `/api/staff` PUT/POST as owner A on own company; assert status + DB effect, distinguishing the 403-self-guard cases from the 400-schema cases.
**Contract**:
- `PUT /api/staff/[ownId]` `{role:"waiter"}` → **403** (self-guard); verify own `role` still `owner`.
- `PUT /api/staff/[ownId]` `{active:false}` → **403**; verify `deactivated_at` still null.
- `PUT /api/staff/[waiterId]` `{role:"owner"}` → **400** (schema enum); verify waiter `role` unchanged.
- `POST /api/staff` `{…,role:"owner"}` → **400** (schema); verify no new profile row (and no orphan auth user).
- `PUT /api/staff/[ownId]` `{full_name:"…"}` → **200**; verify rename applied, `role`/`deactivated_at` unchanged.

### Success Criteria:
#### Automated Verification:
- `npm run test:integration` passes the staff-invariant suite.
- Lint + typecheck pass.
#### Manual Verification:
- Each case asserts the DB effect (role/`deactivated_at` unchanged), not just the status.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Cookbook §6 + phase note

### Overview
Record what Phase 2 added so the next contributor can extend it.

### Changes Required:

#### 1. Cookbook + phase note
**File**: `context/foundation/test-plan.md`
**Intent**: Note the Storage-mock pattern, the `objectId` fixture, and the `category_id` known-gap; extend §6.6.
**Contract**: prose additions to §6 (integration cookbook: "mocking the Storage/service-role edge with `vi.mock`"; where object/photo fixtures live) and a §6.6 Phase-2 note. No strategy change.

### Success Criteria:
#### Automated Verification:
- `context/foundation/test-plan.md` references the new suites and the mock pattern; no stale `TBD` for Phase 2.
#### Manual Verification:
- A contributor can add a photo-route or object test by following §6.

**Implementation Note**: After this phase, re-run `/10x-test-plan` to mark §3 Phase 2 complete.

---

## Testing Strategy

### Integration Tests:
- #4: photo IDOR (mocked Storage), cross-entity pointers, object cross-tenant — owner A vs company-B ids, verify-in-DB / mock-not-called.
- #5: representative bad-input → 400 per route; clamp → 200; empty-patch → 400.
- #6: staff self-privilege — status + DB effect.

### SQL:
- Extend `rls_isolation.sql` with the `category_id` known-gap block (notice, not exception).

### Manual Testing Steps:
1. `npx supabase start`; `.env.test` with JWT keys.
2. `npm run test:integration` → all Phase 2 suites green.
3. `npm run test:rls:local` → exit 0, `KNOWN GAP (#4)` notice printed.
4. Flip a cross-entity/IDOR assertion → red; restore.

## Performance Considerations
- Storage mock keeps photo tests fast + deterministic (no real uploads). Serialized DB suites as in Phase 1.

## Migration Notes
- No production schema migration. The `category_id` composite-FK fix is logged (KNOWN-GAPS.md + the new SQL notice), not applied.

## References
- Research: `context/changes/phase2-ownership-input/research.md`
- Phase 1 harness + KNOWN-GAPS: `context/changes/testing-tenant-isolation-integration/`
- Copy-pattern: `tests/integration/isolation/cross-tenant-write.test.ts`
- Guards/schemas: `src/lib/api.ts`, `src/lib/room-api.ts`, `src/lib/schemas/*`, `src/lib/storage.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. See `references/progress-format.md`.

### Phase 1: Fixture + harness extension

#### Automated
- [x] 1.1 Type checking passes: `npm run typecheck` — a54d1c5
- [x] 1.2 Linting passes: `npm run lint` — a54d1c5
- [x] 1.3 Unit tests still pass, DB-free: `npm run test` — a54d1c5
- [x] 1.4 `objectId` populated for both companies (integration smoke): `npm run test:integration` — a54d1c5

#### Manual
- [x] 1.5 Two consecutive integration runs leave no `room_objects` residue — a54d1c5

### Phase 2: Risk #4 — IDOR

#### Automated
- [x] 2.1 `npm run test:integration` passes photo-IDOR + cross-entity-pointer + object cross-tenant suites — 2973192
- [x] 2.2 `npm run test:rls:local` exit 0 and prints the `KNOWN GAP (#4)` notice — 2973192
- [x] 2.3 Lint + typecheck pass — 2973192

#### Manual
- [x] 2.4 Photo tests assert mock NOT called on 403/404 and called with server-built path on happy path — 2973192
- [x] 2.5 Flipping one cross-entity assertion to expect success fails loudly — 2973192

### Phase 3: Risk #5 — input-validation parity

#### Automated
- [ ] 3.1 `npm run test:integration` passes parity + clamp/partial guardrail suites
- [ ] 3.2 Lint + typecheck pass

#### Manual
- [ ] 3.3 Registry covers every JSON-body mutating route (spot-check vs route-matrix.ts)

### Phase 4: Risk #6 — staff self-privilege invariant

#### Automated
- [ ] 4.1 `npm run test:integration` passes the staff-invariant suite
- [ ] 4.2 Lint + typecheck pass

#### Manual
- [ ] 4.3 Each case asserts the DB effect (role/deactivated_at unchanged), not just status

### Phase 5: Cookbook §6 + phase note

#### Automated
- [ ] 5.1 `test-plan.md` references the new suites + mock pattern; no stale Phase-2 `TBD`

#### Manual
- [ ] 5.2 A contributor can add a photo/object test by following §6
