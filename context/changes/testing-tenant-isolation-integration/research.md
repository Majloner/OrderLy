---
date: 2026-08-04T23:03:02+0200
researcher: Intebuco_Milosz
git_commit: b8955f9bb1895ad0c489cf11177e43d1d635793a
branch: main
repository: 10x
topic: "Tenant isolation (Risks #1–#3): where authz/RLS actually live, and what a Phase 1 integration harness must build"
tags: [research, codebase, rls, tenant-isolation, authz, middleware, supabase, test-harness]
status: complete
last_updated: 2026-08-04
last_updated_by: Intebuco_Milosz
---

# Research: Tenant isolation (Risks #1–#3) and the Phase 1 integration harness

**Date**: 2026-08-04T23:03:02+0200
**Researcher**: Intebuco_Milosz
**Git Commit**: b8955f9bb1895ad0c489cf11177e43d1d635793a
**Branch**: main
**Repository**: 10x

## Research Question

Ground rollout Phase 1 of `context/foundation/test-plan.md` ("Integration harness + tenant isolation") against current code, verifying three risks:

- **#1** — a request authenticated as company A never returns or mutates company B rows on any domain entity; the owner role does NOT lift the tenant boundary.
- **#2** — the anon key cannot read rows whose `company_id` differs from the table/session context; anon-read policies lacking a `company_id` predicate are the failure surface.
- **#3** — owner-only writes return 403 for waiter/kitchen and protected routes redirect anonymous; a 200 on the happy path does not imply authorization holds.

Plus: map what exists vs. what the integration harness must build.

## Summary

The isolation model is **two redundant layers**: an in-handler request guard (fast JSON 401/403) and Postgres RLS (the real enforcement). Both are structurally sound today; Phase 1's job is to **pin them with tests**, not to fix a live breach — with three concrete caveats that shape the plan:

1. **Risk #1 (authenticated cross-tenant) is well-defended.** Every tenant table has RLS enabled; every authenticated policy is `company_id = current_company_id()`, and `owner` is *always* AND-composed with the company predicate — it never lifts the boundary. Every write carries a `WITH CHECK` pinning `company_id`. **One residual schema gap**: `menu_items.category_id` is an id-only FK ([menu_categories_items.sql:78](supabase/migrations/20260708124756_menu_categories_items.sql:78)) — the same class of cross-entity attach that was already closed for `tables.room_id` via a composite FK. Worth a test.

2. **Risk #2 (anon) is a real, known DB-layer gap, and it has NO route to test through.** All four anon SELECT policies are UNSCOPED (`using (true)` / `using (is_active)` / availability-only). **But there is currently no anon-reachable API route** — every menu/room/staff endpoint returns 401 for anon, and the public QR-menu read path (S-07/S-08) isn't built. **Therefore Risk #2 must be proven at the SQL/RLS layer (anon key directly against Postgres), not through the integration route harness.** This splits Phase 1 cleanly: #1/#3 → route harness; #2 → extend `rls_isolation.sql`.

3. **Risk #3's guard does NOT live in middleware for API routes.** `src/middleware.ts` gates only *page* routes (`/dashboard`, `/menu`, …) via redirect; its `matchesRoute` never matches `/api/*`. **All API authorization is the per-handler `guard*Request()` call + RLS.** The harness must drive `/api/*` directly as each principal; the page-redirect gate is irrelevant to API tests.

**Central plumbing gap for the harness**: Vitest currently cannot import `src/lib/supabase.ts` or `src/middleware.ts` because `astro:env/server` and `astro:middleware` are unresolved virtual modules (no Astro Vite plugin, no `setupFiles` in [vitest.config.ts](vitest.config.ts)). And `npm run test:rls` runs `--linked` (hosted project), not local `supabase start`. Solving these two is the harness's real work.

## Detailed Findings

### Risk #1 — authenticated cross-tenant isolation (RLS)

**Tenancy resolver.** Two `SECURITY DEFINER` helpers back every authenticated policy; `company_id`/`role` are looked up in `public.profiles` by `auth.uid()`, not read from the JWT. Current (deactivation-aware) versions:
- `public.current_company_id()` — [staff_accounts_roles.sql:52-63](supabase/migrations/20260727220415_staff_accounts_roles.sql:52)
- `public.current_staff_role()` — [staff_accounts_roles.sql:65-76](supabase/migrations/20260727220415_staff_accounts_roles.sql:65)
- Original F-01 versions: [tenancy_core.sql:44-66](supabase/migrations/20260705212949_tenancy_core.sql:44)
- A deactivated profile returns `NULL` for both → filtered out of every policy at once.

**Every tenant table is RLS-enabled and scoped.** Authenticated SELECT = `company_id = current_company_id()`; owner-only writes add `and current_staff_role() = 'owner'`:

| Table | SELECT (auth) | Owner writes | file |
|---|---|---|---|
| `companies` | `id = current_company_id()` | `companies_update_owner` | [tenancy_core.sql:75-84](supabase/migrations/20260705212949_tenancy_core.sql:75) |
| `profiles` | `company_id = current_company_id()` | insert/update/delete owner (+ `role <> 'owner'`, no self-delete) | [staff_accounts_roles.sql:81-98](supabase/migrations/20260727220415_staff_accounts_roles.sql:81) |
| `menu_categories` | scoped | insert/update/delete owner | [menu_categories_items.sql:41-64](supabase/migrations/20260708124756_menu_categories_items.sql:41) |
| `menu_items` | scoped | insert/update/delete owner | [menu_categories_items.sql:118-141](supabase/migrations/20260708124756_menu_categories_items.sql:118) |
| `rooms` | scoped | insert/update/delete owner | [room_layout_tables.sql:50-73](supabase/migrations/20260727120000_room_layout_tables.sql:50) |
| `tables` | scoped | insert/update owner; **no DELETE policy** (QR permanence, default-deny) | [room_layout_tables.sql:170-190](supabase/migrations/20260727120000_room_layout_tables.sql:170) |
| `storage.objects` (`menu-photos`) | none anon; owner insert/update/delete scoped by `(storage.foldername(name))[1] = company_id::text` | | [menu_item_photos.sql:34-64](supabase/migrations/20260721120000_menu_item_photos.sql:34) |

**Owner does NOT lift the boundary — confirmed.** There is no policy of the form `using (current_staff_role() = 'owner')` alone; every owner check is ANDed with the company predicate, and `current_company_id()` returns only the owner's own single company. Owner = more capability *within* one tenant, never across.

**All writes carry WITH CHECK** pinning `company_id` to `current_company_id()` — a company-A owner cannot INSERT/UPDATE a row stamped `company_id = B`. No write policy is missing WITH CHECK. Reorder RPCs are `SECURITY INVOKER` (run under caller RLS); sort-order triggers are `SECURITY DEFINER` but compute `max(sort_order)` scoped to `new.company_id`.

**Residual cross-entity gaps:**
- **FIXED — `tables.room_id`**: was id-only FK; closed by composite FK `(company_id, room_id) → rooms(company_id, id)` — [room_tables_composite_fk.sql:28-40](supabase/migrations/20260728120000_room_tables_composite_fk.sql:28). A table can only reference a room of its own company.
- **OPEN — `menu_items.category_id`**: still id-only (`references menu_categories (id)`) — [menu_categories_items.sql:78](supabase/migrations/20260708124756_menu_categories_items.sql:78). `menu_categories` has no `(company_id, id)` unique constraint, so a company-A owner could stamp their own item with a company-B `category_id` (FK checked below RLS against all companies). Lower impact than the room case but the same schema-level class. **Candidate for a Risk #1 test** (owner A targets B's `categoryId` → expect denial).

### Risk #2 — anon reads not scoped by company_id (RLS)

All four anon SELECT policies are **UNSCOPED** — tenant scoping is done only by an app-supplied `company_id` filter, not by RLS:

| Table | Policy | file:line | USING | Verdict |
|---|---|---|---|---|
| `companies` | `companies_anon_read` | [minimal_tables_menu.sql:59-62](supabase/migrations/20260705215147_minimal_tables_menu.sql:59) | `using (true)` | UNSCOPED |
| `tables` | `tables_anon_read_active` | [minimal_tables_menu.sql:64-67](supabase/migrations/20260705215147_minimal_tables_menu.sql:64) | `using (is_active)` | UNSCOPED |
| `menu_categories` | `menu_categories_anon_read` | [menu_categories_items.sql:68-71](supabase/migrations/20260708124756_menu_categories_items.sql:68) | `using (true)` | UNSCOPED |
| `menu_items` | `menu_items_anon_read_visible` | [menu_categories_items.sql:106-109](supabase/migrations/20260708124756_menu_categories_items.sql:106) | `using (archived_at is null and availability in ('available','sold_out'))` | UNSCOPED |

- The codebase self-documents this as known debt: [room_layout_tables.sql:20-24](supabase/migrations/20260727120000_room_layout_tables.sql:20) ("`tables_anon_read_active` is deliberately left untouched: it still lacks a `company_id` predicate") and matches `context/foundation/lessons.md` ("Anon RLS reads must be scoped by company_id").
- **Venue-code / QR lookup rides `companies_anon_read using (true)`** — `venue_code_and_staff_login.sql` adds `companies.code` but **no new anon policy**, so an anon client can enumerate *every* company and every venue code. No anon policy on `rooms` at all.
- **Policy lifecycle note**: the only superseded anon policy is menu-items — original `menu_items_anon_read_available using (is_available)` ([minimal_tables_menu.sql:69]) was DROPPED at [menu_categories_items.sql:99] and replaced by the current `menu_items_anon_read_visible`. The other three are original and never redefined through the latest migration.

**Test-layer consequence**: because no anon *route* exists (see Risk #3), Risk #2's proof lives in `supabase/tests/rls_isolation.sql` — an anon-key SELECT that returns company B's rows when scoped only to company A's context is the assertion. This is §6.5 cookbook territory, not the route harness.

### Risk #3 — request-layer authorization

**`src/middleware.ts` gates pages, not APIs.**
- Locals shape set every request — [middleware.ts:23-27](src/middleware.ts:23): `{ user, company_id, role, display_name, supabase }`. `company_id`/`role` come from a `profiles` SELECT keyed on `user_id` ([middleware.ts:38-52](src/middleware.ts:38)).
- `PROTECTED_ROUTES = ["/dashboard","/settings","/menu","/staff","/room"]` and `OWNER_ROUTES = ["/menu","/staff","/room"]` — [middleware.ts:5,11](src/middleware.ts:5).
- Anonymous → protected page = **302 redirect** to `/auth/signin` ([middleware.ts:58](src/middleware.ts:58)); non-owner → owner page = redirect to `/dashboard` ([middleware.ts:75-79](src/middleware.ts:75)).
- **KEY**: `matchesRoute("/api/menu/…","/menu")` is false — API paths never match, so **middleware plays no role in `/api/*` authorization**.

**Authorization for `/api/*` lives in per-handler guards** (`src/lib/api.ts`, `src/lib/room-api.ts`):
- `guardMenuRequest(context,{write})` — [api.ts:29](src/lib/api.ts:29): `!user` → **401** ([api.ts:36]); `write && role!=='owner'` → **403** ([api.ts:39]); `!company_id` → 403. Reads allowed for any authenticated staff; writes owner-only.
- `guardStaffRequest(context,{write})` — [api.ts:68](src/lib/api.ts:68): **owner-only for read AND write** (`role!=='owner'` → 403).
- `guardTablesRequest(context,{write})` — [room-api.ts:18](src/lib/room-api.ts:18): duplicate of menu guard; reads any staff, writes owner-only.
- Status convention: **401 unauthenticated, 403 wrong-role/no-company.** `isInsufficientPrivilege` maps Postgres `42501` (self-change trigger) to 403 — [api.ts:139](src/lib/api.ts:139).
- `src/lib/staff-admin.ts` holds the **service-role** escalation (`createStaffAuthUser`/`deleteStaffAuthUser`); it does not authorize — the route does.

**Route → principal map (harness targets):**

| Route + method | Owner | Waiter | Kitchen | Anon |
|---|---|---|---|---|
| `GET /api/menu`, `GET /api/room` | ✅ | ✅ | ✅ | 401 |
| all menu/room writes (POST/PUT/DELETE/PATCH) | ✅ | 403 | 403 | 401 |
| `GET /api/staff` | ✅ | 403 | 403 | 401 |
| `POST /api/staff`, `PUT /api/staff/[id]` | ✅ | 403 | 403 | 401 |
| `POST /api/company/profile` | ✅ | **302 redirect** | **302 redirect** | **302 redirect** |
| `/api/auth/{signin,signup,signout}` | public | public | public | public |

**Special cases the harness must encode:**
- Only `GET /api/menu` and `GET /api/room` are staff-wide reads; `GET /api/staff` is owner-only.
- `POST /api/company/profile` is the odd one out — inline bespoke guard (not the shared helper) that **redirects (302) instead of returning JSON 401/403** — [company/profile.ts:8](src/pages/api/company/profile.ts:8). A test asserting JSON status here will fail; assert the redirect.
- No route reads `role`/`company_id` from the request body — all derive from `locals`; no body-forgery escalation path exists today.
- Every current mutation calls a `write:true` guard, so there is **no owner-only mutation relying on RLS alone**. The test's value is regression pressure: it fails the day a new route forgets the guard.

### Harness surface — what exists vs. what to build

**Supabase clients:**
- **One SSR factory** `createClient(requestHeaders, cookies)` (anon/public key, cookie-bound, `@supabase/ssr`) — [supabase.ts:5](src/lib/supabase.ts:5); env via `astro:env/server` ([supabase.ts:3]). Same factory yields anon or per-role authenticated depending on cookie state.
- **Service-role client** `admin()` (`@supabase/supabase-js`, `SUPABASE_SERVICE_ROLE_KEY`, `persistSession:false`) — [staff-admin.ts:21-28](src/lib/staff-admin.ts:21). Used for privileged seeding / auth-user creation.

**Env names a harness needs** (declared in [astro.config.mjs:22-31](astro.config.mjs:22) and `.env.example`): `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Local Supabase ports: API 54321, DB 54322 (`supabase/config.toml`).

**Existing RLS test** — `supabase/tests/rls_isolation.sql` (794 lines, plain SQL not pgTAP): one `begin;…rollback;` tx; simulates roles via `set local role` + `set local request.jwt.claims`; seeds 2 companies (A `a1111111…`/`AAAAAA`, B `b2222222…`/`BBBBBB`) × owner/waiter/deactivated-kitchen; 23 assertions covering tenant isolation, owner-only writes, anon read/write limits, orphan-user, Storage prefix scoping, room/table rules, staff provisioning invariants, `handle_new_user` bootstrap, composite-FK on `room_id`, venue-code immutability. Run via `npm run test:rls` → `supabase db query --linked --file …` ([package.json:19](package.json:19)) — **targets the hosted linked project, not local**.

**Route handler shape** — `export const POST: APIRoute = async (context) => {…}`; handlers read only `context.request` + `context.locals` (`{user, company_id, role, supabase}`, contract in [env.d.ts:1-11](src/env.d.ts:1)). Guards use `context.locals.supabase` as the DB client. **Unit-invokable with a synthetic context** (build `{request, locals, cookies}` and call the exported handler) — middleware is bypassed, so the test populates `locals` itself. A real HTTP server is only needed to exercise middleware's redirect/role gating end-to-end.

**Test conventions** ([menu.test.ts:1](src/lib/schemas/menu.test.ts:1)): named `vitest` imports (no globals), `@` alias, `.test.ts` under `src/**`, inline object fixtures with spread overrides.

**Session acquisition** — single endpoint `POST /api/auth/signin` (form-encoded `email`/`venue_code`/`password`) → `signInWithPassword` → session written as cookies by the SSR client ([signin.ts:27,39](src/pages/api/auth/signin.ts:27)). Staff sign in with a derived address `staffAuthEmail(venueCode, login)` = `{login}@{venue}.staff.orderly.invalid` ([staff-identity.ts:58-60](src/lib/staff-identity.ts:58)). Fastest test path: service-role `auth.admin.createUser({email_confirm:true})` then `signInWithPassword` on an anon client to capture cookies — mirrors the app. Owner bootstrap runs via `handle_new_user()` trigger on `auth.users` insert with `raw_user_meta_data.company_name`.

## Code References

- `src/middleware.ts:5,11,23-27,38-52,58,75-79` — page-only gating; locals shape; **no `/api/*` match**.
- `src/lib/api.ts:29,36,39,68,77,139` — `guardMenuRequest`/`guardStaffRequest`; 401/403 convention; `42501`→403 mapping.
- `src/lib/room-api.ts:18,25,28,47` — `guardTablesRequest`; `roomExistsInCompany`.
- `src/lib/staff-admin.ts:21-28,47-83` — service-role `admin()`; `createStaffAuthUser`.
- `src/lib/supabase.ts:3,5` — sole SSR client factory; `astro:env/server`.
- `src/pages/api/company/profile.ts:8` — inline guard, 302 redirect (special case).
- `supabase/migrations/20260705212949_tenancy_core.sql:44-84` — resolvers + companies/profiles RLS.
- `supabase/migrations/20260727220415_staff_accounts_roles.sql:52-98,112-140` — deactivation-aware resolvers; profiles insert/delete owner; self-change trigger.
- `supabase/migrations/20260708124756_menu_categories_items.sql:41-141` — menu RLS; **:78 id-only `category_id` FK**; :68-71/:106-109 anon reads.
- `supabase/migrations/20260727120000_room_layout_tables.sql:20-24,50-73,170-190` — rooms/tables RLS; anon-scope debt note; no table DELETE.
- `supabase/migrations/20260728120000_room_tables_composite_fk.sql:28-40` — composite FK closing `room_id` gap.
- `supabase/migrations/20260705215147_minimal_tables_menu.sql:59-67` — `companies_anon_read using(true)`, `tables_anon_read_active using(is_active)`.
- `supabase/tests/rls_isolation.sql` — existing 2-company × role SQL harness (run `--linked`).
- `vitest.config.ts` — `include src/**/*.test.ts`, `node`, `@` alias; **no setupFiles / no Astro plugin**.
- `package.json:14,19` — `test` → `vitest run`; `test:rls` → `supabase db query --linked`.

## Architecture Insights

- **Defense in depth by design.** Request guards are explicitly "fast, friendly JSON errors" over RLS-as-truth ([api.ts:26-28], [room-api.ts:16-17]). Tests should assert *both* the 401/403 request signal AND that RLS denies at the DB (belt-and-suspenders), because either alone can silently rot.
- **Tenant key is resolved server-side from `auth.uid()`, never from client input** — the whole model's integrity rests on the `SECURITY DEFINER` resolvers and the `profiles` row being mint-controlled (trigger + owner-only insert with `role <> 'owner'`).
- **Schema-level composite FKs are the strongest cross-entity guard** (proven for `room_id`); the remaining id-only `category_id` FK is the one place that pattern isn't yet applied.
- **The anon surface is app-scoped, not DB-scoped, on purpose (for now)** — acceptable only while no anon route is shipped; the moment S-07/S-08 (public QR menu) lands, the unscoped policies become a live breach, which is why the lesson says to move scoping into RLS at that point.

## Historical Context (from prior changes)

- `context/foundation/lessons.md` — "Anon RLS reads must be scoped by company_id" (predicts exactly the four unscoped policies) and "Supabase Storage nie honoruje tokenu użytkownika → service_role" (why Storage ops go through service-role + endpoint-level authz; relevant to Phase 2 Risk #4, not Phase 1).
- `context/foundation/test-plan.md` §2/§3 — Risk Map rows #1–#3 and the Phase 1 rollout row this research advances.

## Open Questions

- **Local-vs-linked DB for integration tests.** `test:rls` runs `--linked` (hosted). Does Phase 1 stand up a local `supabase start` path for both the SQL RLS suite and the TS route harness, or document a linked-DB path? (Plan decision; cost × signal.)
- **How to resolve `astro:env/server` / `astro:middleware` under Vitest** — add `getViteConfig` from `astro/config` (Astro's test integration) vs. a stub/shim vs. injecting env directly. This is the single biggest plumbing decision for the route harness.
- **Route invocation strategy** — synthetic `APIContext` + populated `locals` (cheap, bypasses middleware) vs. a real dev server (exercises middleware redirects). Recommendation from findings: synthetic context for #1/#3 route-guard + RLS assertions; reserve HTTP-server only if a middleware-redirect assertion is deemed in-scope.
- **Is the `menu_items.category_id` id-only FK in scope for Phase 1 (a Risk #1 test) or deferred?** It's a genuine cross-entity gap analogous to the fixed `room_id` case.

## Related Research

- None yet under `context/changes/**/research.md` — this is the first research artifact for the test rollout.
