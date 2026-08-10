<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Obiekty wyposażenia sali (`room_objects`)

- **Plan**: `context/changes/room-objects/plan.md`
- **Scope**: Full plan — phases 1–5 of 5
- **Date**: 2026-08-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria re-run (2026-08-04)

| Command | Result |
|---|---|
| `npm run test` | PASS — 170 tests, 6 files |
| `npm run typecheck` | PASS — 0 errors, 104 files |
| `npm run lint` | PASS — exit 0 |
| `npm run build` | PASS — Complete |
| `npm run test:rls` | PASS — exit 0, reached the rollback proof (`companies_after_rollback: 3`) |
| `npm run db:push` | PASS — applied as `20260804120000`, local/remote histories aligned |

Manual rows: 33/42 Progress rows closed. The 9 open rows are unchecked, not
rubber-stamped — each is blocked by a real limitation (synthetic drags are cancelled
by dnd-kit's PointerSensor, touch cannot be emulated, no waiter account exists).
The 11 ticked in `8766fcd` each carry measured evidence in that commit message.

Plan adherence was audited change-by-change: **zero DRIFT, zero MISSING**. Three
benign EXTRAs — `MAX_ROTATION_DEGREES`, the delete button inside `RoomObjectDialog`,
and the reworded empty-state string. Nothing in `## What We're NOT Doing` was
violated: no schema change to `tables`, `tables_anon_read_active` untouched, no
`is_active`/`z_index`/`number` on objects, no overlap blocking, no zoom/pan, no
seeding in `handle_new_user()`, `src/lib/api.ts` not in the branch diff at all.

## Findings

### F1 — Missing `onDragCancel` leaves an element permanently click-dead

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/room/RoomCanvas.tsx:60-95, 98
- **Detail**: `draggedIdRef` is set in `onDragStart` and cleared only in `onDragEnd`.
  `DndContext` registers no `onDragCancel`. Verified against the shipped library
  (`node_modules/@dnd-kit/core/dist/core.cjs.development.js`): `AbstractPointerSensor`
  routes `pointercancel`, **window resize**, **visibilitychange** and `Escape` to
  `handleCancel`, which dispatches `DragCancel` — and `createHandler` never falls
  through to `onDragEnd`. So after any cancelled drag, `draggedIdRef.current` stays
  pinned to that id forever and both guards (`onSelect`, `onOpen`, and the table's
  `onActivate`) swallow every subsequent click on that element. It can no longer be
  selected or opened until an unrelated drag completes or the page is reloaded.
  Window-resize is the nastiest trigger here, because this canvas is explicitly
  responsive and resizing mid-drag is natural. **This was observed live during
  verification** — dnd-kit's own live region printed "Dragging was cancelled" and the
  selection went dead.
- **Fix**: Add `onDragCancel` to the `DndContext` clearing the ref on a macrotask, the
  same way `handleDragEnd` does. It cannot reuse `handleDragEnd` verbatim — that would
  persist the drag delta.
- **Decision**: FIXED — extracted `releaseDraggedId()` and wired it to both `onDragEnd`
  and a new `onDragCancel`.

### F2 — Resize rounding is a monotonic ratchet: the object walks 1px per grow/shrink cycle

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/room-geometry.ts:266-277 (with `clampCentreAxis`, :164)
- **Detail**: When the size change is odd, `localShiftX/Y` is a half-integer, and
  `clampCentreAxis` applies `Math.round`. JS `Math.round` breaks `.5` toward `+∞`
  **regardless of sign**, so the error is biased and never cancels. Verified by
  arithmetic on a 100×100 object centred at 600: growing +1 moves the centre to 601
  (left edge 550 → 550.5); shrinking −1 back to width 100 leaves the centre at 601
  (left edge 551). The size returns exactly, the object does not. Measured
  independently over 50 out-and-back cycles: the object translated 50px on each axis
  with its size unchanged — that is 4% of the canvas from pure fidgeting. Nudging a
  corner out and back is the most natural way to dial in a size. The existing test
  "keeps the opposite corner still" passes only because it uses even deltas (100, 50)
  and structurally cannot catch this.
- **Fix A ⭐ Recommended**: Preserve the anchored corner instead of the centre — compute
  `anchor = centre − handle·size/2` before resizing, then derive
  `centre = anchor + handle·newSize/2` and round once at the end.
  - Strength: Makes the invariant the user actually perceives ("the corner I'm not
    holding doesn't move") the quantity the maths preserves, so the error cannot
    accumulate by construction.
  - Tradeoff: Rewrites the centre derivation in `applyResizeDelta`; needs a new
    regression test with an odd delta.
  - Confidence: HIGH — the invariant is already the one the existing test asserts, just
    with even numbers.
  - Blind spot: Interaction with `clampObjectCenter` at the canvas edge is not worked
    through; the anchor may need clamping too.
- **Fix B**: Keep an unrounded centre in `draft` for the duration of the gesture and
  round only at commit.
  - Strength: Smaller diff; removes intra-gesture drift without touching the algebra.
  - Tradeoff: Does not fix drift ACROSS gestures, which is the measured problem —
    each commit still rounds.
  - Confidence: MEDIUM — mitigates rather than removes.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A, with a correction to the recommendation itself. Anchoring
  alone does NOT close the cycle — with an integer centre and an odd size a corner must
  land on a half pixel, so something has to round regardless. The round trip only becomes
  exact when the two roundings DISAGREE on .5: the anchor is now rounded half-down
  (`roundHalfDown`) while `clampCentreAxis` keeps rounding half-up, so the half pixel
  taken when growing is given back when shrinking. Two regression tests added, including
  25 grow/shrink cycles asserting an exact return; the pre-existing even-delta test still
  passes.

### F3 — `persistObjectTransform` reintroduces the full-PUT clobber this codebase forbids

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Pattern Consistency
- **Location**: src/components/room/RoomLayoutManager.tsx:52-64, 278-323 (esp. 295-299)
- **Detail**: `objectToInput(object, next)` rebuilds a FULL `RoomObjectInput` — including
  `room_id`, `kind` and `label` — from the prop snapshotted at gesture end, then PUTs it.
  That is exactly the failure mode this repo documents in three separate places and
  deliberately engineered around for tables: `tables/[id]/activation.ts:11-14`,
  `objects/[id]/position.ts:12-14`, and this very file at :325-327 ("rewriting all seven
  columns from client state lets a stale tab silently revert a drag or rename made
  elsewhere (impl-review F5)"). Failure scenario: the owner rotates a wall (transform PUT
  queued behind an in-flight position PATCH on a slow link), then immediately renames it
  in the dialog. `saveObject` goes through a DIFFERENT path that is not in
  `objectPositionQueue`, succeeds, and the queued transform PUT then lands carrying the
  pre-rename `label` and pre-move `room_id`, silently reverting both. Note the plan itself
  specified PUT here ("Zapis przez `PUT`… nie `PATCH position`"), so this is a flaw
  inherited from the plan, not a deviation from it.
- **Fix A ⭐ Recommended**: Add `PATCH /api/room/objects/[id]/transform` taking only
  `{pos_x, pos_y, width, height, rotation}` — the exact sibling of the existing position
  route — and delete `objectToInput`.
  - Strength: Restores the single rule the whole module is built on: every non-dialog
    mutation touches only the columns it owns. Mirrors a route that already exists, so
    there is nothing to invent.
  - Tradeoff: One more route, one more zod schema, one more assertion's worth of surface;
    amends a plan contract after the fact.
  - Confidence: HIGH — `objects/[id]/position.ts` is the template, line for line.
  - Blind spot: Whether the dialog's own save should ALSO be narrowed is not settled here.
- **Fix B**: Keep the PUT but rebuild the body from the freshest row inside the functional
  `setLayout` updater rather than the closed-over prop.
  - Strength: No new route; shrinks the stale window substantially.
  - Tradeoff: Shrinks but does not close it — a concurrent write between the read and the
    PUT still clobbers. Leaves objects diverging from the tables pattern.
  - Confidence: MEDIUM — narrows the race without removing the class.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B first, then SUPERSEDED BY Fix A — the window is now closed,
  not merely narrowed. `PATCH /api/room/objects/[id]/transform` takes geometry only, so
  `room_id`, `kind` and `label` are never in the body and a concurrent rename or room move
  cannot be reverted by a queued gesture. `roomObjectTransformSchema` is `.pick()`ed from
  the input schema so the bounds cannot drift apart, and a test asserts the three
  ownership columns are stripped rather than written. The route needs no read-before-write
  either, unlike `./position`, because the request already carries width, height and
  rotation — one round trip instead of two. Both Fix B scaffolds (`objectToInput`, the
  `layoutRef` mirror) were deleted as dead.

### F4 — Handle gesture can leak: unmount mid-gesture leaves `draft` and `gestureRef` armed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/room/DraggableRoomObject.tsx:74-88, 192-224
- **Detail**: The gesture is torn down only by `onPointerUp`/`onPointerCancel` fired on the
  handle button itself, but the handles are conditionally rendered on
  `selected && !isDragging` (:192). Per the Pointer Events spec, removing a capturing
  element from the document releases capture and retargets the remaining events — the
  button's React handlers never fire. There is no `onLostPointerCapture` and no unmount
  cleanup. Two persistent consequences: (1) `draft` stays non-null and, because
  `shown = draft ?? object` (:56), the object renders at an uncommitted size/angle that
  even a `refetch()` cannot correct — the draft shadows the prop; (2) `gestureRef` stays
  populated, and since `onPointerMove` is bound unconditionally and gated only on
  `gestureRef.current`, merely HOVERING a corner handle then resizes the object against a
  dead origin, and the next `pointerup` commits it. Reachable on touch: finger A holds a
  handle, finger B starts a body drag, `isDragging` flips, handles unmount mid-gesture.
- **Fix**: Record `event.pointerId` in `gestureRef` and ignore other pointers; add
  `onLostPointerCapture={endGesture}` to each handle; drop the draft in a `useEffect`
  cleanup; and hide handles during a body drag with `visibility`/`opacity` rather than
  unmounting them.
- **Decision**: FIXED — all four. `gestureRef` now carries `pointerId` and a shared
  `gestureStart()` guard rejects events from any other pointer; `onLostPointerCapture` is
  wired to `endGesture` on all five handles (this is the one that actually catches the
  silent release, and it COMMITS the draft rather than dropping it, so an interrupted
  gesture keeps what the user last saw); handles are hidden with `invisible` during a body
  drag instead of unmounted; an unmount cleanup clears `gestureRef`. `tabIndex={-1}` was
  added at the same time, which also resolves half of F8.

### F5 — Optimistic rollback restores an optimistic value, not a server-confirmed one

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/room/RoomLayoutManager.tsx:245, 279-285
- **Detail**: The chaining itself is sound — both queue bodies are fully try/caught so `run`
  can never reject, the tail `.catch` is redundant belt-and-braces, and the `finally`
  identity guards correctly avoid evicting a newer tail. The defect is `before`: it reads
  the `object` prop, which by then already carries the PREVIOUS optimistic, unconfirmed
  patch. If drag A (P0→P1) is in flight and drag B (P1→P2) is enqueued, `before_B = P1`; if
  both fail offline, A rolls back to P0 and B then rolls forward to P1 — a position the
  server never accepted, while the banner claims the save failed.
- **Fix**: Capture `before` from inside the functional `setLayout` updater (read the row out
  of `prev`) rather than from the closed-over prop.
- **Decision**: FIXED, but NOT by the fix as written — that one does not work. Reading from
  `prev` at enqueue time still yields P1, because A's optimistic patch is already applied
  by then; it moves the staleness rather than removing it. Any client-held "before" is
  optimistic once a second gesture queues behind the first. `before` was therefore deleted
  from both persist functions and the failure path now calls `refetch()` instead — the
  server is the only party that knows what was actually accepted. If the refetch also
  fails we are offline, the banner already says so, and the canvas keeps the optimistic
  value, which is strictly better than restoring a position nobody ever accepted.
  Note `persistPosition` for TABLES still carries the same stale-`before` shape; out of
  scope here, worth a follow-up.

### F6 — The new isolation fixtures are ungated, so the whole suite hard-fails without the migration

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/tests/rls_isolation.sql:82-86
- **Detail**: The `room_objects` fixture insert is unconditional and runs before every
  assertion, so on any database without `20260804120000` the suite aborts with `42P01`
  before a single assertion executes. That is precisely the failure the assertion-20 gate
  was written to prevent; its own comment (:666-671) argues a hard failure would be
  "training everyone to ignore a red test:rls and hiding the other twelve assertions".
  The new assertions 24–26 got no such treatment. Currently harmless — the migration IS
  applied — but it bites the next person with a fresh database.
- **Fix**: Gate the object fixture and assertions 24–26 on
  `to_regclass('public.room_objects') is not null`, mirroring :672-684.
- **Decision**: FIXED, then REVERTED by decision — and the reverted state is the right one.
  The gates were added first (fixture, the anon count in assertion 5, assertions 24–26,
  each emitting a SKIP notice), then removed once it was clear they protected a window
  that closes the moment PR #24 merges: main will carry the migration, and any fresh local
  Supabase applies it on `db reset`. Keeping them would have reproduced exactly the smell
  F10 was raised about — a permanently-true condition that reads as "this assertion is
  optional". The suite is unconditional again and passes end to end.

### F7 — Native `min`/`max` validation preempts the Polish zod messages

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/room/RoomObjectDialog.tsx:152-193
- **Detail**: `type="number"` with `min`/`max` inside a `<form>` engages HTML constraint
  validation, which blocks submission with a browser-native bubble before `handleSubmit`
  runs. The carefully authored messages in `schemas/room.ts:97-108` ("Szerokość musi
  wynosić co najmniej 10 px", "Obrót musi być mniejszy niż 360 stopni") are therefore
  unreachable for out-of-range values, and the inline red `<p>` never renders for them.
  `TableDialog.tsx:108-117` avoids this by using a plain input with `inputMode="numeric"`
  and letting zod own validation.
- **Fix**: Drop `type="number"`/`min`/`max` in favour of `inputMode="numeric"`, matching
  `TableDialog`, so zod remains the single validation authority.
- **Decision**: FIXED on all three numeric inputs; `OBJECT_SIZE_BOUNDS` and
  `MAX_ROTATION_DEGREES` imports dropped from the dialog with them.

### F8 — Handles are five dead tab stops, and clicking an object never focuses it

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/room/DraggableRoomObject.tsx:195-222 (and :76)
- **Detail**: The five handles are real `<button>`s with no `onClick` and no `onKeyDown`, so
  each selected object adds five tab stops that do nothing. Separately — **confirmed live
  in the browser** — clicking a canvas object leaves `document.activeElement` as `BODY`,
  because `PointerSensor` calls `preventDefault()` on `pointerdown`, which suppresses
  focus. Tab reaches the object and Enter then opens the dialog (verified), so the
  accessible path holds; but "click the object, then press Enter" silently does nothing.
- **Fix**: Give the handles `tabIndex={-1}` (the dialog is the documented keyboard path for
  size and rotation), and decide deliberately whether clicking should focus.
- **Decision**: PARTIALLY FIXED — `tabIndex={-1}` landed with F4, so the five dead tab stops
  are gone. The click-does-not-focus half was SKIPPED by decision: Tab reaches the object
  and Enter opens the dialog, so the accessible path holds, and forcing focus would mean
  fighting `PointerSensor`'s `preventDefault`.

### F9 — Dragging the rotate handle through the centre commits 0°

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/room/DraggableRoomObject.tsx:107-129; src/lib/room-geometry.ts:299-301
- **Detail**: `applyRotateDelta` returns `0` inside the ±0.5px dead zone. The dead zone is
  documented and correct as a guard against `atan2(0,0)`, but its consequence at commit
  time is not: dragging the rotate handle across the object's own centre snaps the preview
  upright, and releasing there persists `rotation: 0`, discarding the angle the user had.
- **Fix**: Return the previous angle inside the dead zone instead of 0 — pass the current
  rotation into `applyRotateDelta` as the fallback.
- **Decision**: FIXED — `applyRotateDelta` takes a `fallback` (default 0, so existing
  callers are unaffected) and normalises it; the component passes `shown.rotation`, the
  angle already on screen. One regression test covers the hold and the negative wrap.

### F10 — Dead SKIP scaffolding left in the isolation suite

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/tests/rls_isolation.sql:672-684
- **Detail**: Assertion 20's `pg_constraint` gate exists because `20260728120000` could not
  be pushed at the time. It is now committed and applied, so the gate always enables and
  the SKIP branch is unreachable. Harmless, but it is the kind of conditional that later
  reads as "this assertion is optional".
- **Fix**: Drop the gate and let assertion 20 run unconditionally.
- **Decision**: FIXED — gate removed, `has_fk` gone, and the comment now records why it
  existed and why it no longer needs to.
