<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Multi-tenant Foundation (company_id + RLS + roles)

- **Plan**: context/changes/multitenant-rls-foundation/plan.md
- **Mode**: Deep
- **Date**: 2026-07-04
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 1 critical, 2 warnings, 1 observation (all resolved)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | WARNING |
| Architectural Fitness | WARNING |
| Blind Spots | FAIL |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, 2/2 symbols ✓, brief↔plan ✓. Project NOT linked to hosted (config.toml local `project_id`, no `supabase/.temp`, no `SUPABASE_ACCESS_TOKEN`/`DATABASE_URL`) — confirms F1.

## Findings

### F1 — Missing privileged Supabase access for `db push` + `test:rls`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (db push) + Phase 3 (test:rls)
- **Detail**: Project not linked; `db push` needs `supabase login`/`SUPABASE_ACCESS_TOKEN` + link to project-ref; `test:rls` needs a privileged `DATABASE_URL` to `SET ROLE` and seed `auth.users`. None present.
- **Fix**: Add explicit prerequisite in Phase 1 — `supabase login`, `supabase link --project-ref xvrwteiiyhtmrphpebcp`, local-only `DATABASE_URL`; keep out of git.
- **Decision**: FIXED (added Phase 1 Prerequisite block + new automated criterion 1.1 + Progress renumber)

### F2 — No INSERT/creation policy story for companies/profiles (bootstrap chicken-and-egg)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 (companies/profiles), Phase 3 (fixtures)
- **Detail**: Default-deny + only read/update policies means a fresh user can't create the first company/profile; risk that an implementer adds a permissive INSERT policy (tenancy hole).
- **Fix**: State that INSERT is intentionally not granted to authenticated/anon; bootstrap via service-role (seed/test); authenticated registration flow is S-01.
- **Decision**: FIXED (added no-INSERT note to Phase 1 tenancy migration + service-role fixture note to Phase 3)

### F3 — F-01 pulls forward tables/menu_items owned by S-03/S-06

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Lean Execution
- **Location**: Phase 2 + "What We're NOT Doing"
- **Detail**: Conscious scope expansion creates domain tables later slices own; double-ownership risk.
- **Fix A ⭐ Recommended**: Keep minimal tables + archive-time roadmap note; S-03/S-06 ALTER not CREATE.
- **Fix B**: Narrow back — drop tables/menu_items + anon-read from F-01, defer to S-08.
- **Decision**: FIXED via Fix A (added ownership note to "What We're NOT Doing")

### F4 — Middleware adds a profiles SELECT per authenticated request

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 (middleware)
- **Detail**: Extra Supabase round-trip per authenticated request from the edge Worker; fine at MVP scale; anon skipped.
- **Fix**: Note the optimization trigger (move company_id/role to JWT claims if latency shows up).
- **Decision**: FIXED (added note to Performance Considerations)
