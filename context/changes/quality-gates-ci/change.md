---
change_id: quality-gates-ci
title: Quality gates wiring — CI for lint/typecheck/unit/integration/RLS (test-plan Phase 3)
status: implemented
created: 2026-08-10
updated: 2026-08-10
archived_at: null
---

## Notes

Rollout Phase 3 of context/foundation/test-plan.md: "Quality gates wiring".
Goal: enforce the §5 gates in CI on PRs to `main` — lint + typecheck + unit
(DB-free) + integration + RLS isolation (SQL) — so the tenant-isolation suite
built in Phase 1 actually runs on every change instead of only locally.

Grounding already established this session (no fresh /10x-research needed):
- No active CI: `.github/workflows/` is empty; `.github.scaffold/workflows/ci.yml`
  is an unwired scaffold that only runs lint+build and targets `master` (repo uses `main`).
- Local run commands: `npm run lint`, `npm run typecheck` (astro check),
  `npm run test` (vitest, DB-free), `npm run test:integration` (needs local Supabase),
  RLS suite via the DB container psql (`test:rls:local`).
- Integration/RLS need a running Supabase; GitHub `ubuntu-latest` has Docker, so
  `supabase start` works on the runner. Fixtures seed via GoTrue admin, which needs
  the JWT-format service_role key (from `supabase status -o env`), not `sb_secret_…`.
- `test:rls:local` uses `docker exec supabase_db_10x-astro-starter psql`; the
  container name is derived from project_id in supabase/config.toml, stable in CI.

Out of scope: the local post-edit hook (test-plan §5 "recommended after Phase 3"),
which is an agent-loop hook, not CI — handle separately if wanted.
