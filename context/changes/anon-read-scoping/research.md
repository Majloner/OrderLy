---
date: 2026-08-13T01:30:21+0200
researcher: Intebuco_Milosz
git_commit: 8a6ca6386a83b763103f7d8457a520fda13cc82c
branch: fix/anon-read-scoping
repository: 10x
topic: "Risk #2 — anon reads are not company_id-scoped: where it lives, what proves protection, cheapest test"
tags: [research, rls, anon, tenant-isolation, risk-2]
status: complete
last_updated: 2026-08-13
last_updated_by: Intebuco_Milosz
---

# Research: Risk #2 — anon reads not scoped by `company_id`

## Research Question

Ground Risk #2 for a test (and possibly a fix): where does it actually pass through the
code, what behaviour would prove protection, and what is the cheapest test that catches it?

## Summary — the premise this rollout has been carrying is FALSE

Every prior artifact (test-plan §2 source, `lessons.md`, three migration comments, the
Phase 1 research, and the `KNOWN GAP` block itself) asserts that closing Risk #2 is
**blocked on S-07/S-08** because anon scoping needs a QR/table context. Research
disproves that:

**There is no anon consumer. Not one.** No browser Supabase client exists
(`createBrowserClient` — 0 hits repo-wide); the only client factory is server-only with
`access: "secret"` keys ([supabase.ts:1-9](src/lib/supabase.ts:1),
[astro.config.mjs:24-25](astro.config.mjs:24)); there are no `PUBLIC_*` env vars; no
dynamic page routes exist at all (no `[code]`, no QR landing); every one of the 24 API
routes guards first; and no test asserts anon can read anything.

So the four unscoped policies are **granting a surface nobody consumes**. The fix is not
"tighten the predicate" (which is not even expressible today — see §3) but **"drop an
unused attack surface"**. That is a policy change available *now*, not a product decision
deferred to S-07/S-08.

**The repo's own precedent says the same thing three times over.** `rooms`,
`room_objects` and `storage.objects` each deliberately carry **no** anon policy, with
comments explaining why — grant nothing to anon, serve the single row/object by exact
identifier through a non-enumerable path.

## 1. Where the risk actually passes through code

Not through application code at all — that is the defining property. The attacker path is
**anon key → PostgREST → role `anon` → RLS**, with no Astro route on it.

The four policies (the complete `to anon` set; no anon INSERT/UPDATE/DELETE anywhere):

| Table | Policy | Predicate | Defined |
|---|---|---|---|
| `companies` | `companies_anon_read` | `using (true)` | [minimal_tables_menu.sql:59](supabase/migrations/20260705215147_minimal_tables_menu.sql:59) |
| `tables` | `tables_anon_read_active` | `using (is_active)` | [minimal_tables_menu.sql:64](supabase/migrations/20260705215147_minimal_tables_menu.sql:64) |
| `menu_categories` | `menu_categories_anon_read` | `using (true)` | [menu_categories_items.sql:68](supabase/migrations/20260708124756_menu_categories_items.sql:68) |
| `menu_items` | `menu_items_anon_read_visible` | `archived_at is null and availability in (...)` | [menu_categories_items.sql:106](supabase/migrations/20260708124756_menu_categories_items.sql:106) |

**Concrete impact** — with only the public anon key, one request each:
- `companies` → **every restaurant on the platform**: id, name, address, opening hours, and the 6-char **venue code**. Since staff auth addresses are *derived* (`<login>@<code>.staff.orderly.invalid`, [staff-identity.ts:58-60](src/lib/staff-identity.ts:58)), a leaked code plus a plausible first name is a credential guess.
- `tables` → every active table of every venue with `room_id`, `pos_x/pos_y`, shape → the full floor plan.
- `menu_categories` / `menu_items` → every published item of every venue: name, price, description, allergens, live `sold_out` state, and `photo_path`.
- **Second-order Storage leak**: `menu_item_photos` deliberately withholds anon SELECT on `storage.objects` *precisely to prevent enumeration* ([menu_item_photos.sql:28-32]) — but `menu_items.photo_path` is anon-readable cross-tenant, so the exact-path list that policy refuses to hand out is reconstructable from `menu_items`. **Policy #4 currently undermines the Storage defence.**

## 2. What behaviour would prove protection

Derived from the risk (an attacker holding the public key), **not** from the shape of the
policies:

> Someone holding only the public anon key, with no session and no company context, can
> read **zero** tenant rows — no company, no venue code, no table geometry, no menu — and
> cannot write.

Corollaries worth asserting because a careless fix would break them, and because they are
*already true* and unprotected by any test:
- `rooms` and `room_objects` stay anon-invisible (room geometry).
- Hidden menu items (`unavailable`, archived) stay invisible.
- Anon writes stay refused.
- Authenticated staff reads are **unaffected** — dropping anon policies must not touch the owner/waiter/kitchen paths.

## 3. Why "add a `company_id` predicate" is not the fix

An RLS `USING` clause is a per-row boolean; it cannot observe whether the client filtered
by anything. A scoped anon policy needs a company identity *inside* the predicate, and the
stack has none:
- `current_company_id()` reads `profiles` via `auth.uid()`, which is NULL for anon → the predicate filters everything. Functionally identical to dropping, but leaves four dead policies pretending to grant something.
- A custom anon JWT claim would need the project to mint tokens — nothing does (no `jose`/`jsonwebtoken`; the only `request.jwt.claims` mention is a psql debugging note in `lessons.md:31`), and it would put the signing secret in the Worker with a printed-sticker token and no revocation.
- A per-request GUC cannot survive PostgREST's one-transaction-per-request model.
- A `request.headers`-derived venue code is entirely client-supplied — a blast-radius reducer, **not** an authentication boundary.

The durable shape for S-07/S-08 is a `SECURITY DEFINER` RPC taking a venue code and
returning a *column projection* (RLS is row-level and cannot narrow columns — which is how
`companies.address` and every `code` leak today). But that belongs to the slice that needs
it; it should be built on a clean default-deny slate, not on top of `using (true)`.

## 4. Cheapest test that catches the risk

**Two layers, different jobs — and one of them does not exist at all today.**

- **SQL (`set local role anon`)** tests the *policy predicate*. It runs in psql as superuser doing `set local role`; it never traverses the API gateway, PostgREST's schema exposure, the anon-key→role mapping, or table GRANTs.
- **Integration (`anonClient()`)** tests the *actual attacker path* end to end: real anon JWT → gateway → PostgREST → role `anon` → GRANTs → RLS. `anonClient()` ([clients.ts:29-31](tests/integration/helpers/clients.ts:29)) is literally the public key with no session — the same credential an attacker holds.

**Existing anon coverage is 25 route-layer assertions (anon→401) and every one is irrelevant to Risk #2** — the guard is the first statement in each handler, so the query never runs. There is currently **zero** integration coverage of the anon-key-vs-database surface, and no test anywhere issues a raw anon table query.

Cheapest with real signal: **both**, ~40 lines of integration reusing `seed.anon` +
`seed.companyB.resources` (no new fixtures), plus the SQL flip. Neither needs new infrastructure.

## 5. ⚠ Interlock that would have broken the implementation

**Assertion 5 currently asserts the leak.** [rls_isolation.sql:220-223] expects anon to see
`2` companies, `2` active tables, `3` items, `2` categories — counts that span **both**
fixture companies. Flipping the `KNOWN GAP` block to exceptions **without simultaneously
re-baselining those four counts** makes the suite self-contradictory: one block asserts
anon sees B, the next asserts it does not. **Assertion 5 and the gap block must be edited
as one unit.**

## 6. Blast radius of dropping the four policies

- RLS is enabled on all four tables, so with no matching policy **anon sees zero rows** (default-deny). Empirically confirmed by the suite: `rooms`/`room_objects` have no anon policy and `rls_isolation.sql:224-225` already asserts anon sees 0.
- No `GRANT`/`REVOKE` exists in any migration; stock Supabase table-level SELECT for `anon` is harmless without a policy under enabled RLS.
- SD functions callable by anon leak nothing: `current_company_id()`/`current_staff_role()` return NULL without `auth.uid()`; the reorder RPCs are **`security invoker`**, so they run as `anon` with no UPDATE policy → zero rows. (Worth recording: they are safe *only* because they are invoker.)
- Storage is unaffected — the bucket is public and served by exact path; what changes is that the paths stop being enumerable.
- Nothing in the running app breaks. Only the SQL suite needs updating (§5).

## Code References

- `src/lib/supabase.ts:1-9`, `astro.config.mjs:24-25` — server-only keys, no browser client.
- `src/middleware.ts:35,38` — anon requests issue zero DB reads.
- `supabase/migrations/20260705215147_minimal_tables_menu.sql:59,64` · `20260708124756_menu_categories_items.sql:68,106` — the four policies.
- `20260721120000_menu_item_photos.sql:28-32` · `20260804120000_room_objects.sql:85-88` · `20260727120000_room_layout_tables.sql:20-24,75-76` — the "no anon policy" precedent, three times.
- `supabase/tests/rls_isolation.sql:199-236` (Assertion 5, the interlock), `:238-276` (KNOWN GAP), `:278-327` (Assertion 5b — the gap→assertion template).
- `tests/integration/helpers/clients.ts:29-31`, `fixtures.ts:273` — `anonClient()` / `seed.anon`.
- `tests/integration/isolation/cross-tenant-read.test.ts:58-68` — the raw-query idiom to copy (`.overrideTypes<T,{merge:false}>()`; `as`/`!` are lint-forbidden).

## Incidental findings (out of scope, worth logging)

- `src/pages/api/auth/signout.ts` is missing `export const prerender = false` — an AGENTS.md hard rule ("every API route must export it"). Every other route has it.
- `POST /api/company/profile` returns a 302 redirect for anon rather than 401 (already known from Phase 1).

## Corrections to backport into the test plan

The §2 Source for Risk #2 and `lessons.md` both carry "the fix belongs to S-07/S-08".
That is now disproven — the surface has no consumer and can be removed today.
`KNOWN-GAPS.md` §2 and the migration comments repeat the same premise.
