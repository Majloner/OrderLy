-- Reset sort_order when an item moves between sections (impl-review F1).
-- The INSERT trigger only assigns sort_order on create, so a PUT that changes
-- category_id (or an FK ON DELETE SET NULL dropping items to "Bez kategorii")
-- left the moved item with its old sort_order — landing it at an arbitrary
-- position in the destination section. This BEFORE UPDATE trigger appends the
-- moved row to the end of its new section, server-side and race-free.
--
-- Fires only when category_id is in the UPDATE's SET list AND actually changes,
-- so item-field edits and the reorder RPC (which sets sort_order, not
-- category_id) are untouched.
create or replace function public.move_menu_item_sort_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is distinct from old.category_id then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from public.menu_items
    where company_id = new.company_id
      and category_id is not distinct from new.category_id
      and archived_at is null
      and id <> new.id;
  end if;
  return new;
end;
$$;

create trigger menu_items_move_sort_order
  before update of category_id on public.menu_items
  for each row
  execute function public.move_menu_item_sort_order();
