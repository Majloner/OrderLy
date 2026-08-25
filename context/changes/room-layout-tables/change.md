---
change_id: room-layout-tables
title: Room layout and tables
status: impl_reviewed
created: 2026-07-23
updated: 2026-07-28
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap S-06 (`context/foundation/roadmap.md`), PRD: FR-008, FR-009, FR-010. Prereq S-01 (done).
- Owner designs the room in a visual editor, adds tables, activates/deactivates them, identifies by number.
- Runs in parallel with S-02 (staff-accounts-roles) — disjoint domains (tables vs profiles/auth).
- `tables` exists (F-01): `id, company_id, number, label, is_active, created_at` — extend with layout
  columns (e.g. pos_x/pos_y/shape) via ALTER; narrow `tables_staff_all` to owner-only writes (mirror the
  menu narrowing from S-03). `tables_anon_read_active` stays for the future client menu.
- `dnd-kit` is already installed (S-03) — reuse it for the drag-on-canvas editor.
- Guardrail: deactivate, never delete — the permanent per-table QR (S-07) must stay valid.
- Parallel-work coordination: do NOT refactor `src/lib/api.ts`'s guard into a shared helper concurrently
  with S-02 — inline an own owner guard (e.g. guardTablesRequest) or agree the refactor up front.
- Shared append-only files (merge with S-02 branch): src/middleware.ts, src/pages/dashboard.astro,
  src/types.ts, supabase/tests/rls_isolation.sql.

## Verification caveats (recorded 2026-07-28)

- **Waiter-role checks were skipped, by decision.** Plan rows 2.7 (API returns 403 to a waiter) and
  the second half of 3.4 (waiter on `/room` is redirected to `/dashboard`) are marked done but were
  NOT observed: S-02 (`staff-accounts-roles`) does not exist yet, so there is no way to create a
  `waiter` account without hand-inserting a `public.profiles` row. Accepted because (a) DB-level
  denial IS proven — `rls_isolation.sql` assertion 10 asserts a waiter can write neither `rooms` nor
  `tables`, (b) `/room` was added to the same `OWNER_ROUTES` array that already gates `/menu`, adding
  an entry rather than new logic, and (c) `guardTablesRequest` mirrors `guardMenuRequest` check for
  check. Re-verify when S-02 lands and can provision a waiter.
  **Closed 2026-08-25**: both halves are now continuously observed by
  `context/changes/middleware-route-protection/` — the authz route matrix covers the API 403,
  and `tests/integration/authz/middleware.test.ts` asserts a real waiter session on `/room`
  is redirected to `/dashboard`.
- **Row 2.8 (position clamping) was closed in phase 4**: verified by dragging past the canvas edge
  and observing the snap to the footprint boundary, which exercises the same server-side
  `clampPosition` the console `PATCH` would have.
- Follow-up parked as a separate change: room furnishing objects (walls, chairs, doors, windows, bar,
  plant, stairs, toilet, till) as a new `room_objects` entity. Deliberately NOT part of S-06 — FR-008
  covers tables only. Note for whoever picks it up: unlike `tables`, that table SHOULD have a delete
  policy, since no permanent QR code is attached to a chair.
