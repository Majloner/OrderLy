<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Schemat sali i stoliki (S-06)

- **Plan**: `context/changes/room-layout-tables/plan.md`
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-07-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 8 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Success criteria re-run (independent of what the phases reported)

| Command | Result |
|---|---|
| `npm run test` | PASS — 65 tests, 3 files |
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — exit 0 |
| `npm run build` | PASS |
| `npm run db:push` | PASS — `20260727120000` applied on remote |
| `npm run test:rls` | FAILED at review time, then fixed — see note |

`test:rls` broke for an external reason: the shared hosted DB advanced with two S-02
migrations (`20260727220415`, `20260728101449`) adding `profiles.email NOT NULL` and
`profiles.deactivated_at`. The fixture inserted profiles without `email`, so the run aborted
before reaching any assertion. Fixture fixed during this review (`rls_isolation.sql:32-40`);
the run then passed with the rollback-proof row. **This edit is uncommitted.** Side effect: the
branch now depends on a column no migration in it creates, so `db:reset` on a clean local DB
from this branch alone would fail until S-02 merges.

Two manual rows are marked done without observation, recorded honestly in `change.md`: 2.7
(waiter gets 403) and the waiter half of 3.4. S-02 cannot provision a waiter yet.

## Plan adherence summary

Every load-bearing commitment verified individually and matching: `ALTER` without re-`CREATE`;
the four-step `room_id → NOT NULL`; deterministic renumbering before the unique index; no delete
policy on `tables`; `tables_anon_read_active` untouched; no anon policy on `rooms`;
`handle_new_user()` retaining all prior side effects (diffed against
`20260708124756_menu_categories_items.sql:146-173`); `src/lib/api.ts` unmodified; `clampPosition`
on all three server write paths; no `DELETE` handler under `api/room/tables/`. Nothing from
"What We're NOT Doing" was built.

Minor deviations, none material: the room delete flow lives in `RoomLayoutManager` rather than
`RoomDialog` as the plan assigned; `rooms_company_name_idx` is on `(company_id, lower(name))`
rather than the plan's literal `(company_id, name)` — the implementation is right and the plan
was under-specified, but it means "Taras" and "taras" now collide with a 409.

**Correction to the record**: the epilogue commit message (`a2f1906`) says "All 22 Progress rows
are done". The real count is 33 (6+8+8+11). All are `[x]`, so the claim's substance holds; the
number is wrong and was repeated several times during implementation.

## Findings

### F1 — `tables.room_id` can point at another tenant's room; only app code prevents it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality (tenant isolation)
- **Location**: supabase/migrations/20260727120000_room_layout_tables.sql:93
- **Detail**: `tables_insert_owner` / `tables_update_owner` validate only `tables.company_id`. FK
  validation on `room_id` runs below RLS, so the database accepts
  `(company_id = A, room_id = <B's room>)`. The sole defence is `roomExistsInCompany`
  (`tables.ts:23`, `tables/[id].ts:34`) — application code, not an invariant.
  Failure scenario: any future write path that omits that call (a bulk import, an S-07 QR route,
  a `PATCH` that starts accepting `room_id`) creates a row in A referencing B's room. B never sees
  it (RLS) but B's `DELETE /api/room/rooms/<id>` then returns 409 "move the tables first" forever
  — for tables B can neither see nor move. Cross-tenant denial of service on room deletion,
  unfixable through the UI. `rls_isolation.sql` assertion 12 tests `company_id = B` (which RLS
  blocks) and never tests this case (which RLS permits).
- **Fix A ⭐ Recommended**: Make it structural — `unique (company_id, id)` on `rooms`, then a
  composite FK `foreign key (company_id, room_id) references rooms (company_id, id)` on `tables`.
  Add the missing RLS assertion.
  - Strength: The invariant moves into the schema, so no future code path can violate it; matches
    the project's stated position that tenant isolation is enforced by the DB, not by discipline.
  - Tradeoff: A second migration against a live DB, plus a redundant unique index on `rooms`.
  - Confidence: HIGH — composite FK is the standard fix and `roomExistsInCompany` shows the
    invariant is already understood.
  - Blind spot: Haven't checked whether S-02's two unmerged migrations touch `rooms`.
- **Fix B**: Add only the RLS test assertion, leaving enforcement in app code.
  - Strength: Documents the gap and fails loudly if `roomExistsInCompany` is ever dropped; no
    migration needed.
  - Tradeoff: The invariant stays outside the schema — the test only catches regressions someone
    runs it against.
  - Confidence: MEDIUM — depends on `test:rls` staying in the loop, and it is not in CI.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — **written, not yet applied to the DB.**
  `supabase/migrations/20260728120000_room_tables_composite_fk.sql` adds
  `rooms_company_id_id_key` and swaps `tables_room_id_fkey` for the composite
  `tables_company_id_room_id_fkey`. Assertion 13 added to `rls_isolation.sql` and
  **proven meaningful**: run against the pre-migration schema it reported
  `sqlstate none`, i.e. the cross-tenant insert succeeded — the gap was real, not
  theoretical. `db:push` is blocked because the shared hosted DB holds two S-02
  migrations absent from this branch; the CLI's suggested
  `migration repair --status reverted` was deliberately NOT run, as it would mark
  another branch's applied migrations as reverted. Push after S-02 merges.
  Assertion 13 is gated on the constraint's existence so the suite stays green
  until then and starts enforcing automatically once it lands.

### F2 — Optimistic rollback restores a whole-layout snapshot, discarding other committed writes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/room/RoomLayoutManager.tsx:152-155,171
- **Detail**: `const previous = layout` captures the entire payload, and both `setLayout` calls use
  the object form rather than the functional form. Drag table A (PATCH in flight, snapshot P0),
  then drag table B (snapshot P1 = P0 + A's move); B's PATCH succeeds; A's PATCH then fails →
  `setLayout(P0)` → **B's move disappears from the UI even though it is committed in the DB**,
  under an error banner naming neither table. Nothing reconciles afterwards. Same class of bug if a
  dialog's `refetch()` lands between the drag and the failure — the newly created table vanishes.
- **Fix**: Use functional `setLayout` updates and revert only the affected table's two coordinates,
  captured before the optimistic write.
  - Strength: Removes the whole-snapshot blast radius; a failure then touches exactly the table
    that failed.
  - Tradeoff: None meaningful — a few lines in one function.
  - Confidence: HIGH — the bug follows directly from snapshot semantics.
  - Blind spot: None significant.
- **Decision**: FIXED — `persistPosition` now uses functional `setLayout` throughout, via a new
  `patchTablePosition(payload, tableId, position)` helper that rewrites exactly one table. The
  captured `before` holds only that table's two coordinates, so a failure can no longer touch any
  other table. Fixed together with F3 (same function).

### F3 — Per-table `AbortController` does not order the server writes; a stale position can win

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/room/RoomLayoutManager.tsx:159-170
- **Detail**: `abort()` closes the client connection; it does not cancel a request the Worker has
  already forwarded or that Postgres has begun. Drag table 5 to (500,100), then 40 ms later to
  (900,100): request 1 is aborted client-side but already in flight, and Postgres may commit
  UPDATE 1 after UPDATE 2. DB = (500,100), UI = (900,100), no error shown; the table jumps back on
  the next load. The abort branch returns silently with the comment "the newer drag's state is the
  current truth" — which is the wrong inference, and actively suppresses the only available signal.
- **Fix A ⭐ Recommended**: Let the server's answer win — drive `setLayout` from the `PATCH`
  response (it already returns the full row) instead of returning early on abort.
  - Strength: Makes the DB authoritative for the final position, so UI and DB cannot silently
    diverge; the endpoint already returns what is needed.
  - Tradeoff: A late response can visibly snap a table back — correct, but needs the reconcile to
    apply only when no newer drag is pending.
  - Confidence: MEDIUM — removes the divergence, but the interleaving still needs care.
  - Blind spot: Haven't measured how often two drags of one table land inside one round trip.
- **Fix B**: Serialise per table — keep a "latest desired position" plus the in-flight promise, and
  re-send the latest once the current request settles.
  - Strength: Guarantees the last write wins without depending on response timing.
  - Tradeoff: More state to hold; a slow connection queues rather than coalescing.
  - Confidence: HIGH — ordering is enforced client-side by construction.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A **plus Fix B's mechanism** — Fix A alone does not close the race.
  Making the server's answer authoritative is useless while `abort()` remains, because aborting is
  precisely what lets a superseded request commit last *and* discards the response that would have
  revealed it. So the `AbortController` map was replaced by a per-table promise chain
  (`positionQueue`): commit order now equals send order, and the `PATCH` response (the full row,
  post-clamp) is applied as the final state. The misleading "the newer drag's state is the current
  truth" comment is gone, replaced by an explanation of why neither snapshot-reverting nor aborting
  is safe here.

### F4 — Table numbering can mint values the app itself rejects

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: supabase/migrations/20260727120000_room_layout_tables.sql:155, src/lib/schemas/room.ts:34, src/components/room/RoomLayoutManager.tsx:80
- **Detail**: Two symptoms, one root cause — `max + n` numbering versus a hard cap of 999, with no
  DB check constraint. (a) Migration: a company holding `998, 999, 999` renumbers the duplicate to
  `1000`; that row can then never be saved through any UI path, because the activation toggle sends
  a full `PUT` with `number: 1000` → 400 "najwyżej trzy cyfry". Since tables can never be deleted,
  the row is permanently unmanageable. (b) No migration needed: with a table numbered 999 present,
  `nextFreeNumber` pre-fills the create dialog with `1000` → a guaranteed validation failure on a
  fresh "Dodaj stolik".
- **Fix**: Renumber and suggest the lowest *free* number ≤ 999 rather than `max + n` (numbers are
  never released, so `max + 1` only grows), and add `check (number between 1 and 999)` so the DB
  and zod agree.
  - Strength: Closes both symptoms and the schema/validation disagreement in one pass.
  - Tradeoff: The lowest-free scan is slightly more code than `max + 1`.
  - Confidence: HIGH — both failure paths are deterministic and easy to reproduce.
  - Blind spot: Haven't checked the live DB for companies near 999.
- **Decision**: FIXED — blind spot closed first: the live DB holds one company, 9 tables, numbers
  1–9, **zero above 999**, so the renumbering never fired and no data repair is needed. Then
  `MAX_TABLE_NUMBER = 999` was exported from `src/lib/schemas/room.ts` as the single source of
  truth (mirroring the `MAX_*_BYTES` convention in `schemas/menu.ts`) and consumed by the zod
  bound; `nextFreeNumber` now scans for the lowest FREE number ≤ ceiling instead of `max + 1`; and
  `check (number between 1 and 999)` was added to the pending migration `20260728120000`, so the
  DB and zod finally agree. The already-applied `20260727120000` renumbering was left untouched —
  editing an applied migration would be wrong, and it is a one-shot that cannot fire again.

### F5 — Activation toggle blind-overwrites position, number, label and shape

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/room/RoomLayoutManager.tsx:25-35,132-146
- **Detail**: `tableToInput` rebuilds the whole `PUT` body from client state, so a one-field change
  rewrites all seven columns. `/room` open in two tabs: tab 1 drags table 5 (persisted); tab 2,
  whose `layout` predates that drag, clicks the eye icon on table 5 → the `PUT` writes tab 2's
  stale `pos_x/pos_y` and silently undoes the drag. A rename made in the other tab reverts the
  same way. Internally inconsistent: the position hot path already got its own minimal `PATCH`
  for exactly this reason.
- **Fix**: Give activation its own minimal endpoint (`PATCH …/activation`), mirroring the position
  route, so a toggle touches only `is_active`.
  - Strength: Removes the lost-update window and makes the two single-field operations symmetric.
  - Tradeoff: A seventh route; or alternatively make `PUT` accept a partial body, which weakens
    the full-update contract.
  - Confidence: HIGH — the position route is a working precedent in the same slice.
  - Blind spot: None significant.
- **Decision**: FIXED — new `PATCH /api/room/tables/[id]/activation` with `tableActivationSchema`,
  mirroring the position route. `toggleActive` now sends only `is_active`, and `tableToInput` was
  deleted as dead code, which removes the whole class of blind full-body rewrites from the toggle
  path. Confirmed registered in the SSR build.

### F6 — `ON DELETE RESTRICT` makes company deletion structurally impossible

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260727120000_room_layout_tables.sql:93
- **Detail**: The migration header acknowledges the caveat but understates it. `RESTRICT` is checked
  *immediately*, before the statement's other referential actions, so `delete from companies` fires
  the `rooms` cascade and raises 23503 regardless of whether the `tables` cascade would have
  cleared the rows first — it is not merely "unspecified order". Combined with the deliberate
  absence of a delete policy on `tables`, an account-deletion path (GDPR) cannot be implemented
  without a superuser script.
- **Fix**: Change `on delete restrict` to `on delete no action`. `NO ACTION` still blocks a bare
  `delete from rooms`, but its check runs after the statement's other actions, so a company cascade
  succeeds.
- **Decision**: FIXED — folded into the same migration as F1 (they touch the same constraint):
  the new composite FK carries `on delete no action`. Same push blocker as F1.

### F7 — A table whose `room_id` does not resolve disappears from the UI

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/room/RoomLayoutManager.tsx:76
- **Detail**: `tablesInRoom` filters strictly on `table.room_id === activeRoom.id`, with no bucket
  for tables whose room is missing from `layout.rooms`. `MenuManager.tsx:66` handles the exactly
  analogous case on purpose, commented "so they never silently vanish". `GET /api/room` reads rooms
  and tables in a `Promise.all`, i.e. two snapshots, so a table moved into a room created between
  the two reads renders in no tab, is absent from the list, and cannot be reached at all. Also the
  visible symptom of F1.
- **Fix**: Mirror the menu fallback — render unresolvable tables in a "Bez sali" section with an
  edit action, so a row is always reachable.
- **Decision**: PENDING

### F8 — This slice widens the known anon cross-tenant read leak

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (tenant isolation)
- **Location**: supabase/migrations/20260727120000_room_layout_tables.sql:20-24,92-96
- **Detail**: `tables_anon_read_active using (is_active)` has no `company_id` predicate — the exact
  shape `context/foundation/lessons.md` forbids. The migration correctly adds no new anon policy and
  gives `rooms` none, so it does not violate the letter of the rule. But the four new columns attach
  to a row any holder of the public anon key can already read across **every** tenant, so the leaked
  surface grew from table number/label to include each restaurant's floor-plan geometry and zone
  linkage. Deferring a flat leak and deferring a growing one are different decisions.
- **Fix A ⭐ Recommended**: Keep the deferral, but record in the S-07 change that closing
  `tables_anon_read_active` is now blocking rather than optional, with this growth as the reason.
  - Strength: Honours the earlier decision while making sure the next slice cannot quietly defer it
    a second time; costs nothing now.
  - Tradeoff: The leak stays open until S-07 lands.
  - Confidence: HIGH — S-07 owns the QR token, which is the only sane scoping key.
  - Blind spot: No estimate of how exposed the dev project's anon key currently is.
- **Fix B**: Drop `tables_anon_read_active` now and let S-07 reintroduce a scoped path.
  - Strength: Closes the leak immediately at zero functional cost — no client path consumes anon
    table reads before S-08.
  - Tradeoff: Reverses a decision already taken deliberately; the anon assertion in
    `rls_isolation.sql` must invert.
  - Confidence: HIGH — nothing reads it today.
  - Blind spot: Haven't checked whether the unmerged S-02 migrations rely on it.
- **Decision**: PENDING

### F9 — `Room.sort_order` is a dead column that looks functional

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20260727120000_room_layout_tables.sql:39, src/pages/api/room/rooms.ts:20-24
- **Detail**: `GET /api/room` orders by `sort_order` then `name`, `Room` exposes it, the column
  exists — but nothing ever writes a non-zero value: `roomInputSchema` has no such field, `POST`
  does not set it, there is no reorder endpoint, and unlike `menu_categories` there is no
  `BEFORE INSERT` trigger to append at the end. Every room is `sort_order = 0`, so the tab strip is
  really alphabetical: an owner adding "Bar" sees it jump ahead of the seeded "Sala główna" with no
  way to influence order.
- **Fix**: Either add the same append-at-end trigger the menu uses, or drop the column and the
  `.order("sort_order")` until reordering actually exists.
- **Decision**: PENDING

### F10 — `RoomTabs` declares ARIA tabs semantics it does not implement

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/room/RoomTabs.tsx:22-42
- **Detail**: `role="tablist"` / `role="tab"` / `aria-selected` without `aria-controls`, without a
  `role="tabpanel"` on the content, and without arrow-key roving focus. A partial tabs
  implementation is worse for screen-reader users than plain buttons, because it promises an
  interaction model that is not there. No `ui/tabs` primitive exists in the repo, and the menu
  siblings use no ARIA roles at all — so this is not a case of bypassing an available component.
- **Fix**: Drop the roles and use `aria-pressed` on plain buttons, or add the Radix tabs primitive
  (`npx shadcn@latest add tabs`) and use it properly.
- **Decision**: PENDING

## Also noted, not raised as findings

- **Merge-collision surface with S-02 is larger than planned.** `middleware.ts` was meant to change
  append-only; the array entries were appended but the adjacent comment was rewrapped from 2 lines
  to 3, so the diff replaces 4 lines. Separately, `handle_new_user()` is replaced wholesale via
  `create or replace`, restating S-03's default categories — if S-02 also touches that trigger,
  whichever migration timestamp sorts last silently reverts the other's side effects with no error.
  Worth confirming S-02 leaves the trigger alone.
- **Helper duplication needs a tracked follow-up.** `guardTablesRequest`, `callRoomApi` and
  `useRoomLayout` are near-copies of their menu counterparts — deliberate and documented, to avoid
  conflicting with S-02. But it already produced a smell the rationale does not cover:
  `isUniqueViolation` lives in `api.ts` while `isForeignKeyViolation` lives in `room-api.ts`, so
  `rooms/[id].ts` imports PostgREST error-code helpers from two modules. Without a tracked
  follow-up after S-02 lands, this becomes permanent.
- **Duplicate-submit window after a failed refetch** (`RoomLayoutManager.tsx:111-130`): a write
  succeeds, `refetch` throws, the dialog stays open showing a save error, and a second "Zapisz"
  yields a 409 for a room that was in fact created. Inherited verbatim from `MenuManager.tsx:91-98`,
  so it is a pre-existing design to fix in both places, not a new divergence.
- **Click-vs-drag depends on macrotask ordering** (`RoomCanvas.tsx:57-59`): clearing `draggedIdRef`
  via `setTimeout(…, 0)` races the synthetic `click`. It works today, but nothing guarantees it
  across browsers; deriving the flag from the drag delta would be deterministic.
- **First-paint layout shift**: `scale` starts at 1, so the canvas renders 800 px tall before the
  first `ResizeObserver` callback, then snaps to ~570 px inside `max-w-5xl`.
- **`PATCH position` costs two round trips** on the endpoint whose comment claims "one drop, one
  minimal request" — correct as written, since the clamp must be footprint-aware and server-side,
  but the comment oversells it.
- **`busyTableId` is a single slot**: toggling A then B quickly re-enables B's button while its
  request is in flight, permitting a duplicate `PUT`. `Set<string>` would match `positionRequests`.
- Extras beyond the plan, all benign and justified: `isForeignKeyViolation`, `tables_room_id_idx`,
  the 80-char `label` cap, `nextFreeNumber`/`nextFreePosition`, `busyTableId`, the per-room table
  count badge, the `SELECT shape` before a position update, click-vs-drag disambiguation, and
  defensive fallbacks in `computeScale`/`applyDragDelta`.
