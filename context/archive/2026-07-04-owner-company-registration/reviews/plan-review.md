<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Owner Company Registration (S-01)

- **Plan**: context/changes/owner-company-registration/plan.md
- **Mode**: Deep
- **Date**: 2026-07-06
- **Verdict**: REVISE → SOUND (after fixes)
- **Findings**: 0 critical, 2 warnings, 2 observations (all resolved)

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

5/5 paths ✓, symbols ✓, brief↔plan ✓. `signup.ts` uses `auth.signUp({email,password})`; `companies_update_owner` exists (F-01); `enable_confirmations=false` locally; `supabase config push` exists and pushes the whole config.toml (validates F2).

## Findings

### F1 — Duplicate email: signUp returns no session and no error → redirect to /dashboard without a session

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 (signup.ts) + criterion 2.4
- **Detail**: With confirmations off, Supabase can return `{ user, session: null, error: null }` for an existing email (enumeration-safe). The endpoint redirected to /dashboard on absence of `error` alone → unauthenticated redirect that bounces to signin.
- **Fix**: Check `data.session` before redirecting; no session → back to /auth/signup with a generic message.
- **Decision**: FIXED (Phase 2 signup.ts contract updated with the session check)

### F2 — `supabase config push` overwrites the entire remote auth config

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 #2 (disable confirmations)
- **Detail**: `config push` sends the whole local starter config.toml to hosted, potentially clobbering Site URL / redirect URLs / providers.
- **Fix A ⭐ Recommended**: Disable "Confirm email" via the dashboard toggle (surgical).
- **Fix B**: Keep `config push` but `config pull` + review the diff first.
- **Decision**: FIXED via Fix A (Phase 1 #2 contract + Critical Details now say dashboard toggle, not config push)

### F3 — Confirmations-off is a project-wide security downgrade + open unlimited company creation

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 #2 + trigger
- **Detail**: Confirmations off affects all auth; open signup lets anyone create unlimited companies. MVP-acceptable but conscious.
- **Fix**: Note as MVP debt; re-enable confirmations + add an abuse guard in phase 2.
- **Decision**: FIXED (note added to "What We're NOT Doing")

### F4 — Verification is dev-server only; production deploy is outside the plan phases

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Migration Notes / manual criteria
- **Detail**: DB trigger goes live via db push, but endpoint/form/settings need `wrangler deploy` to reach prod; manual criteria test the dev server.
- **Fix**: Accept — deploy is a separate step after the slice (already noted in Migration Notes).
- **Decision**: ACCEPTED (no change)
