# AI-Native Selective Visual Review Implementation Plan

## Overview

Stand up test-plan §3 **Phase 4 — "AI-native selective visual"**: a multimodal (VLM-based) visual review of the three critical owner screens (`/dashboard`, `/menu`, `/room`) after the "Karta/bistro" redesign. Deterministic Playwright screenshots (desktop, seeded local Supabase) are judged by a vision model against per-screen rubrics derived from the redesign's proven failure classes; findings land as a non-blocking sticky PR comment on UI-touching PRs. The phase ends by flipping the §5 `multimodal visual review` gate row to "wired" and reconciling the test plan's stale e2e rows.

## Current State Analysis

**What exists:**

- A Playwright e2e layer already landed (m3l4 commits `772b5c6`, `b7a11ea`, `652f907`): `playwright.config.ts` (chromium + `setup` project, owner `storageState` at `playwright/.auth/owner.json`, `webServer: npm run dev`, env via `.env.e2e` / `process.loadEnvFile` which never overrides existing env), `tests/e2e/{auth.setup.ts,seed.spec.ts,route-protection.spec.ts,tenant-isolation.spec.ts}`, script `test:e2e`.
- `auth.setup.ts:50-69` has **idempotent owner provisioning** (`E2E_PROVISION=1` → GoTrue admin `createUser` with `user_metadata.company_name`; the `handle_new_user` trigger bootstraps the whole tenant). "Already registered" counts as success.
- CI (`.github/workflows/ci.yml`) has two jobs — `fast` and `db`. The `db` job's Supabase pattern is the template: lockfile-pinned CLI (`npx supabase start`, **never** `supabase/setup-cli@latest`), env parsed from `npx supabase status -o env` (JWT-format `ANON_KEY`/`SERVICE_ROLE_KEY`, never `sb_*` keys).
- The `/10x-e2e` skill and CLAUDE.md set the binding boundaries: DOM default, vision only for visual-only risks, role-based locators, no `waitForTimeout`, deliberate-break verification before trusting a test.

**What's missing (the gap this phase fills):**

- No screenshot/visual capability anywhere: no `screenshot` option in `playwright.config.ts`, no visual-diff package, no vision workflow behind the three `--caps=vision` mentions.
- `npm run test:e2e` never runs in CI; no artifact upload; no PR-comment step.
- test-plan drift: §4 e2e row still says "none yet — see §3 Phase 4" (stale — Playwright is wired), §6.3 cookbook is TBD, §5 gate row is reserved but not wired.

**Why vision, here specifically:** the redesign's one CRITICAL escape (F1) was `src/components/room/room-object-visuals.ts:34-46` — 9 room-object kinds rendered white-on-white (~1.5:1) on the new canvas. It escaped greps, has no DOM-test signal (an assertion on class names would be tautological), and slipped past the 9-step manual checklist. §7 deliberately excludes pixel snapshots and per-pixel room-editor testing. A rubric-guided VLM look at a rendered screenshot is the only automated layer that can see this failure class.

## Desired End State

- `npm run seed:visual` + `npm run test:visual` locally produce 3 deterministic PNGs; `npm run visual:review` (with `ANTHROPIC_API_KEY`) produces `visual-review/review.md` + `review.json` with zero CRITICAL findings on a healthy build.
- A PR touching UI paths gets a `visual` workflow run that boots Supabase, seeds, captures, reviews, and posts/updates one sticky PR comment with findings; the job is green unless infrastructure fails. Non-UI PRs don't trigger it.
- A deliberately injected white-on-white room object produces a CRITICAL finding on `/room` (proven once during Phase 2, not kept in the suite).
- test-plan.md §4/§5/§6 tell the truth: e2e row wired, gate row `optional — wired`, cookbook filled.

### Key Discoveries:

- `auth.setup.ts:50-69` — provisioning already exists; the visual seed builds on the same tenant-bootstrap trigger instead of duplicating it.
- `playwright.config.ts:27` — `setup` project matches only `auth.setup.ts`; the default `testMatch` (`*.@(spec|test).ts`) means a capture file **not** named `*.spec.ts` is invisible to the existing `chromium` project — no accidental coupling.
- `auth.setup.ts:75-77` — the astro-island hydration trap: React islands must be hydrated (`astro-island:not([ssr])` attached) before interacting; screenshots have the analogous trap (capturing a skeleton/placeholder frame).
- `ci.yml:46-63` — the pinned-CLI + JWT-keys pattern to copy verbatim; the dev server reads its Supabase project from `.dev.vars` (AGENTS.md), so the CI visual job must write `.dev.vars` pointing at the local stack — a step the existing `db` job (which writes `.env.test`) does not have.
- test-plan §7 — pixel snapshots and per-pixel room-editor testing are deliberately excluded; the middleware-route-protection lesson (§6.6) warns every "needs a browser" claim gets scrutiny. This layer claims the browser only for what genuinely has no cheaper layer: rendered visual quality.

## What We're NOT Doing

- **No pixel snapshots or deterministic visual diff** (`toHaveScreenshot`, Argos, Lost Pixel) — §7 excludes them ("pękają bez sensu"); this layer exists precisely for what a diff can't judge.
- **No baseline images** — each review judges the current screenshot standalone against a rubric; nothing to rebase, no baseline drift.
- **No mobile viewport** — desktop only (owner panels are desktop-first; the room editor at 375px is a degenerate case).
- **No new functional e2e specs** — that's `/10x-e2e`'s job; this phase only adds the visual capture/review path.
- **No required/blocking check** — the gate is optional per §5; findings inform, humans decide.
- **No coverage of `/staff`, `/settings`, auth pages, or role-variant (waiter/kitchen) dashboards** — cost×signal cap of 3 screens.
- **No menu-item photos in the seed** — Storage adds nondeterminism and a service-role upload path for marginal signal; noted as a rubric limitation.
- **Not fixing Workers Builds** preview deploys (separate, documented in AGENTS.md).

## Implementation Approach

Four phases, each independently verifiable: (1) deterministic capture locally, (2) rubric + VLM review script proven by a deliberate break, (3) CI wiring as a new path-filtered workflow, (4) prose reconciliation of test-plan.md. The review pipeline is three decoupled artifacts — screenshots dir → review script → comment step — so each piece can be run and debugged alone, and the VLM call is an ordinary Node script (raw `fetch` to the Anthropic Messages API), not a CI-only construct.

## Critical Implementation Details

- **Hydration before capture.** All three screens render React islands. A screenshot taken before hydration (or during a loading state) reviews a skeleton, not the screen. Each capture must wait for a content signal that only exists post-data-load (e.g. a seeded item name visible), mirroring the `astro-island:not([ssr])` discipline in `auth.setup.ts:77`. Never `waitForTimeout`.
- **Animation and motion flake.** Emulate `reducedMotion: "reduce"` in the capture context and wait for network idle before shooting — the redesign added transitions that can smear a mid-animation frame.
- **`loadEnvFile` never overrides real env** (`playwright.config.ts:4-5`) — CI passes everything through job env and skips `.env.e2e` entirely; don't write that file in CI.
- **The dev server's Supabase project comes from `.dev.vars`**, not `.env.test`. The CI visual job must write `.dev.vars` (`SUPABASE_URL`, `SUPABASE_KEY`) from `supabase status` before Playwright's `webServer` starts, and pass the JWT-format keys (same trap as `ci.yml:53-56`).
- **Capture file must not match `*.spec.ts`** — name it `capture.visual.ts` with an explicit `testMatch` on the new `visual` project, so `npm run test:e2e` (chromium project) never runs it and the visual job never runs the functional specs.
- **Review-script exit-code contract**: findings (any severity) → exit 0; missing screenshots, API error, malformed response → exit ≠ 0. This is what makes "always-green unless infra breaks" enforceable in the workflow without `continue-on-error` hacks.
- **Fork-PR safety**: `ANTHROPIC_API_KEY` is absent on fork PRs; the review step must detect the empty env and skip with a visible notice rather than fail.

## Phase 1: Visual Capture Harness

### Overview

Deterministic screenshots of the three screens, locally reproducible: a fixed-content seed script plus a Playwright `visual` project.

### Changes Required:

#### 1. Visual seed script

**File**: `scripts/seed-visual.mjs`

**Intent**: Idempotently provision a dedicated visual tenant with **fixed** (no timestamps) content so screenshots are stable run-to-run: the owner account (via GoTrue admin + `handle_new_user`, same mechanism as `auth.setup.ts:50-69`), 2 menu categories with ~3 items each (fixed names/prices; at least one item unavailable so the availability semantic map renders both states; no photos), and 1 room containing several tables plus room objects **including the kinds that failed in F1** (`room-object-visuals.ts` equipment kinds), so the rubric's invisible-object check has real subjects.

**Contract**: Reads `E2E_SUPABASE_URL` + `E2E_SUPABASE_SERVICE_ROLE_KEY` (and `E2E_OWNER_EMAIL`/`E2E_OWNER_PASSWORD`) from env / `.env.e2e`; service-role `@supabase/supabase-js` client; idempotent by fixed natural keys (delete-and-reinsert or upsert per entity — re-running yields byte-identical screen content). Consult `supabase/migrations/` and `tests/integration/helpers/fixtures.ts` for table shapes; do not import vitest-coupled fixture code.

#### 2. Playwright `visual` project

**File**: `playwright.config.ts`

**Intent**: A third project that runs only the capture file, authenticated as the visual owner, without touching the existing `chromium` project's behavior.

**Contract**: `{ name: "visual", testMatch: /\.visual\.ts$/, use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/owner.json" }, dependencies: ["setup"] }`. No `screenshot:` global option — captures are explicit in the spec.

#### 3. Capture spec

**File**: `tests/e2e/visual/capture.visual.ts`

**Intent**: For each of `/dashboard`, `/menu`, `/room`: navigate, wait for a seeded-content signal (state-based, per screen — e.g. a known item name, a known table label), emulate reduced motion, take a full-page screenshot into `visual-review/screens/<screen>.png`.

**Contract**: One test per screen (independent, per CLAUDE.md); role/text locators for waits; output dir created by the spec; no assertions beyond "content signal visible" — capture, not test.

#### 4. Scripts and hygiene

**File**: `package.json`, `.gitignore`, `.env.e2e.example`

**Intent**: `seed:visual` (`node scripts/seed-visual.mjs`) and `test:visual` (`playwright test --project=visual`) scripts; gitignore `visual-review/`; document the visual-tenant env vars in `.env.e2e.example`.

**Contract**: `test:e2e` behavior unchanged (visual project excluded by its `testMatch`; chromium project never matches `capture.visual.ts`).

### Success Criteria:

#### Automated Verification:

- Lint and typecheck pass: `npm run lint`, `npm run typecheck`
- Seed is idempotent: `npm run seed:visual` twice in a row exits 0 both times
- `npm run test:visual` exits 0 and `visual-review/screens/` contains exactly 3 PNGs
- `npm run test:e2e -- --list` does not list the capture file

#### Manual Verification:

- The 3 screenshots show fully-rendered seeded content (no skeletons, no empty states, no auth redirect), with both availability states visible on `/menu` and F1-kind room objects visible on `/room`

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Rubrics + VLM Review Script

### Overview

The oracle and the judge: per-screen rubric files targeting the redesign's proven failure classes, and a Node script that sends screenshots + rubrics to the Anthropic API and emits findings. Proven honest by a deliberate break.

### Changes Required:

#### 1. Rubric files

**File**: `tests/e2e/visual/rubrics/_universal.md`, `tests/e2e/visual/rubrics/dashboard.md`, `tests/e2e/visual/rubrics/menu.md`, `tests/e2e/visual/rubrics/room.md`

**Intent**: `_universal.md` carries checks that apply to every screen: every element legible against its background (no white-on-white / ink-on-ink), no clipped or overlapping text, no unstyled/fallback rendering, layout integrity at desktop width, visual consistency with the Karta/bistro language (porcelain `#F6F3ED` ground, bottle-green brand, amber decorative-only — reference `src/styles/global.css:19-49`). Per-screen files add the known dangers: **room** — every room object and table visibly distinguishable from the canvas (the F1 class, verbatim), table status states distinguishable; **menu** — gradient heading fully legible on porcelain, availability states visually distinct, printed-menu row intact; **dashboard** — gradient heading legible, role-appropriate nav rendered.

**Contract**: Plain markdown checklists; each line is an atomic, screenshot-decidable check. Severity guidance embedded: CRITICAL = content invisible/illegible or data hidden; MAJOR = broken layout/overlap; MINOR = polish. Rubrics are committed artifacts — updating them when the design language changes is part of §6 cookbook discipline (Phase 4).

#### 2. Review script

**File**: `scripts/visual-review.mjs`

**Intent**: Read `visual-review/screens/*.png` + matching rubrics, call the Anthropic Messages API (vision) once per screen, collect structured findings, and write `visual-review/review.json` (machine) + `visual-review/review.md` (PR-comment body, prefixed with a sticky-comment marker `<!-- orderly-visual-review -->`).

**Contract**: Raw `fetch` to `https://api.anthropic.com/v1/messages` (no new dependency); model from `VISUAL_REVIEW_MODEL` env, default `claude-sonnet-5`; prompt instructs findings-only JSON output bound to rubric lines (screen, severity, rubric line, description) — no free-form defect hunting. Exit contract: findings of any severity → exit 0; `ANTHROPIC_API_KEY` unset → print skip notice, write a "skipped" review.md, exit 0; missing screenshots / API failure / unparseable response → exit 1. Response parsing must tolerate the model wrapping JSON in a fence.

#### 3. Review script wiring

**File**: `package.json`

**Intent**: Add `visual:review` script (`node scripts/visual-review.mjs`).

**Contract**: Runnable locally after `test:visual`; no coupling to CI env beyond `ANTHROPIC_API_KEY`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- With `visual-review/screens/` deleted, `npm run visual:review` exits non-zero
- With `ANTHROPIC_API_KEY` unset, `npm run visual:review` exits 0 and review.md says skipped
- Full local pipeline exits 0: `npm run seed:visual && npm run test:visual && npm run visual:review`

#### Manual Verification:

- **Deliberate break (mandatory, per /10x-e2e discipline)**: temporarily reintroduce a white-on-white room-object color in `src/components/room/room-object-visuals.ts`, re-capture, re-review → a CRITICAL finding on `room` citing the visibility rubric line appears. Revert.
- Clean build reviewed twice → no CRITICAL findings in either run (nondeterminism sanity: MINOR wobble acceptable, CRITICAL wobble is not — tighten the rubric/prompt if it occurs)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: CI Wiring

### Overview

A new path-filtered workflow that runs the whole pipeline on UI-touching PRs and communicates through one sticky comment and an artifact. Always green unless infrastructure fails.

### Changes Required:

#### 1. Visual workflow

**File**: `.github/workflows/visual.yml`

**Intent**: New workflow (separate file — the shared `ci.yml` triggers can't take a `paths:` filter without filtering the `fast`/`db` jobs too), triggered on `pull_request` to `main` with `paths:` covering `src/components/**`, `src/styles/**`, `src/layouts/**`, `src/pages/**` and excluding `src/pages/api/**` (negation pattern). Single job: checkout → node 22 (npm cache) → `npm ci` → `npx playwright install --with-deps chromium` → `npx supabase start` (pinned CLI, copy the `ci.yml:46-50` comment) → write `.dev.vars` for the dev server **and** export `E2E_*` env for provisioning/seed (JWT keys from `supabase status -o env`, fixed CI-only owner credentials, `E2E_PROVISION=1`) → `npm run seed:visual` → `npm run test:visual` → `npm run visual:review` (with `ANTHROPIC_API_KEY` secret) → sticky-comment step → upload `visual-review/` as artifact (`if: always()`).

**Contract**: `permissions: { contents: read, pull-requests: write }`; concurrency group per ref with cancel-in-progress (mirroring `ci.yml:10-12`); the comment step (via `actions/github-script`) finds an existing PR comment containing the `<!-- orderly-visual-review -->` marker and updates it, else creates one — one comment per PR, updated in place. Review step reads the key from env and self-skips when empty (fork PRs), per the script's exit contract.

#### 2. Repository secret

**File**: (GitHub repo settings — not in this repo)

**Intent**: Add `ANTHROPIC_API_KEY` as an Actions secret on `Majloner/OrderLy`. Repo-admin manual action (same class as the branch-protection step quality-gates-ci skipped); the workflow degrades to "skipped" reviews until it exists.

**Contract**: Secret name exactly `ANTHROPIC_API_KEY`; never echoed; used only by the review step.

### Success Criteria:

#### Automated Verification:

- Lint passes on the repo: `npm run lint`
- Workflow YAML parses: the `visual` job appears (even if skipped/filtered) in the PR's checks after push

#### Manual Verification:

- A test PR touching a UI path runs the job green and posts the sticky comment with per-screen findings
- A second push to the same PR **updates** the existing comment (no duplicates)
- A test PR touching only non-UI paths (e.g. `context/**` or `src/pages/api/**`) does not trigger the workflow
- The `visual-review` artifact on the run contains the 3 PNGs + review.json + review.md
- With the secret present, findings match a local run of the same commit (spot check)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding. Note: CI-runner-dependent steps close with PR + run id per quality-gates-ci convention.

---

## Phase 4: Test-Plan Reconciliation

### Overview

Make `context/foundation/test-plan.md` tell the truth about the layer that now exists — including the pre-existing drift this phase inherited.

### Changes Required:

#### 1. Stack table (§4)

**File**: `context/foundation/test-plan.md`

**Intent**: Fix the stale e2e row — Playwright `^1.62` is wired (`tests/e2e/`, chromium + setup projects, `test:e2e`; promotion rule unchanged: only paths integration can't catch). Update the `(optional) AI-native` row: multimodal visual review is wired (capture + rubric + review script + `visual.yml`), refresh `checked:` date, keep the "When NOT to use" guard verbatim.

**Contract**: §4 table rows only; the "none yet — see §3 Phase N" convention no longer applies to either row.

#### 2. Quality gate row (§5)

**File**: `context/foundation/test-plan.md`

**Intent**: Flip `multimodal visual review | CI on PR` from `optional after §3 Phase 4` to `optional — wired (visual.yml, Phase 4)`, following the exact wording convention of the other wired rows.

**Contract**: One table cell.

#### 3. Cookbook (§6)

**File**: `context/foundation/test-plan.md`

**Intent**: Fill §6.3 "Adding an e2e test" (location `tests/e2e/`, naming, the `/10x-e2e` skill as the workflow, seed exemplar `seed.spec.ts`, promotion rule, run command + `.env.e2e`). Add a new §6.8 "Adding a screen to the visual review" (add rubric file + capture test + seed content; severity semantics; the 3-screen cost×signal cap — adding a screen means arguing its risk; deliberate-break proof required). Append a §6.6 phase note (2-3 lines: what Phase 4 taught — e.g. hydration-before-capture, exit-code contract).

**Contract**: §6.3 replaces its TBD line; §6.8 is a new subsection following the existing cookbook format; §8 freshness ledger dates updated.

#### 4. Change record

**File**: `context/changes/testing-ai-native-visual/change.md`

**Intent**: Keep `status`/`updated` current as phases land (planned → implementing → complete per the §3 status vocabulary; the orchestrator may also do this — don't fight it).

**Contract**: Frontmatter fields only.

### Success Criteria:

#### Automated Verification:

- `context/foundation/test-plan.md` contains no remaining `none yet — see §3 Phase 4` string: `grep -c "see §3 Phase 4" context/foundation/test-plan.md` returns 0 relevant hits

#### Manual Verification:

- §4/§5/§6 read consistently with what actually shipped (no aspirational claims); §7 exclusions untouched

---

## Testing Strategy

### Unit Tests:

- None — the layer is capture + prompt + prose; a unit test of the review script would mock the only thing that matters (the VLM). The script's contract is covered by the exit-code checks in Phase 2's automated criteria.

### Integration Tests:

- The full local pipeline (`seed:visual` → `test:visual` → `visual:review`) run end-to-end is the integration test; CI runs it per UI PR.

### Manual Testing Steps:

1. Deliberate-break: inject white-on-white room object → CRITICAL on `/room`; revert → clean.
2. Sticky comment lifecycle on a real PR (create, update-in-place on second push).
3. Path-filter negative case (non-UI PR → no job).

## Performance Considerations

Per-run cost: 3 desktop screenshots (~1-2k image tokens each) + rubrics against `claude-sonnet-5` — well under a cent per PR; the path filter keeps runs to UI PRs only. Job wall-clock dominated by Supabase boot (~2-4 min) + dev-server start; acceptable for an optional, non-blocking check.

## Migration Notes

Nothing to migrate — the layer is additive. If the review proves noisy in practice, the rubrics are the tuning surface (tighten lines, adjust severity guidance) before touching the model or prompt. If it proves useless, deleting `visual.yml` + the `visual` project reverts cleanly.

## References

- Governing rollout row: `context/foundation/test-plan.md` §3 Phase 4, §5 gate row
- F1 escape (the motivating bug): `context/archive/2026-07-28-ui-redesign/reviews/impl-review.md`
- Redesign design tokens: `src/styles/global.css:19-49`
- Provisioning pattern: `tests/e2e/auth.setup.ts:50-69`
- CI Supabase pattern: `.github/workflows/ci.yml:46-63`
- Binding vision/locator rules: `CLAUDE.md:19-45`, `.claude/skills/10x-e2e/SKILL.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Visual Capture Harness

#### Automated

- [x] 1.1 Lint and typecheck pass (`npm run lint`, `npm run typecheck`)
- [x] 1.2 Seed is idempotent (`npm run seed:visual` twice, exit 0 both times)
- [x] 1.3 `npm run test:visual` exits 0 with exactly 3 PNGs in `visual-review/screens/`
- [x] 1.4 `npm run test:e2e -- --list` does not list the capture file

#### Manual

- [x] 1.5 Screenshots show fully-rendered seeded content (both availability states on /menu, F1-kind objects on /room)

### Phase 2: Rubrics + VLM Review Script

#### Automated

- [ ] 2.1 Lint passes
- [ ] 2.2 Missing screenshots → `visual:review` exits non-zero
- [ ] 2.3 Unset `ANTHROPIC_API_KEY` → exits 0 with "skipped" review.md
- [ ] 2.4 Full local pipeline exits 0 (seed → capture → review)

#### Manual

- [ ] 2.5 Deliberate break produces CRITICAL finding on room; revert restores clean
- [ ] 2.6 Clean build reviewed twice with no CRITICAL in either run

### Phase 3: CI Wiring

#### Automated

- [ ] 3.1 Repo lint passes
- [ ] 3.2 `visual` job appears in PR checks after push

#### Manual

- [ ] 3.3 UI-touching test PR runs green and posts sticky comment
- [ ] 3.4 Second push updates the comment in place (no duplicate)
- [ ] 3.5 Non-UI PR does not trigger the workflow
- [ ] 3.6 Artifact contains 3 PNGs + review.json + review.md
- [ ] 3.7 `ANTHROPIC_API_KEY` secret added (repo admin)

### Phase 4: Test-Plan Reconciliation

#### Automated

- [ ] 4.1 No stale "none yet — see §3 Phase 4" rows remain in test-plan.md

#### Manual

- [ ] 4.2 §4/§5/§6 consistent with shipped reality; §7 untouched; §8 ledger dates refreshed
