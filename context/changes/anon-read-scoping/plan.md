# Close Risk #2 — Anon Reads Not `company_id`-Scoped — Implementation Plan

## Overview

Risk #2 is the last risk in `context/foundation/test-plan.md` §2 that is **demonstrated but
not protected**. Four anon SELECT policies carry no `company_id` predicate, so anyone with
the public anon key can enumerate every tenant's data. Research established the surface has
**no consumer**, so the fix is subtraction — drop the policies, let RLS default-deny apply —
and the `KNOWN GAP` notices become hard assertions on two layers.

## Current State Analysis

From `context/changes/anon-read-scoping/research.md` (git 8a6ca63):

- **Four unscoped policies**, the complete `to anon` set (no anon INSERT/UPDATE/DELETE anywhere): `companies_anon_read using (true)`, `tables_anon_read_active using (is_active)` ([minimal_tables_menu.sql:59,64]), `menu_categories_anon_read using (true)`, `menu_items_anon_read_visible` (availability predicate only) ([menu_categories_items.sql:68,106]).
- **No anon consumer exists.** No browser Supabase client (`createBrowserClient` — 0 hits), keys are `access: "secret"` server-only ([astro.config.mjs:24-25]), no `PUBLIC_*` env, no dynamic/QR page routes, all 24 API routes guard first. The premise recorded across the repo — "the fix belongs to S-07/S-08" — is **false**.
- **Precedent, three times**: `rooms` ([room_layout_tables.sql:75-76]), `room_objects` ([room_objects.sql:85-88]) and `storage.objects` ([menu_item_photos.sql:28-32]) deliberately have **no** anon policy, each with a comment saying why.
- **Scoping is not expressible today**: `current_company_id()` returns NULL for anon (filters everything, leaving dead policies); no JWT minting; PostgREST's one-transaction-per-request kills GUCs; a header-derived code is client-supplied, so a blast-radius reducer, not a boundary.
- **Blast radius of dropping**: RLS enabled on all four tables → anon sees zero. No `GRANT`/`REVOKE` in any migration. SD functions leak nothing to anon (`current_company_id`/`current_staff_role` → NULL; the reorder RPCs are `security invoker`). Storage unaffected (public bucket, exact path) — but paths stop being **enumerable**.

## Desired End State

A holder of only the public anon key, with no session, reads **zero** tenant rows and cannot
write — asserted at both the policy layer (SQL) and the real attacker path (anon key →
PostgREST → RLS). `test-plan.md`, `lessons.md` and `KNOWN-GAPS.md` no longer carry the false
S-07/S-08 premise.

### Key Discoveries:

- **⚠ Interlock**: Assertion 5 ([rls_isolation.sql:220-223]) currently asserts anon *sees* 2 companies / 2 tables / 3 items / 2 categories — counts spanning both fixture companies. Flipping the gap block without re-baselining those four numbers makes the suite self-contradictory. **One atomic edit.**
- **Second-order fix**: `menu_item_photos` withholds anon SELECT on `storage.objects` to stop enumeration, but `menu_items.photo_path` is anon-readable cross-tenant — dropping policy #4 restores that defence.
- **Route-layer anon coverage (25 assertions) is irrelevant here** — guards run first, so the query never executes. The anon-key-vs-database surface has **zero** coverage today.

## What We're NOT Doing

- **No `SECURITY DEFINER` RPC** for a public menu. That is S-07/S-08's contract to design; building it now means guessing a consumer's shape, and SD bypasses RLS so a `where`-clause bug would be a full leak with no policy backstop. It should be built on this clean default-deny slate.
- **No `company_id` predicate on anon policies** — not expressible (see Current State); it would either filter everything (dead policies pretending to grant) or depend on a client-supplied header.
- **No `REVOKE`** of the stock table GRANTs — harmless under enabled RLS with no policy, and deviating would break the pattern every other table follows.
- **No fix for the incidental findings** (`signout.ts` missing `prerender = false`; `POST /api/company/profile` redirecting instead of 401) — logged, not bundled into a security change.

## Implementation Approach

Subtraction first, then assertions. The migration must land before any test flips, or the
suite is red between phases. SQL and integration are separate phases because they prove
**different things**: the policy predicate vs. the full gateway → role-mapping → GRANT → RLS
path an attacker actually uses.

**No new test infrastructure is required** — `anonClient()` ([clients.ts:29]), `seed.anon`
([fixtures.ts:273]), the two-company fixtures, the SQL suite, local Supabase and the CI `db`
job all exist from rollout Phases 1 and 3.

## Critical Implementation Details

- **Assertion 5 and the KNOWN GAP block are one edit** (see Key Discoveries). Re-baseline `co/tb/mi/mc` to 0 and convert the gap notices to exceptions in the same change, or the suite contradicts itself.
- **Keep the hidden-row assertions meaningful.** Assertion 5 also proves `unavailable`/archived items and inactive tables stay hidden. Once anon sees zero rows those sub-assertions become trivially true; keep them (they cost nothing and guard the reverse direction if a policy is ever reinstated) but do not present them as evidence of anything.
- **Non-tautology proof**: re-create one dropped policy, confirm the suite goes red, drop it again. This is the repo's established practice (used for the `category_id` composite FK).

## Phase 1: Migration — drop the four unscoped anon policies

### Overview
The enabling change. Nothing can be asserted until anon actually sees zero rows.

### Changes Required:

#### 1. Migration
**File**: `supabase/migrations/20260813010000_drop_unscoped_anon_read_policies.sql` (new)
**Intent**: Remove the four anon SELECT policies so RLS default-deny applies to the `anon` role, closing Risk #2 by removing an attack surface that has no consumer.
**Contract**: four `drop policy … on public.<table>;` statements (`companies_anon_read`, `tables_anon_read_active`, `menu_categories_anon_read`, `menu_items_anon_read_visible`). Header comment must record: why subtraction rather than a predicate (not expressible), that no consumer exists (evidence), the `rooms`/`room_objects`/`storage.objects` precedent, the second-order `photo_path` enumeration fix, and that S-07/S-08 must reintroduce anon access deliberately (RPC + column projection) rather than by re-adding `using (true)`.

### Success Criteria:
#### Automated Verification:
- Migration applies cleanly on a fresh database: `npx supabase db reset`
- A direct anon-role query returns 0 rows on all four tables (ad-hoc psql check)
- Authenticated staff reads are unaffected: `npm run test:integration`
#### Manual Verification:
- No app behaviour changes (no anon consumer to break).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 2: SQL suite — re-baseline Assertion 5 and flip the gap to an assertion

### Overview
Convert the demonstration into proof at the policy layer, as one atomic edit.

### Changes Required:

#### 1. Assertion 5 + KNOWN GAP block
**File**: `supabase/tests/rls_isolation.sql`
**Intent**: Re-baseline the anon counts to zero and turn the four `raise notice` gap lines into a hard assertion, so a reinstated unscoped policy fails the suite.
**Contract**: in Assertion 5, `co`/`tb`/`mi`/`mc` expectations become 0 (keep the `rooms`/`room_objects` zero checks and the anon-write refusal); the `KNOWN GAP (Risk #2)` block becomes **Assertion 5c** asserting anon sees zero company-B rows on all four tables, with `raise exception` on any non-zero — mirroring Assertion 5b's structure. Update the section headers/comments so nothing still says the gap is open or waiting on S-07/S-08.

### Success Criteria:
#### Automated Verification:
- `npm run test:rls:local` exits 0 with no `KNOWN GAP (Risk #2)` notices remaining
- No contradiction: no block asserts anon sees tenant rows
#### Manual Verification:
- Non-tautology: re-create one dropped policy → suite goes red naming that table; drop it again → green.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Integration — the real attacker path

### Overview
Prove the boundary on the path an attacker actually uses: public anon key → gateway →
PostgREST → role `anon` → GRANTs → RLS. Zero coverage today.

### Changes Required:

#### 1. Anon isolation suite
**File**: `tests/integration/isolation/anon-read-scoping.test.ts` (new)
**Intent**: With both companies seeded, drive raw anon-key queries and assert nothing is readable, and that anon cannot write.
**Contract**: using `seed.anon.client` — `select` on `companies`, `tables`, `menu_categories`, `menu_items`, `rooms`, `room_objects`, `profiles` returns 0 rows (assert against the seeded company A **and** company B ids, so the test names what must not leak rather than relying on a global count); an anon `insert` into `menu_items` is refused; and a control assertion that the **service-role** client does see those same rows, proving the fixtures exist and the zero-rows result is the policy, not an empty database. Follow `cross-tenant-read.test.ts` idioms (`.overrideTypes<T,{merge:false}>()`; `as`/`!` are lint-forbidden).

### Success Criteria:
#### Automated Verification:
- `npm run test:integration` passes including the new suite
- Lint + typecheck pass
#### Manual Verification:
- The control assertion fails if the fixtures are not seeded (the zero-rows result cannot pass vacuously).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Backport the corrected premise

### Overview
Remove the false "blocked on S-07/S-08" claim everywhere it is recorded, so it cannot block
the next person the way it blocked this rollout for a full phase.

### Changes Required:

#### 1. Test plan
**File**: `context/foundation/test-plan.md`
**Intent**: Mark Risk #2 as protected and correct the Risk Response row.
**Contract**: §2 Source for Risk #2 and its Risk Response Guidance row updated (anon read surface removed; scoping for S-07/S-08 must be reintroduced deliberately). §6.5's Risk #2 note updated — the `notice`→`exception` recipe now has a second worked example. No file anchors added to §2.

#### 2. Lessons
**File**: `context/foundation/lessons.md`
**Intent**: The anon-RLS lesson currently says the fix waits for S-07/S-08; correct it to the rule that actually held.
**Contract**: amend the existing entry — the durable rule is "an anon SELECT policy with no `company_id` predicate must not exist; if no consumer needs it, grant nothing", plus the observation that an unconsumed grant is pure attack surface.

#### 3. Known gaps
**File**: `context/changes/testing-tenant-isolation-integration/KNOWN-GAPS.md`
**Intent**: Mark gap #2 CLOSED with the date, migration and assertions, mirroring how gap #1 was closed.
**Contract**: gap #2 rewritten as closed, naming the migration and Assertion 5c.

### Success Criteria:
#### Automated Verification:
- No remaining claim that Risk #2 waits on S-07/S-08: `grep -rn "S-07/S-08" context/ supabase/` reviewed, with migration comments either updated or explicitly noted as historical record
#### Manual Verification:
- A reader of `lessons.md` alone would not conclude the gap is still open.

**Implementation Note**: After this phase, re-run `/10x-test-plan` to reconcile.

---

## Testing Strategy

- **SQL** (`rls_isolation.sql`): policy-predicate proof — anon role sees zero, writes refused.
- **Integration** (`anon-read-scoping.test.ts`): attacker-path proof — real anon key vs PostgREST, with a service-role control so zero-rows cannot pass vacuously.
- **Non-tautology**: reinstate one policy → red; drop → green.

## Migration Notes

Pure subtraction, reversible with one `create policy` per table. Applies to the hosted DB
with no data change and no downtime. If S-07/S-08 later needs public reads, it must add a
`SECURITY DEFINER` RPC with a column projection — not re-add `using (true)`.

## References

- Research: `context/changes/anon-read-scoping/research.md`
- Gap→assertion template: `supabase/tests/rls_isolation.sql` Assertion 5b + `20260812220000_menu_item_category_composite_fk.sql`
- Precedent: `20260721120000_menu_item_photos.sql:28-32`, `20260804120000_room_objects.sql:85-88`, `20260727120000_room_layout_tables.sql:75-76`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Migration — drop the four unscoped anon policies

#### Automated
- [x] 1.1 Migration applies cleanly on a fresh database (`npx supabase db reset`) — 1397f70
- [x] 1.2 Direct anon-role query returns 0 rows on all four tables — 1397f70
- [x] 1.3 Authenticated staff reads unaffected (`npm run test:integration`) — 1397f70

#### Manual
- [x] 1.4 No app behaviour change (no anon consumer to break) — 1397f70

### Phase 2: SQL suite — re-baseline Assertion 5 and flip the gap

#### Automated
- [x] 2.1 `npm run test:rls:local` exits 0 with no `KNOWN GAP (Risk #2)` notices remaining — 1397f70
- [x] 2.2 No block still asserts anon sees tenant rows — 1397f70

#### Manual
- [x] 2.3 Non-tautology: reinstating one policy turns the suite red; dropping it returns green — 1397f70

### Phase 3: Integration — the real attacker path

#### Automated
- [x] 3.1 `npm run test:integration` passes including the new anon suite — 1397f70
- [x] 3.2 Lint + typecheck pass — 1397f70

#### Manual
- [x] 3.3 The service-role control proves zero-rows is the policy, not an empty database — 1397f70

### Phase 4: Backport the corrected premise

#### Automated
- [x] 4.1 No remaining claim that Risk #2 waits on S-07/S-08 (test-plan, lessons, KNOWN-GAPS) — 1397f70

#### Manual
- [x] 4.2 `lessons.md` alone no longer reads as "gap still open" — 1397f70
