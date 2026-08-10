---
change_id: room-objects
title: Room furnishing objects in the layout editor
status: impl_reviewed
created: 2026-07-28
updated: 2026-08-04
archived_at: null
---

## Notes

Follow-up to `room-layout-tables` (S-06), parked there as a separate change — see that
`change.md`, "Follow-up parked as a separate change". Read
`context/changes/room-layout-tables/plan.md` first: the API, RLS and UI patterns to mirror are
described there.

Scope agreed with the user 2026-07-28: a new `room_objects` entity, **deliberately separate from
`tables`**, with nine kinds — wall, chair, door, window, bar, plant, stairs, toilet, till.

Why a separate table rather than a `kind` column on `tables`:

- **no number** — objects have no guest-visible identifier (`tables.number` is unique per company
  per FR-010),
- **deleting is ALLOWED** — no permanent QR code is attached to an object, so the "deactivate,
  never delete" guardrail does not apply. This is the sharpest difference: `public.tables`
  deliberately has no DELETE policy in RLS, `room_objects` should have one,
- **own `width`/`height`** instead of a fixed per-shape footprint (a wall is a long thin
  rectangle),
- **`rotation`** — without it walls can only be horizontal segments and the entity is useless.

Constraints to carry into the plan:

- Migration `supabase/migrations/YYYYMMDDHHmmss_*.sql`; latest is
  `20260727120000_room_layout_tables.sql`.
- RLS mandatory: four per-operation policies following the `rooms_select_staff` / `_insert_owner` /
  `_update_owner` / `_delete_owner` pattern from `20260727120000_room_layout_tables.sql`. **No
  `to anon` policy** — see the open lesson in `context/foundation/lessons.md` about anon-read
  without a `company_id` predicate.
- Extend `supabase/tests/rls_isolation.sql` with write + isolation assertions for the new table
  (`npm run test:rls`, needs a linked project).
- Do NOT refactor `src/lib/api.ts` (the S-02 branch touches it) — follow `src/lib/room-api.ts` and
  its `guardTablesRequest`.
- Canvas: render objects BELOW tables (`z-index`), in the same `DndContext`. `touch-none` on the
  dragged node is mandatory, otherwise mobile browsers scroll the page instead of starting a drag.
- Scale conversion: dnd-kit deltas are in rendered pixels, positions are logical (1200x800) — use
  `applyDragDelta` from `src/lib/room-geometry.ts`, do not recompute it. Resize/rotate handles need
  the analogous conversion and belong in the same module as pure, tested functions.
- If the dev server throws "Cannot find module" or "Invalid hook call" after new files are added:
  stale cache — `rm -rf node_modules/.vite` and restart, do not hunt for a bug in the code.

Biggest risk: resize and rotate handles are realistically as much work as the whole tables canvas.
Consider a rotation-free phase (horizontal/vertical rectangles only) as an intermediate step.
