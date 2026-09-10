-- S-05 (menu-availability-toggle): the waiter availability-toggle write path,
-- promised by 20260708124756 ("S-05 will add the waiter availability-toggle
-- write path"). Two pieces, deliberately split:
--
--   1) an UPDATE policy admitting the waiter to menu_items rows of their own
--      company — RLS decides WHICH ROWS a role may touch, but it cannot
--      constrain WHICH COLUMNS change;
--   2) a BEFORE UPDATE trigger that enforces the PRD Access-Control invariant
--      ("Kelner … przełącza dostępność pozycji menu. Nie zmienia … menu."):
--      any non-owner UPDATE may change availability and NOTHING else.
--
-- kitchen gets no policy at all — no policy is the denial (same reasoning as
-- the dropped anon policies: an ungranted surface is a clean surface).

-- ---------------------------------------------------------------------------
-- 1) Waiter row admission. ORs with menu_items_update_owner; kitchen and anon
--    still match no UPDATE policy and are filtered out before the trigger runs.
-- ---------------------------------------------------------------------------
create policy menu_items_update_availability_waiter on public.menu_items
  for update
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'waiter')
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'waiter');

-- ---------------------------------------------------------------------------
-- 2) Column invariant. Row-comparison via to_jsonb minus the one permitted
--    key, so columns added by future migrations are covered automatically
--    instead of silently escaping an explicit list. current_staff_role() is
--    NULL for service_role / migrations (auth.uid() is null), and NULL <> 'owner'
--    is not true, so privileged writes (seeds, backfills) pass untouched.
--    menu_items has no auto-updated_at trigger, so an availability-only UPDATE
--    really does differ in exactly one key.
-- ---------------------------------------------------------------------------
create or replace function public.guard_menu_item_staff_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.current_staff_role() <> 'owner'
     and (to_jsonb(old) - 'availability') is distinct from (to_jsonb(new) - 'availability') then
    raise exception 'Personel może zmieniać wyłącznie dostępność pozycji menu';
  end if;
  return new;
end;
$$;

create trigger menu_items_guard_staff_columns
  before update on public.menu_items
  for each row
  execute function public.guard_menu_item_staff_columns();
