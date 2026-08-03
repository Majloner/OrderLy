-- RLS isolation test (F-01 guardrail, extended in S-03, S-04, S-06 and S-02).
-- Seeds two companies with owners, a waiter, a deactivated staff member, rooms,
-- tables, menu categories and menu items, then asserts, per simulated JWT
-- context, that staff see only their own company, that menu writes are
-- owner-only (waiter denied), that anonymous callers read only visible rows
-- (available/sold_out, non-archived) and cannot write, that an orphan
-- (profile-less) authenticated user sees nothing, that menu-photos Storage
-- writes are owner-only and scoped to the caller's company prefix, that
-- room/table writes are owner-only while a table can be deleted by NOBODY
-- (S-06 QR-permanence guardrail), and — from S-02 — that staff provisioning is
-- owner-only and same-company, that nobody can mint a second owner or promote
-- themselves, that an owner cannot demote or deactivate itself, and that a
-- deactivated account is denied everywhere — and, from staff-login-identifiers,
-- that a staff login is unique within a venue but free to repeat across venues,
-- while an email may repeat or be absent. Everything runs inside a transaction
-- and is ROLLED BACK — no fixtures persist.
--
-- Assertions raise an exception on failure, which aborts the transaction and
-- makes `supabase db query` exit non-zero. A clean run ends with the rollback
-- proof row (companies_after_rollback = count of pre-existing real companies;
-- fixture companies must be gone).
--
-- Run: npm run test:rls   (supabase db query --linked --file this)

begin;

-- --- Fixtures (seeded as the privileged role; bypasses RLS) -----------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerA@test.local', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerB@test.local', now(), now()),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'waiterA@test.local', now(), now()),
  -- S-02: a deactivated staff member of company A, and two profile-less users
  -- the provisioning assertions insert profiles for (profiles.user_id is FK'd
  -- to auth.users, so the auth row must exist before an authenticated INSERT).
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'goneA@test.local', now(), now()),
  ('f1111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'newstaffA@test.local', now(), now()),
  ('f2222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'denied@test.local', now(), now()),
  -- staff-login: four profile-less users for the per-venue login assertions.
  ('f3333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'annaA@test.local', now(), now()),
  ('f4444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'annaB@test.local', now(), now()),
  ('f5555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dup@test.local', now(), now()),
  ('f6666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noemail@test.local', now(), now());

-- companies.code is NOT NULL and unique (staff-login migration). Fixed
-- fixture codes rather than generated ones, so failures name a stable value.
-- Both are drawn from the generator's alphabet, which excludes 0/O/1/I/L.
insert into public.companies (id, name, code)
values
  ('a1111111-1111-1111-1111-111111111111', 'Firma A', 'AAAAAA'),
  ('b2222222-2222-2222-2222-222222222222', 'Firma B', 'BBBBBB');

-- profiles.email is now OPTIONAL contact data (staff-login migration); the login
-- is the staff credential and is null for owners, who authenticate by email.
insert into public.profiles (user_id, company_id, role, full_name, email, login, deactivated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'owner', 'Owner A', 'ownerA@test.local', null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-2222-2222-2222-222222222222', 'owner', 'Owner B', 'ownerB@test.local', null, null),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'a1111111-1111-1111-1111-111111111111', 'waiter', 'Waiter A', 'waiterA@test.local', 'waiter-a', null),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a1111111-1111-1111-1111-111111111111', 'kitchen', 'Gone A', 'goneA@test.local', 'gone-a', now());

-- S-06: tables.room_id is NOT NULL, so rooms must be seeded first.
insert into public.rooms (id, company_id, name, sort_order)
values
  ('f0a11111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Sala-A1', 0),
  ('f0b22222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'Sala-B1', 0);

insert into public.tables (company_id, room_id, number, is_active)
values
  ('a1111111-1111-1111-1111-111111111111', 'f0a11111-1111-1111-1111-111111111111', 1, true),
  ('a1111111-1111-1111-1111-111111111111', 'f0a11111-1111-1111-1111-111111111111', 2, false),   -- A inactive
  ('b2222222-2222-2222-2222-222222222222', 'f0b22222-2222-2222-2222-222222222222', 1, true);    -- B active

insert into public.menu_categories (id, company_id, name, sort_order)
values
  ('ca111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'Kat-A1', 1),
  ('cb222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'Kat-B1', 1);

insert into public.menu_items (company_id, name, price, availability, category_id, archived_at)
values
  ('a1111111-1111-1111-1111-111111111111', 'A-Pizza',    30.00, 'available',   'ca111111-1111-1111-1111-111111111111', null),
  ('a1111111-1111-1111-1111-111111111111', 'A-SoldOut',  12.00, 'sold_out',    null, null),        -- anon: visible
  ('a1111111-1111-1111-1111-111111111111', 'A-Hidden',    9.00, 'unavailable', null, null),        -- anon: hidden
  ('a1111111-1111-1111-1111-111111111111', 'A-Archived', 15.00, 'available',   null, now()),       -- anon: hidden (archived)
  ('b2222222-2222-2222-2222-222222222222', 'B-Pasta',    25.00, 'available',   'cb222222-2222-2222-2222-222222222222', null);

-- --- Assertion 1: owner A sees only company A -------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare co int; pr int; tb int; mi int; mc int; rm int; b_leak int;
begin
  select count(*) into co from public.companies;
  select count(*) into pr from public.profiles;
  select count(*) into tb from public.tables;
  select count(*) into mi from public.menu_items;
  select count(*) into mc from public.menu_categories;
  select count(*) into rm from public.rooms;
  select count(*) into b_leak from public.companies where id = 'b2222222-2222-2222-2222-222222222222';
  if co <> 1 then raise exception 'FAIL A.companies: saw %, expected 1', co; end if;
  -- Deactivated staff stay visible to their own company: profiles_select_same_company
  -- filters on the CALLER's company, not the row's state, which is what makes
  -- the reactivate flow possible without a second policy.
  if pr <> 3 then raise exception 'FAIL A.profiles: saw %, expected 3 (owner+waiter+deactivated)', pr; end if;
  if tb <> 2 then raise exception 'FAIL A.tables: saw %, expected 2 (own active+inactive)', tb; end if;
  if rm <> 1 then raise exception 'FAIL A.rooms: saw %, expected 1 (own)', rm; end if;
  if mi <> 4 then raise exception 'FAIL A.menu_items: saw %, expected 4 (own, incl. archived)', mi; end if;
  if mc <> 1 then raise exception 'FAIL A.menu_categories: saw %, expected 1 (own)', mc; end if;
  if b_leak <> 0 then raise exception 'FAIL A cross-tenant: owner A can see Firma B'; end if;
  raise notice 'OK owner A isolated to Firma A';
end $$;
reset role;

-- --- Assertion 2: owner B sees only company B -------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare co int; mc int; a_leak int;
begin
  select count(*) into co from public.companies;
  select count(*) into mc from public.menu_categories;
  select count(*) into a_leak from public.companies where id = 'a1111111-1111-1111-1111-111111111111';
  if co <> 1 then raise exception 'FAIL B.companies: saw %, expected 1', co; end if;
  if mc <> 1 then raise exception 'FAIL B.menu_categories: saw %, expected 1 (own)', mc; end if;
  if a_leak <> 0 then raise exception 'FAIL B cross-tenant: owner B can see Firma A'; end if;
  raise notice 'OK owner B isolated to Firma B';
end $$;
reset role;

-- --- Assertion 3: owner A CAN write menu (owner-only write policies) --------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int;
begin
  update public.menu_items set description = 'edited by owner' where name = 'A-Pizza';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner write: UPDATE affected % rows, expected 1', n; end if;

  insert into public.menu_categories (company_id, name, sort_order)
    values ('a1111111-1111-1111-1111-111111111111', 'Kat-A-New', 9);
  delete from public.menu_categories where name = 'Kat-A-New';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner write: category DELETE affected % rows, expected 1', n; end if;
  raise notice 'OK owner A can write menu items and categories';
end $$;
reset role;

-- --- Assertion 4: waiter A can read but NOT write menu ----------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
do $$
declare mi int; n int; leaked boolean := false;
begin
  select count(*) into mi from public.menu_items;
  if mi <> 4 then raise exception 'FAIL waiter read: saw % items, expected 4', mi; end if;

  begin
    insert into public.menu_items (company_id, name, price)
    values ('a1111111-1111-1111-1111-111111111111', 'Waiter-Item', 1.00);
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL waiter write: menu_items INSERT succeeded (should be denied)'; end if;

  update public.menu_items set description = 'edited by waiter' where name = 'A-Pizza';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL waiter write: UPDATE affected % rows, expected 0', n; end if;

  delete from public.menu_items where name = 'A-Pizza';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL waiter write: DELETE affected % rows, expected 0', n; end if;

  begin
    insert into public.menu_categories (company_id, name, sort_order)
    values ('a1111111-1111-1111-1111-111111111111', 'Waiter-Cat', 9);
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL waiter write: menu_categories INSERT succeeded (should be denied)'; end if;
  raise notice 'OK waiter A reads menu but cannot write it';
end $$;
reset role;

-- --- Assertion 5: anonymous reads only visible rows, cannot write -----------
set local role anon;
do $$
-- Counts are scoped to the two fixture companies: the hosted DB may hold real
-- (dev) companies whose rows are also anon-visible; absolute counts would be
-- brittle against that pre-existing data.
declare co int; tb int; mi int; mc int; rm int; hidden int; leaked boolean := false;
begin
  select count(*) into co from public.companies
    where id in ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222');
  select count(*) into tb from public.tables            -- active only (2)
    where company_id in ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222');
  select count(*) into rm from public.rooms             -- no anon policy at all (0)
    where company_id in ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222');
  select count(*) into mi from public.menu_items        -- available+sold_out, non-archived (3)
    where company_id in ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222');
  select count(*) into mc from public.menu_categories   -- categories are public (2)
    where company_id in ('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222');
  select count(*) into hidden from public.menu_items where name in ('A-Hidden', 'A-Archived');
  if co <> 2 then raise exception 'FAIL anon.companies: saw %, expected 2', co; end if;
  if tb <> 2 then raise exception 'FAIL anon.tables: saw % active, expected 2', tb; end if;
  if mi <> 3 then raise exception 'FAIL anon.menu_items: saw %, expected 3 (available+sold_out, non-archived)', mi; end if;
  if mc <> 2 then raise exception 'FAIL anon.menu_categories: saw %, expected 2', mc; end if;
  if rm <> 0 then raise exception 'FAIL anon.rooms: saw %, expected 0 (no anon policy)', rm; end if;
  if hidden <> 0 then raise exception 'FAIL anon leak: unavailable/archived item visible'; end if;
  begin
    insert into public.menu_items (company_id, name, price)
    values ('a1111111-1111-1111-1111-111111111111', 'Hacker', 0.01);
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL anon write: INSERT succeeded (should be denied)'; end if;
  raise notice 'OK anon reads visible only and cannot write';
end $$;
reset role;

-- --- Assertion 6: orphan authenticated user (no profile) sees nothing -------
set local role authenticated;
set local request.jwt.claims = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';
do $$
declare co int;
begin
  select count(*) into co from public.companies;
  if co <> 0 then raise exception 'FAIL orphan: profile-less user saw % companies, expected 0', co; end if;
  raise notice 'OK orphan authenticated user sees nothing (default-deny)';
end $$;
reset role;

-- --- Assertion 7: Storage menu-photos writes are owner-only + company-scoped --
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int; leaked boolean := false;
begin
  -- owner A can write under own company prefix
  insert into storage.objects (bucket_id, name)
    values ('menu-photos', 'a1111111-1111-1111-1111-111111111111/itemx/full.webp');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL storage owner write: INSERT affected %, expected 1', n; end if;

  -- owner A cannot write under company B prefix (FK-bypass would break tenancy)
  begin
    insert into storage.objects (bucket_id, name)
      values ('menu-photos', 'b2222222-2222-2222-2222-222222222222/itemy/full.webp');
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL storage cross-tenant: owner A wrote under Firma B prefix'; end if;
  raise notice 'OK owner A writes menu-photos only under own company prefix';
end $$;
reset role;

-- --- Assertion 8: waiter cannot write Storage menu-photos ------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
do $$
declare leaked boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
      values ('menu-photos', 'a1111111-1111-1111-1111-111111111111/itemz/full.webp');
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL storage waiter write: INSERT succeeded (should be denied)'; end if;
  raise notice 'OK waiter A cannot write menu-photos';
end $$;
reset role;
-- Note: waiter DELETE denial is not asserted via SQL — storage.protect_delete()
-- blocks direct DELETE from storage.objects for ALL roles (deletes go through
-- the Storage API, where the owner-only DELETE policy mirrors INSERT, above).

-- --- Assertion 9 (S-06): owner A writes rooms/tables but CANNOT delete a table --
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int; new_table_id uuid;
begin
  -- an empty room can be created and removed
  insert into public.rooms (company_id, name, sort_order)
    values ('a1111111-1111-1111-1111-111111111111', 'Sala-A-New', 9);
  delete from public.rooms where name = 'Sala-A-New';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner rooms: empty-room DELETE affected % rows, expected 1', n; end if;

  insert into public.tables (company_id, room_id, number, label, shape, pos_x, pos_y)
    values ('a1111111-1111-1111-1111-111111111111', 'f0a11111-1111-1111-1111-111111111111',
            3, 'Przy oknie', 'circle', 100, 200)
    returning id into new_table_id;

  update public.tables set pos_x = 300, pos_y = 400, is_active = false where id = new_table_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner tables: UPDATE affected % rows, expected 1', n; end if;

  -- ...but NOBODY deletes a table: there is no delete policy, so the row is
  -- filtered out and row_count is 0 even for the owner (QR-permanence guardrail).
  delete from public.tables where id = new_table_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL table delete: owner DELETE affected % rows, expected 0 (no delete policy)', n; end if;
  raise notice 'OK owner A writes rooms and tables, and no role can delete a table';
end $$;
reset role;

-- --- Assertion 10 (S-06): waiter A reads rooms/tables but cannot write them ---
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
do $$
-- Reads are asserted against the fixture rows by number/company rather than by
-- absolute count, so assertion 9's leftover table cannot make this brittle.
declare tb int; rm int; n int; leaked boolean := false;
begin
  select count(*) into tb from public.tables where number in (1, 2);
  if tb <> 2 then raise exception 'FAIL waiter read tables: saw %, expected 2', tb; end if;
  select count(*) into rm from public.rooms;
  if rm <> 1 then raise exception 'FAIL waiter read rooms: saw %, expected 1 (own)', rm; end if;

  begin
    insert into public.tables (company_id, room_id, number)
    values ('a1111111-1111-1111-1111-111111111111', 'f0a11111-1111-1111-1111-111111111111', 90);
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL waiter write: tables INSERT succeeded (should be denied)'; end if;

  update public.tables set pos_x = 999 where number = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL waiter write: tables UPDATE affected % rows, expected 0', n; end if;

  begin
    insert into public.rooms (company_id, name)
    values ('a1111111-1111-1111-1111-111111111111', 'Sala-Waiter');
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL waiter write: rooms INSERT succeeded (should be denied)'; end if;

  delete from public.rooms where id = 'f0a11111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL waiter write: rooms DELETE affected % rows, expected 0', n; end if;
  raise notice 'OK waiter A reads rooms and tables but cannot write them';
end $$;
reset role;

-- --- Assertion 11 (S-06): number uniqueness + non-empty room cannot be deleted --
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare state text;
begin
  -- FR-010: number is the primary identifier within the company. (A#1 and B#1
  -- coexisting in the fixtures already proves the scope is per company.)
  begin
    insert into public.tables (company_id, room_id, number)
      values ('a1111111-1111-1111-1111-111111111111', 'f0a11111-1111-1111-1111-111111111111', 1);
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '23505' then raise exception 'FAIL table number uniqueness: sqlstate %, expected 23505', state; end if;

  -- ON DELETE RESTRICT: tidying up a zone must not destroy its tables.
  begin
    delete from public.rooms where id = 'f0a11111-1111-1111-1111-111111111111';
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '23503' then raise exception 'FAIL room delete restrict: sqlstate %, expected 23503', state; end if;
  raise notice 'OK table number unique per company; non-empty room cannot be deleted';
end $$;
reset role;

-- --- Assertion 12 (S-06): owner A cannot reach Firma B rooms/tables ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare rm_b int; n int; leaked boolean := false;
begin
  select count(*) into rm_b from public.rooms where company_id = 'b2222222-2222-2222-2222-222222222222';
  if rm_b <> 0 then raise exception 'FAIL A cross-tenant rooms: owner A sees % rooms of Firma B', rm_b; end if;

  begin
    insert into public.tables (company_id, room_id, number)
      values ('b2222222-2222-2222-2222-222222222222', 'f0b22222-2222-2222-2222-222222222222', 50);
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL A cross-tenant: owner A inserted a table into Firma B'; end if;

  begin
    insert into public.rooms (company_id, name)
      values ('b2222222-2222-2222-2222-222222222222', 'Sala-Hack');
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL A cross-tenant: owner A inserted a room into Firma B'; end if;

  update public.tables set pos_x = 1 where company_id = 'b2222222-2222-2222-2222-222222222222';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL A cross-tenant: owner A updated % Firma B tables, expected 0', n; end if;
  raise notice 'OK owner A cannot read or write Firma B rooms and tables';
end $$;
reset role;

-- --- Assertion 13 (S-02): owner A provisions staff, but only into own company --
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int; state text;
begin
  insert into public.profiles (user_id, company_id, role, full_name, email)
    values ('f1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'waiter', 'New Staff A', 'newstaffA@test.local');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner provision: INSERT affected %, expected 1', n; end if;

  -- ...not into company B (the whole point of the three-term with-check).
  -- Asserted on SQLSTATE rather than `when others`, and with a distinct email
  -- per attempt: otherwise a 23505 from profiles_company_email_idx would look
  -- exactly like the RLS denial these blocks claim to prove.
  begin
    insert into public.profiles (user_id, company_id, role, full_name, email)
      values ('f2222222-2222-2222-2222-222222222222', 'b2222222-2222-2222-2222-222222222222', 'waiter', 'Cross Tenant', 'crosstenant@test.local');
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '42501' then
    raise exception 'FAIL owner provision cross-tenant: sqlstate %, expected 42501 (RLS denial)', state;
  end if;

  -- ...and never a second owner
  begin
    insert into public.profiles (user_id, company_id, role, full_name, email)
      values ('f2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'owner', 'Second Owner', 'secondowner@test.local');
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '42501' then
    raise exception 'FAIL owner provision second owner: sqlstate %, expected 42501 (RLS denial)', state;
  end if;
  raise notice 'OK owner A provisions staff only into own company, never as owner';
end $$;
reset role;

-- --- Assertion 13b (S-02): owner cannot promote an existing waiter to owner --
-- The UPDATE path to a second owner. profiles_update_owner's WITH CHECK does
-- not constrain `role`, so the trigger's promotion branch is the ONLY thing
-- stopping this — assertion 13 covers the INSERT path only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare state text;
begin
  begin
    update public.profiles set role = 'owner' where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '42501' then
    raise exception 'FAIL owner promotion: sqlstate %, expected 42501 (trigger denial)', state;
  end if;
  raise notice 'OK owner A cannot promote a waiter to owner';
end $$;
reset role;

-- --- Assertion 14 (S-02): waiter A cannot provision or promote itself --------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
do $$
declare n int; leaked boolean := false;
begin
  begin
    insert into public.profiles (user_id, company_id, role, full_name, email)
      values ('f2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111', 'waiter', 'Self Provisioned', 'denied@test.local');
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL waiter provision: INSERT succeeded (should be denied)'; end if;

  -- UPDATE is owner-only, so this is silently filtered rather than rejected
  update public.profiles set role = 'owner' where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL waiter self-promotion: UPDATE affected % rows, expected 0', n; end if;
  raise notice 'OK waiter A cannot provision staff or promote itself';
end $$;
reset role;

-- --- Assertion 15 (S-02): owner A cannot demote or deactivate itself ---------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int; leaked boolean := false;
begin
  begin
    update public.profiles set role = 'waiter' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL owner self-demotion: UPDATE succeeded (would orphan the tenant)'; end if;

  begin
    update public.profiles set deactivated_at = now() where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL owner self-deactivation: UPDATE succeeded'; end if;

  -- ...but the guard must not over-block: renaming yourself is fine
  update public.profiles set full_name = 'Owner A Renamed' where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner self-rename: UPDATE affected % rows, expected 1', n; end if;
  raise notice 'OK owner A cannot demote/deactivate itself but can rename itself';
end $$;
reset role;

-- --- Assertion 16 (S-02): owner A can deactivate and reactivate staff --------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int;
begin
  update public.profiles set deactivated_at = now() where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL deactivate: UPDATE affected % rows, expected 1', n; end if;

  update public.profiles set deactivated_at = null where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL reactivate: UPDATE affected % rows, expected 1', n; end if;
  raise notice 'OK owner A can deactivate and reactivate staff';
end $$;
reset role;

-- --- Assertion 17 (S-02): a deactivated staff member sees nothing ------------
-- Both resolvers return NULL for them, so every policy in the schema
-- default-denies — same shape as the orphan-user assertion above, but reached
-- through deactivation rather than a missing profile. This is what makes the
-- flag meaningful on tables later slices have not built yet.
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';
do $$
declare co int; pr int; mi int; tb int; n int;
begin
  select count(*) into co from public.companies;
  select count(*) into pr from public.profiles;
  select count(*) into mi from public.menu_items;
  select count(*) into tb from public.tables;
  if co <> 0 then raise exception 'FAIL deactivated: saw % companies, expected 0', co; end if;
  if pr <> 0 then raise exception 'FAIL deactivated: saw % profiles, expected 0 (not even own)', pr; end if;
  if mi <> 0 then raise exception 'FAIL deactivated: saw % menu_items, expected 0', mi; end if;
  if tb <> 0 then raise exception 'FAIL deactivated: saw % tables, expected 0', tb; end if;

  -- and cannot reactivate itself back in
  update public.profiles set deactivated_at = null where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL deactivated self-reactivation: UPDATE affected % rows, expected 0', n; end if;
  raise notice 'OK deactivated staff member sees nothing and cannot reactivate itself';
end $$;
reset role;

-- --- Assertion 18 (S-02): profiles DELETE is owner-only and never self -------
set local role authenticated;
set local request.jwt.claims = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';
do $$
declare n int;
begin
  delete from public.profiles where user_id = 'f1111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL waiter delete: DELETE affected % rows, expected 0', n; end if;
  raise notice 'OK waiter A cannot delete profiles';
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int;
begin
  delete from public.profiles where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL owner self-delete: DELETE affected % rows, expected 0', n; end if;

  delete from public.profiles where user_id = 'f1111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL owner delete: DELETE affected % rows, expected 1', n; end if;
  raise notice 'OK owner A deletes same-company staff but not itself';
end $$;
reset role;

-- --- Assertion 19 (S-02): handle_new_user() seeds the FULL tenant bootstrap --
-- Runs as the privileged role (no `set local role`): handle_new_user is
-- SECURITY DEFINER and fires on the auth.users insert, so this exercises the
-- real registration path rather than simulating it.
--
-- Why this exists: three slices have now done `create or replace` on this one
-- shared function (S-01 -> S-03 categories -> S-06 room -> S-02 email), and
-- S-02 rebased onto a stale ancestor and silently dropped S-06's room insert.
-- Nothing caught it, because every other fixture here seeds rooms by hand.
-- Assert all four inserts together so the next replace cannot lose one quietly.
do $$
declare
  boot_user_id uuid := '0bbbbbbb-0000-4000-8000-000000000001';
  co uuid;
  em text;
  ro public.staff_role;
  mc int;
  rm int;
  vc text;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at, raw_user_meta_data)
  values (boot_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'bootstrap@test.local', now(), now(),
          '{"company_name":"Firma Bootstrap","full_name":"Boot Owner"}'::jsonb);

  select p.company_id, p.email, p.role into co, em, ro
  from public.profiles p
  where p.user_id = boot_user_id;

  if co is null then raise exception 'FAIL bootstrap: handle_new_user created no profile'; end if;
  if ro <> 'owner' then raise exception 'FAIL bootstrap: profile role %, expected owner', ro; end if;
  if em <> 'bootstrap@test.local' then
    raise exception 'FAIL bootstrap: profile email %, expected the auth email (S-02)', em;
  end if;

  select count(*) into mc from public.menu_categories where company_id = co;
  if mc <> 4 then raise exception 'FAIL bootstrap: % default categories, expected 4 (S-03)', mc; end if;

  select count(*) into rm from public.rooms where company_id = co;
  if rm <> 1 then raise exception 'FAIL bootstrap: % default rooms, expected 1 (S-06)', rm; end if;

  select c.code into vc from public.companies c where c.id = co;
  if vc is null or length(vc) <> 6 then
    raise exception 'FAIL bootstrap: venue code %, expected 6 characters (staff-login)', coalesce(vc, 'NULL');
  end if;
  if vc ~ '[01OIL]' then
    raise exception 'FAIL bootstrap: venue code % contains an ambiguous character', vc;
  end if;

  raise notice 'OK handle_new_user seeds company + owner profile + 4 categories + 1 room + venue code';
end $$;

-- --- Assertion 20 (S-06, impl-review F1): own company_id + FOREIGN room_id ----
-- Numbered 20 on merge: S-02 had already claimed 13-19 on its branch.
-- The case RLS alone PERMITS: the policies only check tables.company_id, and FK
-- validation runs below RLS, so before the composite FK this insert succeeded and
-- left Firma B unable to delete a room holding tables it could not even see.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
-- Gated on the constraint's existence: migration 20260728120000 cannot be pushed
-- until the S-02 branch merges (the shared hosted DB holds S-02 migrations absent
-- from this branch, so `supabase db push` refuses). Without the gate this
-- assertion would fail the whole suite until then, training everyone to ignore a
-- red test:rls and hiding the other twelve assertions. It starts enforcing by
-- itself the moment the migration lands — no further edit needed.
do $$
declare state text; has_fk boolean;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.tables'::regclass
      and conname = 'tables_company_id_room_id_fkey'
  ) into has_fk;

  if not has_fk then
    raise notice 'SKIP cross-tenant room_id: migration 20260728120000 not applied yet (impl-review F1)';
    return;
  end if;

  begin
    insert into public.tables (company_id, room_id, number)
      values ('a1111111-1111-1111-1111-111111111111', 'f0b22222-2222-2222-2222-222222222222', 77);
    state := 'none';
  exception when others then state := sqlstate;
  end;
  -- 23503: the composite FK (company_id, room_id) -> rooms (company_id, id) has
  -- no matching row, because that room belongs to Firma B.
  if state <> '23503' then
    raise exception 'FAIL cross-tenant room_id: sqlstate %, expected 23503 (composite FK)', state;
  end if;
  raise notice 'OK a table cannot reference another company''s room';
end $$;
reset role;

-- --- Assertion 21 (staff-login): login unique per venue, email free-form ------
-- The whole point of the change: within one venue a login is taken exactly
-- once, while an email may repeat or be absent entirely.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare n int; state text;
begin
  insert into public.profiles (user_id, company_id, role, full_name, email, login)
    values ('f3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111',
            'waiter', 'Anna A', 'anna@lokal.pl', 'anna');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL login insert: affected %, expected 1', n; end if;

  -- the same login twice in ONE venue is rejected by profiles_company_login_idx
  begin
    insert into public.profiles (user_id, company_id, role, full_name, email, login)
      values ('f5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
              'waiter', 'Anna Duplikat', 'dup@lokal.pl', 'anna');
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '23505' then
    raise exception 'FAIL duplicate login in one venue: sqlstate %, expected 23505', state;
  end if;

  -- ...and case-insensitively, because the index is on lower(login)
  begin
    insert into public.profiles (user_id, company_id, role, full_name, email, login)
      values ('f5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
              'waiter', 'Anna Wielka', 'dup@lokal.pl', 'ANNA');
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '23505' then
    raise exception 'FAIL duplicate login differing only in case: sqlstate %, expected 23505', state;
  end if;

  -- the SAME email on a second staff member is now fine (the per-company unique
  -- index this migration dropped used to make this a 23505)
  insert into public.profiles (user_id, company_id, role, full_name, email, login)
    values ('f5555555-5555-5555-5555-555555555555', 'a1111111-1111-1111-1111-111111111111',
            'waiter', 'Anna Druga', 'anna@lokal.pl', 'anna2');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL repeated email: affected %, expected 1', n; end if;

  -- ...and no email at all is fine too
  insert into public.profiles (user_id, company_id, role, full_name, email, login)
    values ('f6666666-6666-6666-6666-666666666666', 'a1111111-1111-1111-1111-111111111111',
            'kitchen', 'Bez Maila', null, 'anna3');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL null email: affected %, expected 1', n; end if;

  raise notice 'OK login unique per venue; email may repeat or be absent';
end $$;
reset role;

-- --- Assertion 22 (staff-login): the same login in a DIFFERENT venue ---------
-- The core claim of this change, and the thing the global auth.users email
-- uniqueness made impossible before.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare n int;
begin
  insert into public.profiles (user_id, company_id, role, full_name, email, login)
    values ('f4444444-4444-4444-4444-444444444444', 'b2222222-2222-2222-2222-222222222222',
            'waiter', 'Anna B', null, 'anna');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL same login in another venue: affected %, expected 1', n; end if;
  raise notice 'OK the login "anna" exists independently in Firma A and Firma B';
end $$;
reset role;

-- --- Assertion 23 (impl-review F2): the venue code is immutable --------------
-- Staff auth addresses are derived from the code and never stored, so changing
-- it would permanently lock every staff account out of that venue. The comments
-- claimed immutability long before anything enforced it; this pins it down.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare state text; n int;
begin
  begin
    update public.companies set code = 'ZZZZZZ' where id = 'a1111111-1111-1111-1111-111111111111';
    state := 'none';
  exception when others then state := sqlstate;
  end;
  if state <> '42501' then
    raise exception 'FAIL venue code immutability: sqlstate %, expected 42501', state;
  end if;

  -- ...but the rest of the company profile is still editable (FR-002), so the
  -- trigger must not over-block.
  update public.companies set name = 'Firma A Nowa' where id = 'a1111111-1111-1111-1111-111111111111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL company rename: UPDATE affected % rows, expected 1', n; end if;

  raise notice 'OK venue code is immutable while the rest of the profile stays editable';
end $$;
reset role;

rollback;

-- Rollback proof: fixtures gone.
select count(*) as companies_after_rollback from public.companies;
