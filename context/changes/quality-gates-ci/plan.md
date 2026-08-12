# Quality Gates Wiring (Test-Plan Phase 3) — Implementation Plan

## Overview

Wire the §5 quality gates into GitHub Actions so every PR/push to `main` runs
lint + typecheck + unit (DB-free) + integration + RLS isolation. Today nothing
runs in CI (`.github/workflows/` is empty); the tenant-isolation suite from
Phase 1 only runs locally.

## Current State Analysis

- No active workflow: `.github/workflows/` empty. `.github.scaffold/workflows/ci.yml`
  is an unwired scaffold (targets `master`, runs only lint+build).
- Run commands exist: `npm run lint`, `npm run typecheck` (astro check — needs
  `astro sync` first for generated types), `npm run test` (vitest, DB-free),
  `npm run test:integration` (needs full Supabase), `npm run test:rls:local`
  (`docker exec supabase_db_10x-astro-starter psql … < rls_isolation.sql`).
- Integration fixtures seed via GoTrue admin → CI needs the **full Supabase**
  stack (`supabase start`), not a bare Postgres. `ubuntu-latest` has Docker.
- Fixtures require the **JWT-format** keys (`ANON_KEY`/`SERVICE_ROLE_KEY` from
  `supabase status -o env`), not `sb_publishable_/sb_secret_`.

## Desired End State

`.github/workflows/ci.yml` runs on push/PR to `main` with two parallel jobs:
- **fast** — lint, typecheck, unit; no database, quick feedback.
- **db** — boots Supabase, writes `.env.test`, runs integration + RLS.

The scaffold is removed. Gates in `test-plan.md` §5 marked required-after-Phase-3
become actually enforced.

## What We're NOT Doing

- No local post-edit hook (test-plan §5 "recommended" — separate concern).
- No `npm run build` gate (not in the §5 required set; can be added later).
- No branch-protection API changes (repo-admin action; noted for the user).

## Implementation Approach

Two independent jobs so a lint failure doesn't wait on a ~2–4 min Supabase boot.
The db job uses `supabase/setup-cli` + `supabase start`, derives the local JWT
keys into `.env.test`, then reuses the existing npm scripts unchanged.

## Critical Implementation Details

- **`astro sync` before `typecheck`**: `astro check` needs generated
  `.astro/types.d.ts` (incl. `astro:env`) or it errors on virtual modules.
- **`.env.test` is generated at runtime** from `supabase status -o env` (strip
  the surrounding quotes); it stays gitignored. Use `ANON_KEY`/`SERVICE_ROLE_KEY`
  (JWT), never the `sb_*` keys, or GoTrue admin seeding fails.
- **RLS runner**: `test:rls:local` shells into `supabase_db_10x-astro-starter`
  (name derived from `project_id` in `supabase/config.toml`), which exists after
  `supabase start` on the runner.

## Phase 1: Author CI workflow + remove scaffold

### Changes Required:

#### 1. CI workflow

**File**: `.github/workflows/ci.yml` (new)

**Intent**: Two jobs on push/PR to `main`. `fast`: checkout → setup-node(22, npm cache)
→ `npm ci` → `astro sync` → `lint` → `typecheck` → `test`. `db`: checkout →
setup-node → `npm ci` → `supabase/setup-cli` → `supabase start` → write `.env.test`
from `supabase status -o env` → `test:integration` → `test:rls:local`.

**Contract**: `name: CI`; `on.push.branches:[main]`, `on.pull_request.branches:[main]`;
`concurrency` cancels superseded runs; jobs `fast` and `db` on `ubuntu-latest`.

#### 2. Remove dead scaffold

**File**: `.github.scaffold/` (delete)

**Intent**: Remove the unwired, misleading scaffold (targets `master`, lint+build only).

**Contract**: `git rm -r .github.scaffold`.

#### 3. Reflect gates as wired

**File**: `context/foundation/test-plan.md` (§5)

**Intent**: Update the §5 rows whose "Required?" said "required after §3 Phase 1"
to note the gate is now enforced by `.github/workflows/ci.yml` (Phase 3 landed).

**Contract**: prose-only edit to the §5 table notes; no strategy change.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (workflow file is YAML, not linted by eslint, but repo stays clean).
- `npm run typecheck` passes.
- `npm run test` passes (unit, DB-free).
- `.github/workflows/ci.yml` is valid YAML and references only existing npm scripts.
- `.github.scaffold/` no longer exists.

#### Manual Verification:

- On the first PR to `main`, both `fast` and `db` jobs run and pass (db job boots
  Supabase, integration + RLS green).
- (Optional) Enable branch protection on `main` requiring the `fast` and `db` checks.

**Implementation Note**: The `db` job can only be verified once it runs on GitHub
(needs the Actions runner + Docker); locally we verify the `fast`-lane commands and
that the scripts/paths the workflow calls all exist.

## References

- Test plan gates: `context/foundation/test-plan.md` §5
- Phase 1 harness: `tests/integration/**`, `supabase/tests/rls_isolation.sql`
- Scaffold being replaced: `.github.scaffold/workflows/ci.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Author CI workflow + remove scaffold

#### Automated

- [x] 1.1 `npm run lint` passes — b3a0c8b
- [x] 1.2 `npm run typecheck` passes — b3a0c8b
- [x] 1.3 `npm run test` passes (unit, DB-free) — b3a0c8b
- [x] 1.4 `.github/workflows/ci.yml` is valid YAML referencing only existing npm scripts — b3a0c8b
- [x] 1.5 `.github.scaffold/` removed — b3a0c8b

#### Manual

- [x] 1.6 First PR to `main`: both `fast` and `db` jobs pass (Supabase boot + integration + RLS green) — c11d2be (PR #25, run 31435209291)
- [x] 1.7 (Optional) Branch protection on `main` requires the `fast` and `db` checks — SKIPPED: optional, repo-admin action; CI itself is proven green on PRs #25, #28, #29
