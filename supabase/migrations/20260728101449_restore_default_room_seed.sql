-- Fix (impl-review F1): restore the default-room seed that S-02 dropped.
--
-- 20260727120000_room_layout_tables.sql (S-06) extended handle_new_user() to
-- seed a default room. 20260727220415_staff_accounts_roles.sql (S-02) then
-- replaced the function with the body from 20260708124756 plus `email` — it
-- rebased onto the wrong ancestor and silently lost the rooms insert. Because
-- S-02 sorts later, the deployed function stopped creating rooms.
--
-- Impact this repairs: public.tables.room_id is NOT NULL with an FK to rooms,
-- and rooms_insert_owner is owner-only, so every company registered between
-- 20260727220415 and this migration has no room and cannot be given a table or
-- a QR code (S-06/S-07 are unusable for them).
--
-- This is the merged body: company + owner profile (with email, from S-02) +
-- four default categories (S-03) + one default room (S-06). Any future
-- create-or-replace of this function must start from THIS version.

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

    insert into public.profiles (user_id, company_id, role, full_name, email)
      values (new.id, new_company_id, 'owner', new.raw_user_meta_data ->> 'full_name', new.email);

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

-- Idempotent repair for any company created while the seed was missing,
-- mirroring the backfill style of 20260727120000_room_layout_tables.sql.
insert into public.rooms (company_id, name, sort_order)
select c.id, 'Sala główna', 0
from public.companies c
where not exists (
  select 1 from public.rooms r where r.company_id = c.id
);
