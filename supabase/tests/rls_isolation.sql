-- RLS isolation test (F-01 guardrail). Seeds two companies with owners + menu
-- data, then asserts, per simulated JWT context, that staff see only their own
-- company, that anonymous callers read only published rows and cannot write,
-- and that an orphan (profile-less) authenticated user sees nothing. Everything
-- runs inside a transaction and is ROLLED BACK — no fixtures persist.
--
-- Assertions raise an exception on failure, which aborts the transaction and
-- makes `supabase db query` exit non-zero. A clean run ends with the rollback
-- proof row (companies_after_rollback = 0).
--
-- Run: npm run test:rls   (supabase db query --linked --file this)

begin;

-- --- Fixtures (seeded as the privileged role; bypasses RLS) -----------------
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerA@test.local', now(), now()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerB@test.local', now(), now());

insert into public.companies (id, name)
values
  ('a1111111-1111-1111-1111-111111111111', 'Firma A'),
  ('b2222222-2222-2222-2222-222222222222', 'Firma B');

insert into public.profiles (user_id, company_id, role, full_name)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a1111111-1111-1111-1111-111111111111', 'owner', 'Owner A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b2222222-2222-2222-2222-222222222222', 'owner', 'Owner B');

insert into public.tables (company_id, number, is_active)
values
  ('a1111111-1111-1111-1111-111111111111', 1, true),
  ('a1111111-1111-1111-1111-111111111111', 2, false),   -- A inactive
  ('b2222222-2222-2222-2222-222222222222', 1, true);    -- B active

insert into public.menu_items (company_id, name, price, is_available)
values
  ('a1111111-1111-1111-1111-111111111111', 'A-Pizza', 30.00, true),
  ('a1111111-1111-1111-1111-111111111111', 'A-SoldOut', 12.00, false), -- A unavailable
  ('b2222222-2222-2222-2222-222222222222', 'B-Pasta', 25.00, true);    -- B available

-- --- Assertion 1: owner A sees only company A -------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
do $$
declare co int; pr int; tb int; mi int; b_leak int;
begin
  select count(*) into co from public.companies;
  select count(*) into pr from public.profiles;
  select count(*) into tb from public.tables;
  select count(*) into mi from public.menu_items;
  select count(*) into b_leak from public.companies where id = 'b2222222-2222-2222-2222-222222222222';
  if co <> 1 then raise exception 'FAIL A.companies: saw %, expected 1', co; end if;
  if pr <> 1 then raise exception 'FAIL A.profiles: saw %, expected 1', pr; end if;
  if tb <> 2 then raise exception 'FAIL A.tables: saw %, expected 2 (own active+inactive)', tb; end if;
  if mi <> 2 then raise exception 'FAIL A.menu_items: saw %, expected 2 (own)', mi; end if;
  if b_leak <> 0 then raise exception 'FAIL A cross-tenant: owner A can see Firma B'; end if;
  raise notice 'OK owner A isolated to Firma A';
end $$;
reset role;

-- --- Assertion 2: owner B sees only company B -------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
do $$
declare co int; a_leak int;
begin
  select count(*) into co from public.companies;
  select count(*) into a_leak from public.companies where id = 'a1111111-1111-1111-1111-111111111111';
  if co <> 1 then raise exception 'FAIL B.companies: saw %, expected 1', co; end if;
  if a_leak <> 0 then raise exception 'FAIL B cross-tenant: owner B can see Firma A'; end if;
  raise notice 'OK owner B isolated to Firma B';
end $$;
reset role;

-- --- Assertion 3: anonymous reads only published rows, cannot write --------
set local role anon;
do $$
declare co int; tb int; mi int; leaked boolean := false;
begin
  select count(*) into co from public.companies;    -- both venues public
  select count(*) into tb from public.tables;       -- active only (2)
  select count(*) into mi from public.menu_items;   -- available only (2)
  if co <> 2 then raise exception 'FAIL anon.companies: saw %, expected 2', co; end if;
  if tb <> 2 then raise exception 'FAIL anon.tables: saw % active, expected 2', tb; end if;
  if mi <> 2 then raise exception 'FAIL anon.menu_items: saw % available, expected 2', mi; end if;
  begin
    insert into public.menu_items (company_id, name, price)
    values ('a1111111-1111-1111-1111-111111111111', 'Hacker', 0.01);
    leaked := true;
  exception when others then leaked := false;
  end;
  if leaked then raise exception 'FAIL anon write: INSERT succeeded (should be denied)'; end if;
  raise notice 'OK anon reads published only and cannot write';
end $$;
reset role;

-- --- Assertion 4: orphan authenticated user (no profile) sees nothing -------
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

rollback;

-- Rollback proof: fixtures gone.
select count(*) as companies_after_rollback from public.companies;
