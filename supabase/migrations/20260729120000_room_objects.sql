-- Room furnishing objects (walls, chairs, doors, windows, bar, plant, stairs,
-- toilet, till) as a relation SEPARATE from public.tables.
--
-- Why a separate table rather than a `kind` column on tables — four differences,
-- the first of which is the whole point:
--
-- 1. DELETING IS ALLOWED. public.tables deliberately carries NO delete policy:
--    that is the structural form of the QR-permanence guardrail (a printed code
--    must never point at a vanished row, FR-009/FR-011), and is_active is the only
--    lifecycle control there. No QR code is ever pinned to a chair, so this table
--    gets room_objects_delete_owner and no is_active column — a second lifecycle
--    path would be redundant.
-- 2. No number. tables.number is the guest-visible identifier, unique per company
--    (FR-010). An object has nothing to identify.
-- 3. Own width/height instead of a fixed footprint per shape, because a wall is a
--    long thin rectangle and a chair is a small square.
-- 4. Free rotation, so bars and walls can sit at an angle.
--
-- This migration implements no FR: FR-008 covers tables only ("dodawać do niego
-- stoliki"). It is the furnishing follow-up parked in
-- context/changes/room-layout-tables/change.md.

create type public.room_object_kind as enum (
  'wall', 'chair', 'door', 'window', 'bar', 'plant', 'stairs', 'toilet', 'till'
);

create table public.room_objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  room_id uuid not null,
  kind public.room_object_kind not null,
  label text,
  -- CAUTION: unlike public.tables, pos_x/pos_y is the object's CENTRE, not its
  -- top-left corner. Objects rotate, and clamping a rotated rectangle by its
  -- corner yields legitimate NEGATIVE coordinates (a 400x20 wall turned 90° and
  -- pushed left has its centre at x = 10 but its unrotated corner at x = -190),
  -- which no sane bound could accept. Centre-anchored, the clamp always lands
  -- inside [0, 1200] x [0, 800] — the same range tables use. See
  -- src/lib/room-geometry.ts (clampObjectCenter).
  pos_x int not null default 0,
  pos_y int not null default 0,
  width int not null,
  height int not null,
  rotation int not null default 0,
  created_at timestamptz not null default now(),

  -- Mirrors OBJECT_SIZE_BOUNDS and the zod bounds in src/lib/schemas/room.ts.
  -- Duplicated into the schema on purpose: zod is shared client/server but is not
  -- the only route into this table (db query, a future import), and the F4 lesson
  -- from S-06 was precisely that an app-only ceiling lets unmanageable rows exist.
  constraint room_objects_pos_x_range check (pos_x between 0 and 1200),
  constraint room_objects_pos_y_range check (pos_y between 0 and 800),
  constraint room_objects_width_range check (width between 10 and 1200),
  constraint room_objects_height_range check (height between 10 and 800),
  -- 360 is the wrap point, not a value, so two numbers never mean one angle.
  constraint room_objects_rotation_range check (rotation between 0 and 359),

  -- Composite FK from the first day, not a single-column reference plus an
  -- application check. Learned from impl-review F1 on public.tables: FK validation
  -- runs BELOW RLS, so policies that only inspect company_id happily accept
  -- (company_id = A, room_id = <a room of B>), and the sole defence was
  -- roomExistsInCompany() in src/lib/room-api.ts — code, not an invariant. The
  -- target is rooms_company_id_id_key, added by 20260728120000.
  --
  -- ON DELETE CASCADE, unlike tables' NO ACTION: an object is disposable, so
  -- deleting a room takes its furnishing with it. The asymmetry is deliberate and
  -- produces the ordering we want — a room holding even one table still cannot be
  -- deleted (23503 -> 409), so objects can never be lost by accident; only a room
  -- already emptied of tables goes, and its walls go with it. CASCADE, like
  -- NO ACTION, is checked at the END of the statement, so deleting a company still
  -- succeeds (the F6 lesson about immediate RESTRICT).
  constraint room_objects_company_id_room_id_fkey
    foreign key (company_id, room_id)
    references public.rooms (company_id, id)
    on delete cascade
);

create index room_objects_company_id_idx on public.room_objects (company_id);
create index room_objects_room_id_idx on public.room_objects (room_id);
-- No unique index: objects have no number and duplicates are legitimate (a room
-- has many identical chairs).

alter table public.room_objects enable row level security;

-- Four per-operation policies, same shape as rooms_* in 20260727120000. No `to
-- anon` policy: the S-08 QR path resolves one table and never enumerates a room's
-- furnishing, and context/foundation/lessons.md forbids adding an anon SELECT that
-- is not scoped by company_id.
create policy room_objects_select_staff on public.room_objects
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy room_objects_insert_owner on public.room_objects
  for insert
  to authenticated
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy room_objects_update_owner on public.room_objects
  for update
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner')
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

-- The policy public.tables intentionally does NOT have. Deleting a chair breaks
-- nothing; deleting a table would invalidate a printed QR code forever.
create policy room_objects_delete_owner on public.room_objects
  for delete
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner');

-- public.handle_new_user() is deliberately NOT touched: new companies get no
-- default furnishing, and 20260728101449 warns that every create-or-replace of
-- that function must start from ITS body — S-02 rebased onto a stale ancestor and
-- silently dropped S-06's room seed. Nothing here needs the trigger.
