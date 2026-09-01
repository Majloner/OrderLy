# AI-Native Selective Visual Review — Plan Brief

> Full plan: `context/changes/testing-ai-native-visual/plan.md`

## What & Why

Test-plan §3 **Phase 4**: a multimodal visual review of the three critical owner screens (`/dashboard`, `/menu`, `/room`) after the "Karta/bistro" redesign. The redesign's one CRITICAL escape (F1 — 9 room-object kinds rendered white-on-white on the new canvas) slipped past greps, DOM coverage, *and* the 9-step manual checklist. This layer is the only automated eye that can see that failure class: deterministic screenshots judged by a vision model against per-screen rubrics, reported as a non-blocking PR comment.

## Starting Point

A Playwright e2e layer already exists (config, owner auth via `storageState`, 4 specs from the m3l4 commits) but CI never runs it and no screenshot/visual capability exists anywhere. The test plan reserves the gate row (`multimodal visual review | CI on PR | optional`) and its §4/§6.3 e2e rows are stale ("none yet"). CI has two jobs (`fast`, `db`); the `db` job's pinned-CLI Supabase pattern is the template for booting a database in CI.

## Desired End State

A PR touching UI paths gets one sticky comment listing rubric-anchored visual findings (severity-labelled, never blocking) for the three screens, backed by a downloadable artifact. Locally, `seed:visual → test:visual → visual:review` reproduces the same pipeline. The test plan's §4/§5/§6 rows tell the truth about both the e2e layer and the new visual layer.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Screens | `/room`, `/menu`, `/dashboard` | Room is the proven failure point (F1), menu has the highest visual-meaning density, dashboard is the entry screen — 3-screen cap per test plan. | Plan |
| Mechanism | CI job: Playwright capture → VLM review → PR comment | Fulfills the §5 gate row ("CI on PR") verbatim with no human memory required. | Plan |
| Gate semantics | Always-green; findings as sticky comment | Honors "optional" — VLM nondeterminism must never block a merge. | Plan |
| Trigger | Path-filtered to UI paths (`src/components`, `src/styles`, `src/layouts`, `src/pages` minus `api/`) | Implements §4's "When NOT to use: screens without visual change" and caps cost. | Plan |
| Oracle | Per-screen rubric derived from redesign risks | The F1 bug becomes a literal rubric line; findings are anchored, not vibes. | Plan |
| Viewport | Desktop only | Owner panels are desktop-first; room editor at 375px is a degenerate case. | Plan |
| CI data | Local Supabase + deterministic visual seed (fixed names, no photos) | Stable content → stable screenshots → comparable reviews; reuses proven ci.yml patterns. | Plan |
| No baselines / no pixel diff | Standalone rubric judgment per screenshot | §7 excludes pixel snapshots; baselines reintroduce exactly the burden that exclusion avoids. | Test plan §7 |

## Scope

**In scope:** visual seed script; Playwright `visual` project + capture spec; rubric files; VLM review script (Anthropic API, `claude-sonnet-5` default, configurable); `.github/workflows/visual.yml` with sticky comment + artifact; test-plan §4/§5/§6 reconciliation (including the inherited stale e2e rows).

**Out of scope:** pixel snapshots / Argos / Lost Pixel / baselines; mobile viewport; new functional e2e specs; blocking checks; `/staff`, `/settings`, auth pages, role-variant dashboards; menu photos in seed; fixing Workers Builds.

## Architecture / Approach

Three decoupled artifacts so each piece runs and debugs alone: **capture** (Playwright `visual` project → `visual-review/screens/*.png`, seeded deterministic tenant, hydration-aware waits, reduced motion) → **review** (`scripts/visual-review.mjs`: screenshots + rubrics → Anthropic Messages API → `review.json`/`review.md`; exit 0 on findings, ≠0 only on infra failure, self-skip without API key) → **report** (workflow posts/updates one marker-tagged PR comment, uploads artifact). CI boots the lockfile-pinned local Supabase and writes `.dev.vars` so the dev server under Playwright's `webServer` points at it.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Visual capture harness | 3 deterministic local PNGs (seed + `visual` project) | Capturing skeletons — hydration/data waits must be state-based |
| 2. Rubrics + review script | Rubric files + VLM judge, proven by deliberate break | VLM nondeterminism — CRITICAL findings must be stable across runs |
| 3. CI wiring | Path-filtered `visual.yml`, sticky comment, artifact | First-ever dev server in CI (workerd + local Supabase boot) |
| 4. Test-plan reconciliation | §4/§5/§6 truth, incl. inherited e2e drift | Prose drift — claiming more than shipped |

**Prerequisites:** Docker-capable CI runner (already true for the `db` job); `ANTHROPIC_API_KEY` repo secret (repo-admin, Phase 3 — layer degrades gracefully until then).
**Estimated effort:** ~2-3 sessions across 4 phases; Phases 1-2 are local-only, Phase 3 needs a real PR to verify.

## Open Risks & Assumptions

- **VLM nondeterminism**: mitigated by rubric-bound findings, always-green semantics, and the two-clean-runs check (2.6); if CRITICAL wobbles, the rubric/prompt is the tuning surface.
- **Dev server in CI is unproven**: Playwright's `webServer` (`npm run dev` on workerd) has never run in GitHub Actions here; 120s timeout exists but Phase 3 may surface boot flake.
- **Rubric staleness**: rubrics encode today's design language; §6.8 cookbook makes updating them part of any future redesign's definition of done.
- **Fork PRs get no review** (no secret) — acceptable: solo-maintainer repo, the step self-skips visibly.

## Success Criteria (Summary)

- A deliberately injected white-on-white room object is flagged CRITICAL; a clean build passes review twice with no CRITICAL.
- A UI-touching PR gets exactly one sticky visual-review comment that updates in place; non-UI PRs trigger nothing.
- The §5 gate row reads `optional — wired`, and no stale "none yet" e2e rows remain in the test plan.
