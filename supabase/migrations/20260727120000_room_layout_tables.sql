-- Room layout and tables (S-06): rooms (zones), table layout columns, table
-- number uniqueness per company, owner-only table writes.
--
-- Extends the minimal F-01 public.tables via ALTER (never re-CREATE), as that
-- migration's header instructs. room_id reaches NOT NULL in three steps inside
-- this one transaction: add nullable -> seed one default room per company ->
-- backfill -> SET NOT NULL. There is no window in which a table has no room.
--
-- The unique (company_id, number) index is preceded by a deterministic
-- renumbering of pre-existing collisions: F-01 shipped no uniqueness, so dev
-- data may already hold duplicates, and CREATE UNIQUE INDEX would abort the
-- whole migration on them.
--
-- There is deliberately NO delete policy on public.tables. RLS default-deny
-- makes hard-deleting a table impossible for every staff role, which enforces
-- the QR-permanence guardrail (FR-009; printed codes from S-07 must stay valid)
-- structurally rather than by application discipline. Deactivation via
-- is_active is the only lifecycle control.
--
-- tables_anon_read_active is deliberately left untouched: it still lacks a
-- company_id predicate (context/foundation/lessons.md, "Anon RLS reads must be
-- scoped by company_id"). Narrowing it needs the QR token that S-07 owns, so
-- the fix belongs to that slice. public.rooms gets NO anon policy at all, so
-- this migration does not widen the anon surface.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
-- Fixed footprint per shape; the pixel sizes live in src/lib/room-geometry.ts.
create type public.table_shape as enum ('square', 'circle', 'rectangle');

-- ---------------------------------------------------------------------------
-- Rooms (zones: main hall, terrace, ...)
-- ---------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index rooms_company_id_idx on public.rooms (company_id);
create unique index rooms_company_name_idx on public.rooms (company_id, lower(name));

alter table public.rooms enable row level security;

-- Staff read their own company's rooms; only the owner mutates them (PRD
-- Access Control: room layout is owner-only, like the menu).
create policy rooms_select_staff on public.rooms
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy rooms_insert_owner on public.rooms
  for insert
  to authenticated
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy rooms_update_owner on public.rooms
  for update
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner')
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy rooms_delete_owner on public.rooms
  for delete
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner');

-- No anon policy on rooms: the client QR path (S-08) resolves one table, never
-- a room list, so anon has no reason to enumerate zones.

-- ---------------------------------------------------------------------------
-- tables layout columns (ALTER only)
-- ---------------------------------------------------------------------------
-- room_id uses ON DELETE RESTRICT so a room holding tables cannot be deleted:
-- CASCADE here would destroy tables (and their permanent QR codes) as a side
-- effect of tidying up a zone. The API maps the resulting 23503 to a 409.
--
-- Caveat: deleting a COMPANY cascades to both rooms and tables, and the order
-- of those two cascades is unspecified, so a company delete can trip this
-- RESTRICT. Nothing in the MVP deletes a company (no policy, no endpoint); if
-- such a path is ever added it must delete tables before rooms.
--
-- pos_x / pos_y are in the logical 1200x800 canvas space (src/lib/room-geometry.ts),
-- not rendered pixels: the canvas scales that space to its container.
alter table public.tables
  add column room_id uuid references public.rooms (id) on delete restrict,
  add column pos_x int not null default 0,
  add column pos_y int not null default 0,
  add column shape public.table_shape not null default 'square';

-- ---------------------------------------------------------------------------
-- Default room: seed + backfill, then room_id NOT NULL
-- ---------------------------------------------------------------------------
-- Idempotent, and deliberately covering EVERY company (not just those with
-- tables), mirroring the default-categories backfill from S-03: dev and test
-- environments then match what a fresh registration produces.
insert into public.rooms (company_id, name, sort_order)
select c.id, 'Sala główna', 0
from public.companies c
where not exists (
  select 1 from public.rooms r where r.company_id = c.id
);

-- Every pre-existing table joins its company's first room (lowest sort_order,
-- oldest on ties) — after the seed above, every company has at least one.
update public.tables t
set room_id = first_room.id
from (
  select id,
         company_id,
         row_number() over (partition by company_id order by sort_order, created_at, id) as rn
  from public.rooms
) as first_room
where first_room.company_id = t.company_id
  and first_room.rn = 1
  and t.room_id is null;

alter table public.tables alter column room_id set not null;

-- ---------------------------------------------------------------------------
-- Table number uniqueness per company (FR-010: number is the primary
-- identifier of a table within the company)
-- ---------------------------------------------------------------------------
-- Renumber pre-existing collisions deterministically before the index exists.
-- Within each colliding (company_id, number) group the oldest row keeps the
-- number; every other row is pushed above the company's current maximum, in a
-- stable order. Offsets are unique per company, so the result cannot collide.
with ranked as (
  select id,
         company_id,
         number,
         row_number() over (partition by company_id, number order by created_at, id) as dup_rank
  from public.tables
),
losers as (
  select id,
         company_id,
         row_number() over (partition by company_id order by number, id) as offset_rank
  from ranked
  where dup_rank > 1
),
bounds as (
  select company_id, max(number) as max_number
  from public.tables
  group by company_id
)
update public.tables t
set number = bounds.max_number + losers.offset_rank
from losers
join bounds on bounds.company_id = losers.company_id
where t.id = losers.id;

create unique index tables_company_number_idx on public.tables (company_id, number);

create index tables_room_id_idx on public.tables (room_id);

-- ---------------------------------------------------------------------------
-- tables policy narrowing: staff read, owner-only writes, nobody deletes
-- (closes the debt deferred in F-01 "refined in S-03/S-05" for this table).
-- ---------------------------------------------------------------------------
drop policy tables_staff_all on public.tables;

create policy tables_select_staff on public.tables
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy tables_insert_owner on public.tables
  for insert
  to authenticated
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy tables_update_owner on public.tables
  for update
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner')
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

-- Intentionally NO tables_delete_owner: see the header note. Default-deny is
-- what keeps a printed QR code from ever pointing at a vanished row.

-- ---------------------------------------------------------------------------
-- Default room for new registrations: extend the trigger
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_company_id uuid;
begin
  if new.raw_user_meta_data ? 'company_name' then
    insert into public.companies (name)
      values (new.raw_user_meta_data ->> 'company_name')
      returning id into new_company_id;

    insert into public.profiles (user_id, company_id, role, full_name)
      values (new.id, new_company_id, 'owner', new.raw_user_meta_data ->> 'full_name');

    insert into public.menu_categories (company_id, name, sort_order)
      values
        (new_company_id, 'Przystawki', 1),
        (new_company_id, 'Dania główne', 2),
        (new_company_id, 'Desery', 3),
        (new_company_id, 'Napoje', 4);

    insert into public.rooms (company_id, name, sort_order)
      values (new_company_id, 'Sala główna', 0);
  end if;

  return new;
end;
$$;
