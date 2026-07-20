-- Menu management (S-03): categories, item enrichment, 3-state availability,
-- owner-only menu writes, allergen tags, soft-delete (archiving).
--
-- Extends the minimal F-01 menu_items via ALTER (never re-CREATE). The
-- boolean->enum availability swap follows "detach dependencies first, drop
-- last": add column -> backfill -> DROP POLICY (the anon policy depends on
-- is_available in pg_depend; plain DROP COLUMN would fail, CASCADE would
-- silently drop the policy) -> DROP COLUMN -> CREATE new policy. All in this
-- one transactional migration, so there is no window where anon sees
-- everything or nothing.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.menu_item_availability as enum ('available', 'unavailable', 'sold_out');

-- The 14 EU allergens (Regulation 1169/2011). Polish labels live in the app.
create type public.allergen as enum (
  'gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soybeans', 'milk',
  'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs'
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index menu_categories_company_id_idx on public.menu_categories (company_id);
create unique index menu_categories_company_name_idx
  on public.menu_categories (company_id, lower(name));

alter table public.menu_categories enable row level security;

-- Staff read their own company's categories; only the owner mutates them.
create policy menu_categories_select_staff on public.menu_categories
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy menu_categories_insert_owner on public.menu_categories
  for insert
  to authenticated
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy menu_categories_update_owner on public.menu_categories
  for update
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner')
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy menu_categories_delete_owner on public.menu_categories
  for delete
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner');

-- Anonymous (QR) read, mirroring companies_anon_read; the app filters by the
-- company resolved from the scanned table.
create policy menu_categories_anon_read on public.menu_categories
  for select
  to anon
  using (true);

-- ---------------------------------------------------------------------------
-- menu_items enrichment (ALTER only)
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column description text,
  add column category_id uuid references public.menu_categories (id) on delete set null,
  add column allergens public.allergen[] not null default '{}',
  add column sort_order int not null default 0,
  add column archived_at timestamptz;

create index menu_items_category_id_idx on public.menu_items (category_id);

-- Name uniqueness per company among non-archived items (case-insensitive).
create unique index menu_items_company_name_idx
  on public.menu_items (company_id, lower(name))
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Availability: boolean -> enum ("detach dependencies first, drop last")
-- ---------------------------------------------------------------------------
alter table public.menu_items
  add column availability public.menu_item_availability not null default 'available';

update public.menu_items
  set availability = case when is_available then 'available' else 'unavailable' end::public.menu_item_availability;

drop policy menu_items_anon_read_available on public.menu_items;

alter table public.menu_items drop column is_available;

-- Anon sees non-archived items that are available or sold out. sold_out stays
-- visible (FR-007: the client must SEE the flip to "wyprzedane"); unavailable
-- and archived are hidden.
create policy menu_items_anon_read_visible on public.menu_items
  for select
  to anon
  using (archived_at is null and availability in ('available', 'sold_out'));

-- ---------------------------------------------------------------------------
-- menu_items policy narrowing: staff read, owner-only writes (PRD Access
-- Control; closes the debt deferred in F-01 "refined in S-03/S-05").
-- S-05 will add the waiter availability-toggle write path.
-- ---------------------------------------------------------------------------
drop policy menu_items_staff_all on public.menu_items;

create policy menu_items_select_staff on public.menu_items
  for select
  to authenticated
  using (company_id = public.current_company_id());

create policy menu_items_insert_owner on public.menu_items
  for insert
  to authenticated
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy menu_items_update_owner on public.menu_items
  for update
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner')
  with check (company_id = public.current_company_id()
              and public.current_staff_role() = 'owner');

create policy menu_items_delete_owner on public.menu_items
  for delete
  to authenticated
  using (company_id = public.current_company_id()
         and public.current_staff_role() = 'owner');

-- ---------------------------------------------------------------------------
-- Default categories: extend the registration trigger + one-off backfill
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
  end if;

  return new;
end;
$$;

-- Idempotent backfill: existing companies without any category get the same
-- default set, keeping dev/test environments on par with new registrations.
insert into public.menu_categories (company_id, name, sort_order)
select c.id, d.name, d.sort_order
from public.companies c
cross join (values ('Przystawki', 1), ('Dania główne', 2), ('Desery', 3), ('Napoje', 4))
  as d (name, sort_order)
where not exists (
  select 1 from public.menu_categories mc where mc.company_id = c.id
);
