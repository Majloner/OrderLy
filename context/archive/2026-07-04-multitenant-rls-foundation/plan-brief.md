# Multi-tenant Foundation (company_id + RLS + roles) — Plan Brief

> Full plan: `context/changes/multitenant-rls-foundation/plan.md`

## What & Why

Establish OrderLY's multi-tenant data foundation on Supabase — a `company_id` + Row-Level
Security (RLS) isolation pattern plus a staff role model — so every later slice inherits guaranteed
company data isolation. This is roadmap F-01 and the load-bearing guardrail: getting RLS wrong
means one venue seeing another's data.

## Starting Point

Supabase Auth is wired (`@supabase/ssr`, middleware sets `App.Locals.user`) but the schema is
empty: no migration tooling in use, no domain tables, no roles, no `company_id` anywhere. The
hosted MVP database is live and reachable via the publishable key.

## Desired End State

`companies`, `profiles`, `tables`, `menu_items` exist on hosted with RLS default-deny; helpers
resolve the caller's company/role from `profiles`; staff CRUD only their company; anonymous (QR)
callers read published venue/menu/table rows only. `App.Locals` carries `company_id`+`role`, and
an automated SQL test proves cross-tenant denial and the anon boundary.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Tenant/role model | `profiles` 1:1 with `auth.users` | PRD: one account = one venue; staff = one company+role | Plan |
| Role type | Postgres enum `staff_role` | DB-enforced valid values, clear semantics | Plan |
| RLS mechanism | `SECURITY DEFINER` helpers reading `profiles` | Uniform policies, single source of truth, easy role change | Plan |
| Migrations | Supabase CLI → `db:push` to hosted | Matches declared tool; hosted is the MVP DB; versioned | Plan |
| Isolation verification | Self-seeding SQL assertion test (no Docker) | Deterministic guardrail gate without a JS framework | Plan |
| App binding | Extend `App.Locals` + middleware resolves profile | "Role model represented" closed in the foundation | Plan |
| Anon read scope | Pull minimal `tables`+`menu_items` into F-01 | User chose broader: make anon-read policies real now | Plan |

## Scope

**In scope:** role enum; `companies` + `profiles`; minimal `tables` + `menu_items`; RLS default-deny + staff + anon-read policies; resolver helpers; `App.Locals`+middleware wiring; automated isolation test; migration tooling.

**Out of scope:** registration flow/UI (S-01); menu richness — categories/allergens/photos (S-03/S-04); room editor / table activation / QR generation (S-06/S-07); per-table anonymous *session* isolation + orders (S-08); custom JWT access-token hook; local Docker requirement.

## Architecture / Approach

Versioned Supabase CLI migrations pushed to hosted. Bottom-up: tenancy core (enum + companies +
profiles + helpers + RLS) → minimal domain tables + anon policies → seed + isolation test →
`App.Locals`/middleware. All tables default-deny; access only via explicit policies expressed
through `current_company_id()` / `current_staff_role()` helpers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tooling + tenancy core | enum, companies, profiles, helpers, RLS + staff policies on hosted | RLS default-deny / helper `SECURITY DEFINER` correctness |
| 2. Minimal tables + anon read | `tables`+`menu_items`, staff CRUD + anon published-read | anon policy too permissive (leak unpublished/cross-company) |
| 3. Seed + isolation test | automated cross-tenant + anon-boundary assertion | test must simulate JWT context or it proves nothing |
| 4. App integration | `App.Locals`+middleware carry company_id/role | none major (additive typing + one query) |

**Prerequisites:** Supabase CLI linked to the hosted project; `wrangler`/deploy unaffected. Overlap note: F-01 creates minimal `tables`/`menu_items` that S-03/S-06 will extend — flag on archive.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Migrations push to a **live** hosted DB — review each diff; all statements are additive.
- Testing RLS requires simulating `auth.uid()` via `request.jwt.claims` + `SET ROLE`; `profiles` FK to `auth.users` means fixtures need real auth users (seeded in-test, rolled back).
- Anon isolation here is publish-flag based; true per-table session isolation is deferred to S-08 (no orders yet, so safe now).

## Success Criteria (Summary)

- Company A staff cannot read company B data; anonymous callers read only published rows and cannot write — proven by `npm run test:rls`.
- Migrations apply cleanly to hosted; build/typecheck/lint pass; `App.Locals` exposes `company_id`+`role` for authenticated requests.
