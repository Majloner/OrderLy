# Integration Harness + Tenant Isolation — Plan Brief

> Full plan: `context/changes/testing-tenant-isolation-integration/plan.md`
> Research: `context/changes/testing-tenant-isolation-integration/research.md`

## What & Why

Rollout Phase 1 of `context/foundation/test-plan.md`: build the project's first **integration test layer** and use it to pin the three top tenant-isolation risks — cross-tenant read/write (#1), unscoped anon reads (#2), and request-layer authz bypass (#3). The isolation logic already works; this phase locks it in with tests and makes one known DB-layer gap visible before the next feature can silently regress it.

## Starting Point

RLS is enforced and `company_id`-scoped on every tenant table, and every `/api/*` mutation calls a per-handler guard returning 401/403 — but there is **no integration harness at all**. Vitest is unit-only and can't import app modules (unresolved `astro:env` virtual modules); `npm run test:rls` runs against the hosted `--linked` DB. A solid 794-line SQL RLS suite exists to build on.

## Desired End State

`npm run test:integration` and `npm run test:rls:local` run against a local Supabase and deterministically prove: every write route rejects waiter/kitchen (403) and anon (401); a company-A principal cannot read or mutate any company-B row on any entity (verified by querying the DB for effect, not just HTTP status), owner included; cross-tenant `category_id` attach is rejected at the route layer; and the anon RLS gap is demonstrated and labeled at the SQL layer. Cookbook §6.2/§6.4/§6.5 answer "how do I add a test for X here?"

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Route invocation | Synthetic `APIContext` (no HTTP server) | Exercises real guards + real RLS in-process; fast and deterministic | Plan |
| Test database | Local `npx supabase start` | Isolated, resettable, CI-reproducible, no risk to hosted data | Plan |
| Clients / env | Test-only helper reading `process.env` | Sidesteps the `astro:env` virtual-module problem; no app-client import | Plan |
| #3 coverage breadth | Parametrized route matrix | New route = one registry row; broad authz coverage at trivial cost | Plan |
| `category_id` id-only FK | Route-layer test now + DB-gap note | High signal, zero migration; keeps Phase 1 a test phase | Plan |
| #1 assertion depth | Verify effect in DB | Proves the real invariant, not a status code (defeats the §2 anti-pattern) | Plan |
| Middleware page-redirects | Out of scope (documented) | Security boundary already covered by API 401/403 + RLS; avoids reintroducing HTTP/`astro:env` | Plan |
| Risk #2 layer | SQL RLS suite, as a labeled known-gap | No anon route exists to test through; policies intentionally unscoped until S-07/S-08 | Research |

## Scope

**In scope:** local-Supabase integration harness; test-only client helper + synthetic-context builder + 2-companies×3-roles+anon fixtures; #3 authz matrix; #1 per-entity cross-tenant read/write (verify-in-DB) + `category_id` route test; #2 anon known-gap in the SQL suite; cookbook §6.2/§6.4/§6.5.

**Out of scope:** HTTP server / middleware page-redirects; fixing anon RLS scoping (S-07/S-08); `category_id` composite-FK migration; CI/hook wiring (Phase 3); photo/IDOR/#4, input-parity/#5, staff-invariant/#6 (Phase 2); `--linked` as the integration base.

## Architecture / Approach

A test builds a **principal** (`{ client, user, company_id, role }`) from a seeded user, then `buildContext(principal, req)` produces the `APIContext` the handler reads — the guard's 403 decision uses `locals.role` while RLS uses the JWT in `locals.supabase`, so both are set from the same user. Owners are seeded via the `handle_new_user` trigger (one `createUser` per tenant); waiter/kitchen via the app's staff-provisioning path. Risk #2 stays in `rls_isolation.sql` because no anon route exists.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness scaffolding | Local Supabase + integration Vitest config + client helper + synthetic context + fixtures | `astro:env` friction; `locals.role`-vs-JWT mismatch producing false greens |
| 2. Risk #3 authz matrix | Parametrized write-route matrix (403/401) + read asymmetry | A new route omitting a guard not auto-covered unless registry completeness is enforced |
| 3. Risk #1 isolation | Per-entity cross-tenant read/write, verified in DB + `category_id` test | Tautological assertions that pass without proving no-effect |
| 4. Risk #2 anon RLS | Labeled known-gap block in the SQL suite; local run | A green "anon sees all" test misread as approval — must be a `notice`, not a pass |
| 5. Cookbook + scripts | §6.2/§6.4/§6.5 filled; `test:integration` / `test:rls:local` | Cookbook drifting from what the harness actually does |

**Prerequisites:** Docker + `npx supabase start`; `.env.test` from `.env.test.example`.
**Estimated effort:** ~2–3 sessions across 5 phases (Phase 1 is the bulk).

## Open Risks & Assumptions

- `astro:env` is avoided by not importing app client/middleware code; if a route transitively pulls `astro:env` (e.g. photo routes via `storage.ts`), it's excluded from Phase 1 (belongs to the rollout's Phase 2).
- Risk #2 is a spec of the *desired* invariant deliberately left non-failing until S-07/S-08 scopes the anon policies.
- CI does not yet run these suites; that wiring is test-plan §3 Phase 3.

## Success Criteria (Summary)

- Waiter/kitchen writes → 403, anon → 401 across every write route; staff-wide reads behave correctly.
- Company A cannot read or mutate company B on any entity — proven by DB verification — with owner offering no escalation.
- Anon cross-tenant read gap demonstrated and labeled at the SQL layer; cookbook lets the next contributor add a test unaided.
