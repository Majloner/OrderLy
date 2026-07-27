-- RLS isolation test (F-01 guardrail, extended in S-03, S-04 and S-06). Seeds
-- two companies with owners, a waiter, rooms, tables, menu categories and menu
-- items, then asserts, per simulated JWT context, that staff see only their own
-- company, that menu writes are owner-only (waiter denied), that anonymous
-- callers read only visible rows (available/sold_out, non-archived) and cannot
-- write, that an orphan (profile-less) authenticated user sees nothing, that
-- menu-photos Storage writes are owner-only and scoped to the caller's company
-- prefix, and that room/table writes are owner-only while a table can be
-- deleted by NOBODY (S-06 QR-permanence guardrail). Everything runs inside a
-- transaction and is ROLLED BACK — no fixtures persist.
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
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'waiterA@test.local', now(), now());

insert into public.companies (id, name)
values
  ('a1111111-1111-1111-1111-111111111111', 'Firma A'),
  ('b2222222-2222-2222-2222-222222222222', 'Firma B');

insert into public.profiles (user_id, company_id, role, full_name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'owner', 'Owner A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-2222-2222-2222-222222222222', 'owner', 'Owner B'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'a1111111-1111-1111-1111-111111111111', 'waiter', 'Waiter A');

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
  if pr <> 2 then raise exception 'FAIL A.profiles: saw %, expected 2 (owner+waiter)', pr; end if;
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

rollback;

-- Rollback proof: fixtures gone.
select count(*) as companies_after_rollback from public.companies;
