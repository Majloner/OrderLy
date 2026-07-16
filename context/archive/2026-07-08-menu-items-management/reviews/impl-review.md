<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Menu Items Management (S-03)

- **Plan**: context/changes/menu-items-management/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-07-17
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Success Criteria (automated)

- `npm run lint` — PASS (0 errors)
- `npm run typecheck` — PASS (0 errors, 4 hints)
- `npm test` — PASS (20/20)
- `npm run build` — PASS

Manual criteria (2.5, 3.5–3.10) were checked `[x]` in Progress and confirmed by the user during implementation.

## Context

A prior ad-hoc `/code-review` ran and its confirmed findings were fixed in commit `b34cef8`
(atomic reorder RPC, cross-tenant category validation, DB-side sort_order triggers, refetch
resilience, orphan-item fallback, `"use client"` removal, dashboard owner-gating, middleware
exact-match, client reuse, dead `card.tsx` removed). This impl-review confirms those fixes are
sound and the implementation matches the plan. All findings below are optional hardening/UX
follow-ups; none blocking.

## Findings

### F1 — Cross-section move does not reset sort_order

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/menu/items/[id].ts:26
- **Detail**: The BEFORE INSERT trigger only assigns sort_order on INSERT. On a PUT that changes an item's category_id, sort_order is not recomputed, so the moved item keeps its old value and lands at an arbitrary position in the destination section (GET orders by sort_order then name). Same for DELETE categories/[id] — items dropped to "Bez kategorii" retain sort_orders that may collide. No corruption; only surprising placement until the owner drags.
- **Fix**: On a PUT that changes category_id, reset sort_order to append-at-end of the target section (mirror the insert path), or defer to S-05 with a note.
- **Decision**: FIXED (migration 20260717094500_menu_item_move_reorder.sql — BEFORE UPDATE OF category_id trigger; also covers FK SET NULL on category delete)

### F2 — reorderSchema has no upper bound

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schemas/menu.ts:49
- **Detail**: The reorder id array is `min(1)` with no `.max()`. Owner-only and now a single atomic RPC, so blast radius is one tenant's own data (low risk), but an explicit cap hardens the hot path against a pathological payload.
- **Fix**: Add `.max(500)` (or a sensible cap) to reorderSchema.
- **Decision**: FIXED (reorderSchema `.max(500)` + Vitest case; 21/21)

### F3 — Owner-role guard lives only in middleware (no in-page fallback)

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/menu.astro:1
- **Detail**: Plan Phase 3 §1 said the page frontmatter should server-side enforce the owner role (redirect non-owners). Implementation gates via OWNER_ROUTES in src/middleware.ts with matchesRoute; menu.astro has no guard of its own. Functionally equivalent and cleaner (single source of route protection), but zero defense-in-depth if middleware matching ever regresses. Note: the data layer is still protected by RLS + the API 403, so the exposure would be a rendered empty shell, not data.
- **Fix A ⭐ Recommended**: Accept the middleware-only guard as the intentional single source of truth; it's cleaner and RLS/API remain the real enforcement.
  - Strength: One place to reason about route protection; matches how /settings is handled.
  - Tradeoff: A middleware-matching regression would render the shell to non-owners (no data leak).
  - Confidence: HIGH — RLS + API 403 are the actual data guards.
  - Blind spot: None significant.
- **Fix B**: Add a belt-and-suspenders role check in menu.astro frontmatter (redirect to /dashboard).
  - Strength: Defense-in-depth matching the plan's literal intent.
  - Tradeoff: Duplicates the guard; two places to keep in sync.
  - Confidence: MED — low cost, marginal benefit given RLS.
  - Blind spot: None significant.
- **Decision**: ACCEPTED (Fix A — middleware is the intentional single source of route protection; RLS + API 403 remain the real data guards)

### F4 — Anon read is cross-tenant by design

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: supabase/migrations/20260708124756_menu_categories_items.sql:68
- **Detail**: menu_categories_anon_read uses `using (true)` and menu_items_anon_read_visible has no company_id predicate, so an anon client can enumerate categories/published items across tenants; company scoping is applied in-app from the scanned QR. Not introduced by S-03 — mirrors the pre-existing companies_anon_read / tables_anon_read_active design. Flagged only to keep it on the radar against the "tenant isolation is non-negotiable" rule before the public QR menu (S-07/S-08) ships.
- **Fix**: Revisit the anon-read model product-wide when building S-07/S-08 (e.g. scope anon reads by the QR-resolved company_id); out of scope for S-03. Candidate for /10x-lesson.
- **Decision**: ACCEPTED-AS-RULE: "Anon RLS reads must be scoped by company_id" (context/foundation/lessons.md) — code left unchanged (out of scope for S-03)

### F5 — Client-creation pattern diverges from company/profile.ts

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/company/profile.ts:22
- **Detail**: The new /api/menu routes correctly reuse context.locals.supabase (the better pattern now that middleware stashes it). The pre-existing company/profile.ts still calls createClient(...) itself, so the two patterns diverge. Out of scope for this change.
- **Fix**: Align profile.ts to reuse locals.supabase in a later cleanup.
- **Decision**: FIXED (profile.ts now reads context.locals.supabase; dropped createClient import)

### F6 — Planned shadcn `card` primitive not present

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/ui/
- **Detail**: Phase 3 §2 listed `card` among the shadcn primitives to install. It was installed then removed in b34cef8 as unused (sections use plain Tailwind-styled containers). Effectively an intentional simplification; no functional impact.
- **Fix**: None needed — re-add via `npx shadcn@latest add card` only if a consumer appears.
- **Decision**: SKIPPED (intentional simplification — plain Tailwind containers; re-add if a consumer appears)
