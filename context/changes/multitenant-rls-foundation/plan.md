# Multi-tenant Foundation (company_id + RLS + roles) Implementation Plan

## Overview

Establish OrderLY's multi-tenant data foundation on Supabase: a `companies` tenant entity, a
`profiles` table binding each `auth.users` row to exactly one company and staff role, a
`staff_role` enum, and Row-Level Security (RLS) that isolates every company's data. Includes
minimal `tables` and `menu_items` domain tables so anonymous (QR) read policies are real from
day one, plus an automated cross-tenant isolation test — the guardrail gate that every later
slice inherits.

## Current State Analysis

- **Auth works, schema is empty.** `@supabase/ssr` is wired; [middleware.ts](../../../src/middleware.ts) sets `App.Locals.user` from the session; [supabase.ts](../../../src/lib/supabase.ts) builds the server client from `SUPABASE_URL`/`SUPABASE_KEY`. No domain tables, no roles, no `company_id` anywhere in `src/`.
- **No migration tooling in use.** `supabase/` holds only `config.toml` (Postgres 17, `[db.migrations]` present, `schema_paths = []`) + `.gitignore`. No `supabase/migrations/`. Supabase CLI `^2.23.4` is a devDependency but there are no npm scripts and the project is not linked to the hosted instance.
- **`App.Locals` is thin.** [env.d.ts](../../../src/env.d.ts) declares only `user: User | null`.
- **Hosted project is live** (`xvrwteiiyhtmrphpebcp`), reachable via the publishable key; this is the MVP database we push migrations to.

### Key Discoveries:

- One user = one company is authoritative (PRD "konto odpowiada jednemu lokalowi"; owner provisions staff *within* their company) → a 1:1 `profiles` table is sufficient; no M:N membership needed.
- Owner role is a superset of waiter+kitchen (PRD Access Control) — enforced in app logic / policy predicates, not a separate hierarchy table.
- Anonymous client access is by *published/active* flag, not by session — real per-table session isolation arrives with orders in S-08. For F-01 (no orders yet) public read of active `companies`/`tables`/`menu_items` is safe and correct.

## Desired End State

On the hosted Supabase DB: `companies`, `profiles`, `tables`, `menu_items` exist with RLS
default-deny; `SECURITY DEFINER` helpers resolve the caller's company/role from `profiles`;
staff can CRUD only their company's rows; anonymous callers can SELECT published venue/menu/table
rows and nothing else. `App.Locals` carries `company_id` + `role`, populated by middleware. An
automated SQL isolation test proves cross-tenant denial and the anon read/write boundary, and
passes.

**Verification:** `npm run db:push` applies cleanly; the isolation test script exits 0; `npm run build` + typecheck + lint pass; a seeded owner request populates `locals.company_id`/`role`, an anonymous request does not and does not crash.

## What We're NOT Doing

- **No registration flow / UI** (that is S-01 `owner-company-registration`) — F-01 seeds a test company+owner only for verification.
- **No full menu/room features** — `tables`/`menu_items` are *minimal* (company scope + publish flag + the few columns anon-read needs). Categories, allergens, photos/thumbnails (S-03/S-04), the visual room editor, table activation nuances, and QR generation (S-06/S-07) extend them later. **Ownership note (conscious scope choice):** these tables land in F-01 to make anon-read real now; S-03/S-06 must `ALTER` them (not `CREATE`), and `/10x-archive` will record this overlap on the roadmap so those slices know the tables already exist.
- **No per-table anonymous *session* isolation / orders** — that is S-08. F-01's anon policy is published-data read only.
- **No custom JWT access-token hook** — role/company are read from `profiles` via helpers, not injected into the JWT.
- **No local Docker requirement** — migrations author + push to hosted; the isolation test runs against a Postgres via `psql`/`supabase db execute` (Docker/`supabase test db` is an optional local alternative).

## Implementation Approach

Author versioned SQL migrations with the Supabase CLI and push them to the hosted project.
Build bottom-up: tenancy core (enum + companies + profiles + helpers + RLS) → minimal domain
tables + anon policies → seed + automated isolation test (validate the security model **before**
building on it) → wire `App.Locals`/middleware last. Every table is RLS default-deny; access is
granted only through explicit policies expressed via the `auth.current_company_id()` /
`auth.current_role()` helpers so policies stay uniform and the tenant source-of-truth is one table.

## Critical Implementation Details

- **RLS tests need a simulated auth context.** Policies read `auth.uid()` (from `request.jwt.claims`). The isolation test must, per tenant, `SET LOCAL ROLE authenticated` and `SET LOCAL request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}'` before asserting row visibility; anon assertions use `SET LOCAL ROLE anon`. Without this, everything runs as table owner and RLS is bypassed — a test that silently proves nothing.
- **`profiles.user_id` FKs `auth.users`.** Seeding test tenants requires real `auth.users` rows (insert via service-role SQL or the admin API); profiles cannot reference invented UUIDs. Keep test tenants out of the main `seed.sql` (which would pollute prod on reset) — seed them inside the test transaction and roll back, or under a clearly-namespaced test fixture.
- **Helpers must be `SECURITY DEFINER` + stable search_path.** They read `profiles` under RLS; define them `SECURITY DEFINER SET search_path = ''` and reference `public.profiles` fully-qualified, or the helper itself gets caught by RLS / search-path hijack.
- **Push targets a live DB.** `supabase db push` runs against the hosted MVP database; review each migration's diff before pushing. No destructive/irreversible statements in these migrations (all additive).

## Phase 1: Migration tooling + tenancy core

### Overview

Wire the Supabase CLI migration workflow and create the tenancy spine: role enum, `companies`,
`profiles`, resolver helpers, and RLS (default-deny + staff policies).

### Changes Required:

#### 1. Migration tooling

**File**: `package.json`, project ↔ hosted link

**Intent**: Make versioned migrations the way schema changes reach the hosted DB, runnable via npm.

**Contract**: Add scripts — `db:new` (`supabase migration new`), `db:push` (`supabase db push`), `db:reset` (`supabase db reset`, local), and `test:rls` (runs the Phase 3 isolation test). `supabase/migrations/` is created by the first `db:new`.

**Prerequisite (privileged access — do first):** the project is NOT yet linked and `db push`/`test:rls` need privileged credentials that are absent today:
- Authenticate the CLI: `supabase login` (or export `SUPABASE_ACCESS_TOKEN`) — needed for `db push`.
- Link to the hosted project: `supabase link --project-ref xvrwteiiyhtmrphpebcp` (this rewrites the local `project_id` placeholder in `config.toml`).
- Provide a privileged DB connection string for `test:rls` as a **local-only** `DATABASE_URL` (the project's Postgres connection string with the DB password). `test:rls` needs it to `SET ROLE` and seed `auth.users`; the publishable/anon key cannot run this.
All three stay OUT of git (`.dev.vars` / shell env), same discipline as the Worker secrets.

#### 2. Tenancy core migration

**File**: `supabase/migrations/<ts>_tenancy_core.sql`

**Intent**: Create the tenant + membership/role model that all isolation hangs off.

**Contract**:
- `create type staff_role as enum ('owner','waiter','kitchen');`
- `companies(id uuid pk default gen_random_uuid(), name text not null, address text, opening_hours text, created_at timestamptz default now())`
- `profiles(user_id uuid pk references auth.users(id) on delete cascade, company_id uuid not null references companies(id) on delete cascade, role staff_role not null, full_name text, created_at timestamptz default now())`
- Enable RLS on both (default-deny — no policy = no access).
- Helpers (`SECURITY DEFINER`, `search_path=''`): `public.current_company_id() returns uuid` and `public.current_staff_role() returns staff_role`, each selecting from `public.profiles where user_id = auth.uid()`.
- Staff policies: `profiles` — a user reads/updates rows where `company_id = current_company_id()`; `companies` — read where `id = current_company_id()`, update restricted to `current_staff_role() = 'owner'`.
- **No INSERT/DELETE policy for `authenticated`/`anon` on `companies`/`profiles` — intentional.** Bootstrapping a company + owner is privileged and runs via the **service-role** key (which bypasses RLS); the authenticated registration flow (a service-role endpoint or a `SECURITY DEFINER register_company` RPC) is **S-01's** job. Do NOT add a permissive `INSERT ... with check (true)` here — it would let any logged-in user create companies or self-assign into another company / set their own role to `owner` (a tenancy hole).

### Success Criteria:

#### Automated Verification:

- Project linked & authenticated: `npx supabase link --project-ref xvrwteiiyhtmrphpebcp` + `npx supabase projects list` succeed
- `npm run db:push` applies the migration cleanly to hosted
- `npx supabase migration list` shows the migration as applied
- RLS is enabled on `companies` and `profiles` (`pg_class.relrowsecurity = true`)
- Helper functions exist and are `SECURITY DEFINER` (catalog query)
- `npm run lint` passes

#### Manual Verification:

- In Studio SQL editor, simulating an owner of company A (`request.jwt.claims`) shows only A's `companies`/`profiles` rows
- With no JWT context set, `select` on either table returns zero rows (default-deny holds)

---

## Phase 2: Minimal domain tables + anonymous read

### Overview

Add minimal `tables` and `menu_items` (company-scoped) and the policy set: staff CRUD scoped by
company, anonymous SELECT of published rows.

### Changes Required:

#### 1. Minimal domain tables migration

**File**: `supabase/migrations/<ts>_minimal_tables_menu.sql`

**Intent**: Give anon-read policies real tables to attach to, scoped by tenant, without pulling in S-03/S-06 richness.

**Contract**:
- `tables(id uuid pk default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade, number int not null, label text, is_active boolean not null default true, created_at timestamptz default now())`
- `menu_items(id uuid pk default gen_random_uuid(), company_id uuid not null references companies(id) on delete cascade, name text not null, price numeric(10,2) not null, is_available boolean not null default true, created_at timestamptz default now())`
- Enable RLS on both (default-deny).

#### 2. Staff + anonymous policies

**File**: same migration (or a sibling `<ts>_anon_read_policies.sql`)

**Intent**: Staff manage only their company's rows; anonymous QR visitors read published venue/menu/table data only.

**Contract**:
- Staff policies on `tables`/`menu_items`: full CRUD where `company_id = current_company_id()`.
- Anon (`to anon`) SELECT policies: `companies` (public venue context), `tables where is_active`, `menu_items where is_available`. No anon INSERT/UPDATE/DELETE anywhere.
- App supplies the `company_id` filter (resolved from the QR/table); anon isolation here is by publish-flag, not session.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies cleanly; RLS enabled on `tables`, `menu_items`
- A `to anon` request (publishable key / `SET ROLE anon`) returns only `is_available` menu_items and `is_active` tables
- An anon INSERT/UPDATE is rejected by RLS
- `npm run lint` passes

#### Manual Verification:

- Using the publishable key, an anonymous read of a company's active tables + available menu items succeeds and returns the expected shape
- Anonymous write attempts fail; anon cannot see `is_available = false` items

---

## Phase 3: Seed + isolation verification

### Overview

Seed two companies (each with an owner) and add the automated cross-tenant isolation test — the
guardrail gate — runnable against the DB without Docker.

### Changes Required:

#### 1. Isolation test (self-seeding)

**File**: `supabase/tests/rls_isolation.sql` (+ `test:rls` script wiring)

**Intent**: Prove company A staff cannot see company B data, and the anon read/write boundary, deterministically.

**Contract**: A transactional SQL script that creates two companies + two owner users/profiles (fixtures — inserted via the service-role/privileged connection, since RLS grants no `authenticated` INSERT, per Phase 1), then, per tenant, sets `role authenticated` + `request.jwt.claims.sub` and asserts (via `do $$ ... raise exception`) that only same-company rows are visible across `companies/profiles/tables/menu_items`; sets `role anon` and asserts published rows are readable but writes and cross-company private reads are denied. Rolls back the fixtures at the end. Exit non-zero on any failed assertion. (Optional local variant: pgTAP under `supabase test db`.)

#### 2. Test runner script

**File**: `package.json`

**Intent**: One command runs the guardrail.

**Contract**: `test:rls` executes `supabase/tests/rls_isolation.sql` against the DB via `psql`/`supabase db execute`, surfacing a non-zero exit on failure.

### Success Criteria:

#### Automated Verification:

- `npm run test:rls` exits 0 with all isolation assertions passing
- The test fails loudly (non-zero) if a policy is loosened (verified by a temporary break)
- Fixtures are rolled back — no residual test companies remain in the DB

#### Manual Verification:

- Test output enumerates the guardrail assertions (cross-tenant denial, anon read-only, anon cross-company denial) and all pass

---

## Phase 4: App integration (Locals + middleware)

### Overview

Surface tenant context in the app: `App.Locals` gains `company_id` + `role`, resolved by
middleware for authenticated users.

### Changes Required:

#### 1. Locals typing

**File**: `src/env.d.ts`

**Intent**: Type the tenant context the app now carries.

**Contract**: Extend `App.Locals` with `company_id: string | null` and `role: 'owner' | 'waiter' | 'kitchen' | null`.

#### 2. Middleware resolution

**File**: `src/middleware.ts`

**Intent**: After resolving `user`, look up their `profiles` row and expose company/role; leave nulls for anonymous requests.

**Contract**: When `locals.user` is set, select `company_id, role` from `profiles` for that user (via the server client) and assign to `locals`; otherwise both null. No new redirect logic here (role-gating of specific routes belongs to the slices that add those routes).

### Success Criteria:

#### Automated Verification:

- `npx astro sync` + `npm run build` pass with the new `Locals` typing
- `npm run lint` passes

#### Manual Verification:

- Logged in as the seeded owner, `locals.company_id` + `locals.role` are populated (verified via a temporary debug output or a guarded page)
- An anonymous request leaves both null and renders without error

---

## Testing Strategy

### Unit Tests:

- No JS unit framework is introduced in F-01; correctness lives in the SQL isolation test.

### Integration Tests:

- `supabase/tests/rls_isolation.sql` is the end-to-end security assertion (staff isolation + anon boundary) against real RLS.

### Manual Testing Steps:

1. Push migrations; in Studio simulate owner A's JWT and confirm only A's rows are visible.
2. With the publishable key, read active tables + available menu items anonymously; confirm writes fail.
3. Log in as the seeded owner in the app; confirm `locals.company_id`/`role` populate; confirm anonymous request stays null and renders.

## Performance Considerations

At MVP scale (users: medium, qps: low) the helper-function subquery per policy check is negligible. If policy-evaluation cost ever shows up, the documented upgrade path is a custom access-token hook moving `company_id`/`role` into JWT claims — explicitly deferred, not needed now.

Separately, the Phase 4 middleware adds one `profiles` SELECT per **authenticated** request (anonymous requests skip it entirely); fine at MVP scale. **Optimization trigger:** if per-request latency from the edge Worker becomes noticeable, move `company_id`/`role` into JWT claims via that same access-token hook so middleware reads them from the token instead of querying `profiles` each request.

## Migration Notes

All migrations are additive (new types/tables/policies) and safe to push to the live hosted DB;
review each diff before `db:push`. No data migration. Rollback = drop the added objects (or
`supabase migration repair` + a down migration) since no prior data depends on them.

## References

- Roadmap item: `context/foundation/roadmap.md` → F-01 `multitenant-rls-foundation`
- Stack constraint: `context/foundation/tech-stack.md` (shared DB + `company_id` + RLS)
- Access model: `context/foundation/prd.md` → Access Control, Non-Functional Requirements
- Current auth wiring: `src/middleware.ts`, `src/lib/supabase.ts`, `src/env.d.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Migration tooling + tenancy core

#### Automated

- [x] 1.1 Project linked & authenticated (`supabase link` + `supabase projects list` succeed) — 316d63b
- [x] 1.2 `npm run db:push` applies the tenancy migration cleanly to hosted — 316d63b
- [x] 1.3 `npx supabase migration list` shows the migration as applied — 316d63b
- [x] 1.4 RLS enabled on `companies` and `profiles` (`relrowsecurity = true`) — 316d63b
- [x] 1.5 Helper functions exist and are `SECURITY DEFINER` — 316d63b
- [x] 1.6 `npm run lint` passes — 316d63b

#### Manual

- [x] 1.7 Owner-A JWT sees only company A `companies`/`profiles` rows — 316d63b
- [x] 1.8 No JWT context → zero rows (default-deny holds) — 316d63b

### Phase 2: Minimal domain tables + anonymous read

#### Automated

- [x] 2.1 `npm run db:push` applies cleanly; RLS enabled on `tables`, `menu_items`
- [x] 2.2 Anon request returns only `is_available` menu_items and `is_active` tables
- [x] 2.3 Anon INSERT/UPDATE rejected by RLS
- [x] 2.4 `npm run lint` passes

#### Manual

- [x] 2.5 Anon read of active tables + available menu items succeeds with expected shape
- [x] 2.6 Anon write fails; `is_available = false` items hidden from anon

### Phase 3: Seed + isolation verification

#### Automated

- [ ] 3.1 `npm run test:rls` exits 0 with all isolation assertions passing
- [ ] 3.2 Test fails loudly when a policy is temporarily loosened
- [ ] 3.3 Fixtures rolled back — no residual test companies remain

#### Manual

- [ ] 3.4 Test output enumerates guardrail assertions and all pass

### Phase 4: App integration (Locals + middleware)

#### Automated

- [ ] 4.1 `npx astro sync` + `npm run build` pass with new `Locals` typing
- [ ] 4.2 `npm run lint` passes

#### Manual

- [ ] 4.3 Seeded owner: `locals.company_id` + `locals.role` populated
- [ ] 4.4 Anonymous request leaves both null and renders without error
