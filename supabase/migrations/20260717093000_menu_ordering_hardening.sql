-- Menu ordering hardening (S-03 follow-up from code review):
--   1) atomic reorder RPCs — replace the N per-row UPDATEs the API fired from
--      the Worker (partial failure corrupted persisted order; large sections
--      hit the Cloudflare subrequest cap).
--   2) BEFORE INSERT triggers that assign sort_order server-side — remove the
--      read-then-write race between concurrent creates (SELECT max + INSERT).
-- Reorder RPCs run under the caller's RLS (security invoker), so owner-only
-- writes and tenant isolation are unchanged.

-- ---------------------------------------------------------------------------
-- Atomic reorder: one statement sets sort_order = position in the id array.
-- Rows outside the caller's company match nothing under RLS (harmless no-op).
-- ---------------------------------------------------------------------------
create or replace function public.reorder_menu_categories(category_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.menu_categories m
  set sort_order = ord.n
  from unnest(category_ids) with ordinality as ord(id, n)
  where m.id = ord.id;
$$;

create or replace function public.reorder_menu_items(item_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.menu_items m
  set sort_order = ord.n
  from unnest(item_ids) with ordinality as ord(id, n)
  where m.id = ord.id;
$$;

-- ---------------------------------------------------------------------------
-- Server-side append ordering: when sort_order is left at its 0 default, place
-- the new row at the end of its section in one statement. Categories scope by
-- company; items by (company, category) among non-archived rows. security
-- definer so the max() scan sees the whole section regardless of RLS, mirroring
-- handle_new_user. Explicit non-zero sort_order (trigger/backfill seed) is left
-- untouched.
-- ---------------------------------------------------------------------------
create or replace function public.set_menu_category_sort_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sort_order = 0 then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from public.menu_categories
    where company_id = new.company_id;
  end if;
  return new;
end;
$$;

create trigger menu_categories_set_sort_order
  before insert on public.menu_categories
  for each row
  execute function public.set_menu_category_sort_order();

create or replace function public.set_menu_item_sort_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.sort_order = 0 then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from public.menu_items
    where company_id = new.company_id
      and category_id is not distinct from new.category_id
      and archived_at is null;
  end if;
  return new;
end;
$$;

create trigger menu_items_set_sort_order
  before insert on public.menu_items
  for each row
  execute function public.set_menu_item_sort_order();
