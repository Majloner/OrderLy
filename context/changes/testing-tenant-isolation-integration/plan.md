# Integration Harness + Tenant Isolation (Test-Plan Phase 1) — Implementation Plan

## Overview

Stand up the project's first **integration test layer** and use it to pin the three top tenant-isolation risks from `context/foundation/test-plan.md` §2:

- **#1** — a request authenticated as company A never reads or mutates company B rows on any domain entity; the `owner` role does not lift the tenant boundary.
- **#2** — the anon key does not read rows across tenants; unscoped anon-read policies are the failure surface.
- **#3** — owner-only writes return 403 for waiter/kitchen and 401 for anonymous; a happy-path 200 does not imply authorization holds.

The isolation *logic* already exists and is sound (see Current State). This phase does **not** fix a live breach — it builds a harness and writes tests that lock the behavior in, plus makes one known DB-layer gap visible.

## Current State Analysis

Grounded in `context/changes/testing-tenant-isolation-integration/research.md` (git b8955f9):

- **RLS is enforced and `company_id`-scoped on every tenant table.** `company_id`/`role` resolve server-side from `auth.uid()` via `SECURITY DEFINER` helpers `current_company_id()` / `current_staff_role()` ([staff_accounts_roles.sql:52-76](supabase/migrations/20260727220415_staff_accounts_roles.sql:52)); every owner check is AND-composed with the company predicate (owner never lifts the boundary); every write carries a `WITH CHECK` pinning `company_id`.
- **API authorization lives in per-handler guards, not middleware.** `src/middleware.ts` gates only *page* routes via redirect; `matchesRoute` never matches `/api/*`. Every `/api/*` mutation calls `guardMenuRequest` / `guardTablesRequest` / `guardStaffRequest` → **401** unauthenticated, **403** wrong-role/no-company ([api.ts:29-95](src/lib/api.ts:29), [room-api.ts:18-45](src/lib/room-api.ts:18)). `guardStaffRequest` is owner-only for read AND write.
- **Route handlers are thin `(context) =>` functions** reading only `context.request` + `context.locals` (`{user, company_id, role, display_name, supabase}`, contract in [env.d.ts:1-11](src/env.d.ts:1)); the guard uses `context.locals.supabase` as its DB client. This makes handlers **synthetically invokable** without an HTTP server.
- **No integration harness exists.** Vitest 4 is configured for unit only ([vitest.config.ts](vitest.config.ts), `include: src/**/*.test.ts`, no `setupFiles`, no Astro plugin). Importing `src/lib/supabase.ts` / `src/middleware.ts` under Vitest fails on the unresolved `astro:env/server` / `astro:middleware` virtual modules. `npm run test:rls` runs `--linked` (hosted), not local.
- **A working SQL RLS suite exists** — `supabase/tests/rls_isolation.sql` (794 lines, plain SQL, 23 assertions, 2 companies × roles fixture, `begin;…rollback;`), run via `npm run test:rls` ([package.json:19](package.json:19)).
- **Risk #2 has no route to test through** — every menu/room/staff endpoint 401s for anon; the public QR-menu path (S-07/S-08) is not built. The four anon SELECT policies are UNSCOPED (`companies_anon_read using(true)`, `tables_anon_read_active using(is_active)`, `menu_categories_anon_read using(true)`, `menu_items_anon_read_visible`).
- **Residual schema gap**: `menu_items.category_id` is an id-only FK ([menu_categories_items.sql:78](supabase/migrations/20260708124756_menu_categories_items.sql:78)) — the cross-entity attach class already closed for `tables.room_id` by a composite FK. The route guards it at the app layer via `categoryExistsInCompany` ([api.ts:101](src/lib/api.ts:101)); the DB layer does not.

## Desired End State

A developer can run `npm run test:integration` and `npm run test:rls` against a local Supabase and get deterministic, isolated proof that:

- every write route rejects waiter/kitchen (403) and anonymous (401), and the two staff-wide reads behave correctly (menu/room readable by all roles, staff owner-only);
- a company-A principal cannot read or mutate any company-B row on any domain entity — **verified by querying the DB for effect**, not just by HTTP status — and `owner` does not change that;
- cross-tenant `category_id` attach is rejected at the route layer, with the DB-layer gap documented;
- the anon RLS gap (#2) is demonstrated and labeled at the SQL layer, ready to flip to a hard assertion when S-07/S-08 scopes the policies.

The test-plan cookbook §6.2 / §6.4 / §6.5 are filled in with real locations, naming, reference tests, and run commands.

### Key Discoveries:

- Handlers read `context.locals` for `{user, company_id, role, supabase}`; the guard's role check uses `locals.role`, while RLS uses the JWT carried by `locals.supabase` — **both must be set consistently per principal** ([api.ts:33-48](src/lib/api.ts:33)).
- Owner bootstrap runs via the `handle_new_user()` trigger on `auth.users` insert, reading `raw_user_meta_data.company_name`, seeding company + owner profile + categories + room + venue code in one step (proven in `rls_isolation.sql:594-644`) — the cheapest way to seed a whole tenant.
- Staff auth addresses are derived, never stored: `staffAuthEmail(venueCode, login)` = `{login}@{venue}.staff.orderly.invalid` ([staff-identity.ts:58-60](src/lib/staff-identity.ts:58)).
- Env names the harness needs: `SUPABASE_URL`, `SUPABASE_KEY` (anon), `SUPABASE_SERVICE_ROLE_KEY`; local ports API 54321 / DB 54322 (`supabase/config.toml`).

## What We're NOT Doing

- **Not** standing up an HTTP server or testing middleware page-redirects (anon → `/auth/signin`, `POST /api/company/profile` → 302). The security boundary (API 401/403 + RLS) is fully covered synthetically; page redirects are UX and deferred (revisit with an e2e layer, test-plan §3 Phase 4).
- **Not** fixing the anon-read RLS scoping (#2) — that is S-07/S-08 (public QR menu). Phase 1 only makes the gap visible and testable.
- **Not** adding a composite FK for `menu_items.category_id` — the route-layer invariant is tested now; the DB-layer schema fix is logged as a follow-up.
- **Not** wiring CI (GitHub Actions) or the post-edit hook — that is test-plan §3 Phase 3 (Quality Gates).
- **Not** writing photo/Storage or IDOR (#4), input-validation parity (#5), or staff-privilege-invariant (#6) tests — those are test-plan §3 Phase 2.
- **Not** using the `--linked` hosted DB as the integration base (kept only as a documented alt).

## Implementation Approach

Build the harness once (Phase 1), then layer risk suites on top:

- **Invocation**: synthetic `APIContext` — call the exported route handler directly with a hand-built context whose `locals` carries a per-principal Supabase client. Exercises the real guard code and real Postgres RLS with no server.
- **Clients/env**: a test-only helper builds anon / per-role / service-role clients with `@supabase/supabase-js` straight from `process.env` (loaded via dotenv in `setupFiles`), sidestepping `astro:env`. No import of `src/lib/supabase.ts`.
- **DB**: local `npx supabase start`; reset + reseed between suites so runs are isolated and CI-reproducible.
- **Coverage**: a parametrized route registry drives the #3 authz matrix cheaply; #1 uses focused per-entity tests that **verify effect in the DB**; #2 lives in the SQL RLS suite.

## Critical Implementation Details

- **`locals.role` vs JWT are two separate identities that must agree.** The guard's 403 decision reads `context.locals.role`; RLS reads the JWT inside `context.locals.supabase`. A test principal must set both from the same seeded user, or a test could pass the guard while RLS sees a different tenant (false green). The client helper must return `{ client, user, company_id, role }` as one unit and the context builder must consume all of it.
- **Synthetic `APIContext` is a signature contract** the #2/#3 phases depend on. Minimum shape the handlers/guards touch: `{ request: Request, locals: { user, company_id, role, display_name, supabase }, params, cookies, redirect }`. Anything else Astro injects is unused by these handlers and can be omitted or stubbed.
- **Keep integration tests out of the unit glob.** `vitest.config.ts` globs `src/**/*.test.ts` and must stay DB-free; integration tests live under `tests/integration/**` behind a separate config, or unit runs break without a running Supabase.
- **Risk #2 is a known-gap spec, not a passing guarantee.** The anon policies are deliberately unscoped until S-07/S-08. The Phase 4 assertion must *demonstrate and label* the leak (`raise notice`, not `raise exception`) so the suite stays green and honest — a green test asserting "anon sees all companies" would falsely read as approval. It is written so S-07/S-08 flips one line (`notice` → `exception`).
- **Anon principal short-circuits before the DB.** For anon, `locals.user = null` and the guard returns 401 before touching `locals.supabase`; the anon client is still needed for the #1/#2 read-attempt tests, not for the guard tests.

## Phase 1: Integration Harness Scaffolding

### Overview

Everything the risk suites stand on: local Supabase lifecycle, a separate Vitest integration config, the test-only client helper, the synthetic-context builder, and the 2-companies × 3-roles + anon fixture seeder.

### Changes Required:

#### 1. Integration Vitest config

**File**: `vitest.integration.config.ts` (new)

**Intent**: A dedicated config so integration tests run separately from unit, with DB-appropriate timeouts and env loading, without polluting the unit glob.

**Contract**: `include: ["tests/integration/**/*.test.ts"]`, `environment: "node"`, `@` alias → `./src`, `setupFiles: ["tests/integration/setup.ts"]`, raised `testTimeout`/`hookTimeout` for DB round-trips, `fileParallelism: false` (serialize suites that share the DB). Leave `vitest.config.ts` untouched (its `src/**/*.test.ts` glob already excludes `tests/`).

#### 2. Env + setup file

**File**: `tests/integration/setup.ts` (new), `.env.test.example` (new)

**Intent**: Load local-Supabase env into `process.env` for the helper and fail fast with a clear message if Supabase isn't running.

**Contract**: dotenv loads `.env.test` (gitignored) documented by `.env.test.example` listing only names: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (local defaults from `npx supabase status`). Setup asserts all three present and the API is reachable; otherwise throws a message pointing at `npx supabase start`.

#### 3. Test-only Supabase client helper

**File**: `tests/integration/helpers/clients.ts` (new)

**Intent**: Build the three client kinds a principal needs, from `process.env`, without `astro:env` or `src/lib/supabase.ts`.

**Contract**: exports `anonClient()`, `serviceRoleClient()`, and `signInAs({ email, password }): Promise<SupabaseClient>` (an authenticated anon-key client carrying the user's JWT, `persistSession: false`). All via `@supabase/supabase-js`. Service-role client used only for seeding/verification.

#### 4. Fixture seeder

**File**: `tests/integration/helpers/fixtures.ts` (new)

**Intent**: Create two full tenants and their staff, then hand back per-principal handles the context builder can consume.

**Contract**: `seedTwoCompanies()` returns `{ companyA, companyB }`, each `{ company_id, venue_code, owner, waiter, kitchen }` where every principal is `{ client, user, company_id, role }`. Owners bootstrapped via service-role `auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { company_name } })` (fires `handle_new_user`); waiter/kitchen created as auth users + owner-inserted `profiles` rows mirroring the app's staff-provisioning path (`staffAuthEmail` addresses). Also `resetDb()` (truncate/`db:reset`) for between-suite isolation. Model: `supabase/tests/rls_isolation.sql:28-89`.

#### 5. Synthetic context builder

**File**: `tests/integration/helpers/context.ts` (new)

**Intent**: Turn a principal + request into the `APIContext` shape the handlers read, so a test is one line.

**Contract**: `buildContext(principal, { method, url, body?, params? }): APIContext` producing `{ request, locals: { user, company_id, role, display_name, supabase: principal.client }, params, cookies, redirect }`. For the anon principal, `user/company_id/role = null` and `supabase = anonClient()`. This is the shared contract Phases 2–3 consume.

#### 6. npm scripts

**File**: `package.json`

**Intent**: One command to run integration; keep RLS runnable locally.

**Contract**: add `"test:integration": "vitest run -c vitest.integration.config.ts"`; add a local-DB RLS variant (e.g. `"test:rls:local": "supabase db query --local --file supabase/tests/rls_isolation.sql"`) leaving `test:rls` (`--linked`) as the documented alt. Do not fold integration into `test` (keeps unit DB-free).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests still pass and remain DB-free: `npm run test`
- Integration config resolves and a trivial smoke test (seed two companies, sign in owner A, assert a scoped read) passes: `npm run test:integration`

#### Manual Verification:

- With Docker + `npx supabase start`, a fresh clone can run `npm run test:integration` green after copying `.env.test.example` → `.env.test`.
- `resetDb()` leaves no cross-suite residue (two consecutive runs are identical).

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Risk #3 — Request-layer Authorization Matrix

### Overview

Prove every write route rejects waiter/kitchen (403) and anon (401), the two staff-wide reads are open to all roles, and `GET /api/staff` is owner-only — via a parametrized registry so a new route is one row.

### Changes Required:

#### 1. Route registry + parametrized authz suite

**File**: `tests/integration/authz/route-matrix.ts` (new), `tests/integration/authz/write-routes.test.ts` (new)

**Intent**: Enumerate every mutating route once and assert the guard verdict per principal, driving the real handler through a synthetic context.

**Contract**: registry rows `{ path, method, handler, buildBody(companyCtx), roles }`. The parametrized test asserts: waiter → 403, kitchen → 403, anon → 401 for every write row; owner → 2xx (happy path). Handlers imported from `src/pages/api/**`. Covers menu (categories/items + reorder), room (rooms/tables + position/activation), staff (POST, PUT). Photo routes excluded (Phase 2 of the rollout / Storage).

#### 2. Read-authorization tests

**File**: `tests/integration/authz/read-routes.test.ts` (new)

**Intent**: Lock the read asymmetry the guards encode.

**Contract**: `GET /api/menu` and `GET /api/room` → 2xx for owner, waiter, kitchen; 401 for anon. `GET /api/staff` → 2xx owner, **403** waiter/kitchen, 401 anon.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes with the full write-matrix and read-authz suites.
- Every mutating route under `src/pages/api/{menu,room,staff}` (excluding photo) appears as a registry row (a guard asserts registry completeness against the route file list).
- Linting + typecheck pass.

#### Manual Verification:

- Temporarily removing a guard call from one route turns its matrix rows red (harness actually exercises the guard, not a mock).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Risk #1 — Cross-tenant Isolation (verify effect in DB)

### Overview

Prove a company-A principal never reads or mutates company-B rows on any entity, verified by querying the DB for effect (not just HTTP status), and that `owner` does not lift the boundary. Includes the `category_id` route-layer test + DB-gap note.

### Changes Required:

#### 1. Cross-tenant read tests

**File**: `tests/integration/isolation/cross-tenant-read.test.ts` (new)

**Intent**: For each entity, an A-owner read never contains B rows.

**Contract**: per entity (menu categories, menu items, rooms, tables, staff, company profile) drive the GET/list handler as owner A; assert the response set contains only A ids and zero B ids (B ids fetched via service-role for the assertion). Repeat the read as A across owner and (where allowed) waiter to confirm role does not widen the tenant set.

#### 2. Cross-tenant write tests (verify no B effect)

**File**: `tests/integration/isolation/cross-tenant-write.test.ts` (new)

**Intent**: An A principal targeting a B resource id is denied AND leaves B unchanged.

**Contract**: as owner A, issue PUT/DELETE/PATCH against a B-owned resource id (menu item, category, room, table, staff, company). Assert the handler denies (403/404 per route), then **query as service-role** to confirm the B row is byte-for-byte unchanged and no A-stamped row leaked into B. This is the belt-and-suspenders "verify effect in DB" the test-plan §2 anti-pattern list demands.

#### 3. `category_id` cross-entity attach test + gap note

**File**: `tests/integration/isolation/category-attach.test.ts` (new); note appended to `research.md` open-questions or a `KNOWN-GAPS.md` in the change folder

**Intent**: Prove the route-layer ownership check blocks attaching an item to another company's category; record the DB-layer gap.

**Contract**: as owner A, `POST /api/menu/items` with `categoryId` = a B category → assert rejection (route calls `categoryExistsInCompany`, [api.ts:101](src/lib/api.ts:101)) and verify no A item row was created. Add a documented note: the DB layer (`menu_items.category_id` id-only FK, [menu_categories_items.sql:78]) still permits this via a direct authenticated insert — candidate for a composite-FK follow-up change, analogous to `room_tables_composite_fk`.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes read + write isolation suites for all listed entities.
- The `category_id` route-layer rejection test passes and asserts zero rows created.
- Linting + typecheck pass.

#### Manual Verification:

- The DB-gap note exists and points at the exact migration line and a proposed follow-up.
- Spot-check: flipping one cross-tenant write assertion to expect success fails loudly (assertions are real, not tautological).

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Risk #2 — Anon RLS Scoping (SQL layer)

### Overview

Extend the SQL RLS suite to demonstrate and label the anon cross-tenant read gap on the four unscoped policies, and make the suite runnable against local Supabase.

### Changes Required:

#### 1. Anon cross-tenant read section in the RLS suite

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: With two companies seeded and both holding anon-visible rows, show the anon key returns both companies' rows on `companies`, `tables`, `menu_categories`, `menu_items`, and label it as the known Risk #2 gap.

**Contract**: a new `-- KNOWN GAP (Risk #2): anon read not company_id-scoped` block: `set local role anon`, select each of the four tables, and `raise notice` with the cross-tenant row count + a reference to `context/foundation/lessons.md` and S-07/S-08. It must **not** `raise exception` (policies are intentionally unscoped today). Keep the existing anon assertions (archived/unavailable hidden, no anon write) intact.

#### 2. Local run wiring

**File**: `package.json` (from Phase 1), docs note

**Intent**: Run the RLS suite against the same local DB the integration tests use.

**Contract**: confirm `test:rls:local` (`--local`) executes the suite green (notices printed) against `npx supabase start`.

### Success Criteria:

#### Automated Verification:

- `npm run test:rls:local` runs the suite to completion (exit 0) against local Supabase, printing the Risk #2 known-gap notices.
- The existing 23 assertions still pass unchanged.

#### Manual Verification:

- The known-gap block is unmistakably labeled and worded so S-07/S-08 flips a single `notice` → `exception`.
- The four unscoped policies are each represented in the block.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Cookbook (§6) + Run Scripts

### Overview

Fill the test-plan cookbook so "how do I add a test for X here?" is answerable, and confirm the run commands.

### Changes Required:

#### 1. Cookbook §6.2 / §6.4 / §6.5

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the `TBD — see §3 Phase 1` placeholders with real guidance grounded in what this phase built.

**Contract**:
- **§6.2 Adding an integration test** — location `tests/integration/**`, naming `<area>.test.ts`, reference test (the write-matrix suite), run `npm run test:integration`, note the local-Supabase prerequisite.
- **§6.4 Adding a test for a new API endpoint** — add a registry row in `route-matrix.ts`; the parametrized matrix covers authz automatically; add an isolation test if it touches a new entity; drive via `buildContext`.
- **§6.5 Adding an RLS isolation assertion** — extend `supabase/tests/rls_isolation.sql` (anon + 2 companies), run `test:rls:local`.

#### 2. Phase-note (§6.6)

**File**: `context/foundation/test-plan.md`

**Intent**: 2–3 lines on where fixtures/roles live and the `locals.role`-vs-JWT gotcha, for the next contributor.

**Contract**: append to §6.6 pointing at `tests/integration/helpers/` and the dual-identity note.

### Success Criteria:

#### Automated Verification:

- `test-plan.md` §6.2/§6.4/§6.5 contain no remaining `TBD — see §3 Phase 1`.
- `npm run test:integration` and `npm run test:rls:local` commands referenced in the cookbook execute as written.

#### Manual Verification:

- A contributor unfamiliar with the harness can add a passing endpoint test by following §6.4 alone.

**Implementation Note**: After this phase, the test-plan §3 Phase 1 row is marked `complete` by re-running `/10x-test-plan` (not edited here).

---

## Testing Strategy

### Unit Tests:

- Unchanged; stay DB-free under `vitest.config.ts`. No new unit tests in this phase (harness is integration by nature).

### Integration Tests:

- Authz matrix: all write routes × {waiter 403, kitchen 403, anon 401} + owner 2xx; read asymmetry for menu/room/staff.
- Isolation: per-entity cross-tenant read (no B ids returned) and write (B row unchanged, verified via service-role), plus `category_id` route-layer rejection.
- All run against local `npx supabase start`; DB reset/reseed per suite for isolation.

### SQL RLS Tests:

- Extended `rls_isolation.sql` with the anon cross-tenant known-gap block; run via `test:rls:local`.

### Manual Testing Steps:

1. `npx supabase start`; copy `.env.test.example` → `.env.test`.
2. `npm run test:integration` → all suites green.
3. `npm run test:rls:local` → exit 0, Risk #2 notices printed.
4. Remove one route's guard call → matrix rows for that route go red; restore.

## Performance Considerations

- Serialize DB-sharing suites (`fileParallelism: false`) to avoid cross-suite interference; acceptable given the small suite count. Seed via the `handle_new_user` trigger (one `createUser` per tenant) rather than many inserts to keep setup fast.

## Migration Notes

- No production schema migration in this phase. The `menu_items.category_id` composite-FK fix is logged as a follow-up, not applied.
- `.env.test` must be gitignored; only `.env.test.example` (names, local defaults) is committed. Never commit service-role keys.

## References

- Research: `context/changes/testing-tenant-isolation-integration/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risks, §3 Phase 1, §6 cookbook)
- Lessons: `context/foundation/lessons.md` (anon-RLS scoping; Storage service-role)
- Reference SQL harness: `supabase/tests/rls_isolation.sql`
- Guards: `src/lib/api.ts:29-139`, `src/lib/room-api.ts:18-45`
- Handler shape: `src/pages/api/menu/items.ts`, `src/pages/api/staff/index.ts`; locals contract `src/env.d.ts:1-11`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Integration Harness Scaffolding

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 40f09e0
- [x] 1.2 Linting passes: `npm run lint` — 40f09e0
- [x] 1.3 Unit tests still pass and remain DB-free: `npm run test` — 40f09e0
- [x] 1.4 Integration smoke test passes (seed two companies, owner-A scoped read): `npm run test:integration` — 8dd336d

#### Manual

- [x] 1.5 Fresh clone runs `npm run test:integration` green after `.env.test.example` → `.env.test` (Docker + `supabase start`)
- [x] 1.6 `resetDb()` leaves no cross-suite residue (two consecutive runs identical)

### Phase 2: Risk #3 — Request-layer Authorization Matrix

#### Automated

- [x] 2.1 `npm run test:integration` passes full write-matrix + read-authz suites — 8dd336d
- [x] 2.2 Every mutating menu/room/staff route (excl. photo) present as a registry row (completeness guard) — 40f09e0
- [x] 2.3 Linting + typecheck pass — 40f09e0

#### Manual

- [x] 2.4 Removing a guard call turns that route's matrix rows red (real exercise, not mocked)

### Phase 3: Risk #1 — Cross-tenant Isolation (verify effect in DB)

#### Automated

- [x] 3.1 `npm run test:integration` passes read + write isolation suites for all listed entities — 8dd336d
- [x] 3.2 `category_id` route-layer rejection test passes and asserts zero rows created — 8dd336d
- [x] 3.3 Linting + typecheck pass — 40f09e0

#### Manual

- [x] 3.4 DB-gap note exists, points at the exact migration line + proposed follow-up
- [x] 3.5 Flipping one cross-tenant write assertion to expect success fails loudly

### Phase 4: Risk #2 — Anon RLS Scoping (SQL layer)

#### Automated

- [x] 4.1 `npm run test:rls:local` runs to completion (exit 0) against local Supabase, printing Risk #2 notices — 8dd336d
- [x] 4.2 Existing 23 RLS assertions still pass unchanged — 8dd336d

#### Manual

- [x] 4.3 Known-gap block is labeled so S-07/S-08 flips a single `notice` → `exception`
- [x] 4.4 All four unscoped policies represented in the block

### Phase 5: Cookbook (§6) + Run Scripts

#### Automated

- [x] 5.1 §6.2/§6.4/§6.5 contain no remaining `TBD — see §3 Phase 1` — 40f09e0
- [x] 5.2 Cookbook-referenced commands (`test:integration`, `test:rls:local`) execute as written — 40f09e0

#### Manual

- [x] 5.3 A contributor can add a passing endpoint test by following §6.4 alone
