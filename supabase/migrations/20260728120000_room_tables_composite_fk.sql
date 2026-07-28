-- Tenant-safe room reference + number ceiling for tables
-- (impl-review findings F1, F4, F6 — S-06).
--
-- F1 — cross-tenant room reference was possible.
-- tables_insert_owner / tables_update_owner validate only tables.company_id, and
-- FK validation on room_id runs BELOW RLS, so the database accepted
-- (company_id = A, room_id = <a room owned by B>). The only thing preventing it
-- was roomExistsInCompany() in src/lib/room-api.ts — application code, not an
-- invariant. Any future write path that forgot that call (a bulk import, an S-07
-- QR route, a PATCH that starts accepting room_id) would create a table in A
-- pointing at B's room; B would then get a permanent 409 "move the tables first"
-- on room deletion, for tables B can neither see (RLS) nor move. The composite FK
-- below moves the guarantee into the schema, where no code path can bypass it.
--
-- F6 — ON DELETE RESTRICT blocked company deletion.
-- RESTRICT is checked IMMEDIATELY, before the statement's other referential
-- actions, so `delete from companies` raised 23503 from the rooms cascade
-- regardless of whether the tables cascade would have cleared the rows first.
-- (The original migration's header blamed "unspecified cascade order" — that was
-- the wrong explanation.) NO ACTION blocks a bare `delete from rooms` exactly the
-- same way, with the same 23503 the API maps to 409, but is checked AFTER the
-- statement's other actions, so a company cascade now succeeds. That keeps an
-- account-deletion path implementable without a superuser script.

-- Referenceable target for the composite FK. rooms.id is already the primary key,
-- so this unique constraint adds nothing for lookups — it exists solely because a
-- foreign key must reference a uniquely-constrained column list.
alter table public.rooms
  add constraint rooms_company_id_id_key unique (company_id, id);

alter table public.tables
  drop constraint tables_room_id_fkey;

-- Both columns are NOT NULL, so the default MATCH SIMPLE semantics are equivalent
-- to MATCH FULL here: a table can only reference a room of its own company.
alter table public.tables
  add constraint tables_company_id_room_id_fkey
  foreign key (company_id, room_id)
  references public.rooms (company_id, id)
  on delete no action;

-- F4 — the DB permitted numbers the app rejects.
-- tableInputSchema caps `number` at 999 (MAX_TABLE_NUMBER) but nothing enforced it
-- in the database, so a row could exist that no UI path could save: the activation
-- toggle sends a full PUT, which would fail validation on `number` — and since a
-- table can never be deleted, that row would be permanently unmanageable. The
-- 20260727120000 renumbering (`max(number) + offset_rank`) was one way to mint such
-- a value; it did not fire on this project (no duplicates existed, verified), but
-- the ceiling belongs in the schema regardless.
alter table public.tables
  add constraint tables_number_range check (number between 1 and 999);
