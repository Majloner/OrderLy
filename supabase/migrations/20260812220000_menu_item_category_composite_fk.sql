-- Tenant-safe category reference for menu items (Risk #4 — the last cross-entity
-- pointer without a schema-level guarantee).
--
-- menu_items_insert_owner / menu_items_update_owner validate only
-- menu_items.company_id, and FK validation on category_id runs BELOW RLS, so the
-- database accepted (company_id = A, category_id = <a category owned by B>). The
-- only thing preventing it was categoryExistsInCompany() in src/lib/api.ts —
-- application code, not an invariant. Any future write path that forgot that call
-- (a bulk import, a PATCH that starts accepting category_id) would file an item of
-- company A under B's category: A would see it grouped by a section A cannot read,
-- and deleting B's category would silently re-file someone else's item.
--
-- tables.room_id had exactly this shape and was closed in
-- 20260728120000_room_tables_composite_fk.sql; room_objects shipped composite from
-- day one. This closes the same hole for the last remaining pointer, which is what
-- supabase/tests/rls_isolation.sql flagged as "KNOWN GAP (Risk #4)".

-- Repair before constraining: a pre-existing cross-tenant reference would block the
-- ALTER. Such a row is already a bug, and category_id is nullable, so the honest
-- repair is to un-file the item rather than invent a replacement category for it.
update public.menu_items i
set category_id = null
where i.category_id is not null
  and not exists (
    select 1
    from public.menu_categories c
    where c.id = i.category_id
      and c.company_id = i.company_id
  );

-- Referenceable target for the composite FK. menu_categories.id is already the
-- primary key, so this unique constraint adds nothing for lookups — it exists
-- solely because a foreign key must reference a uniquely-constrained column list.
alter table public.menu_categories
  add constraint menu_categories_company_id_id_key unique (company_id, id);

alter table public.menu_items
  drop constraint menu_items_category_id_fkey;

-- Unlike tables.room_id, category_id is NULLABLE — an item may sit in no section
-- ("Bez kategorii"). The default MATCH SIMPLE semantics are exactly right here: the
-- constraint is skipped entirely while category_id is NULL, so uncategorised items
-- stay legal, and a non-null category_id must belong to the item's own company.
--
-- ON DELETE SET NULL has to NAME the column. company_id is NOT NULL, so the
-- unqualified form would try to null it as well and fail at delete time; the column
-- list form (PostgreSQL 15+, this project runs 17) nulls only category_id. That
-- preserves the behaviour DELETE /api/menu/categories/[id] depends on: deleting a
-- category moves its items to "Bez kategorii" instead of blocking the delete.
alter table public.menu_items
  add constraint menu_items_company_id_category_id_fkey
  foreign key (company_id, category_id)
  references public.menu_categories (company_id, id)
  on delete set null (category_id);
