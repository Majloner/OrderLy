# Known gaps surfaced during Phase 1 tenant-isolation testing

These are real gaps the tests document but deliberately do **not** fix in this
change (test rollout Phase 1). Each names a follow-up.

## 1. `menu_items.category_id` is an id-only FK (cross-entity attach at the DB layer)

- **Where**: `supabase/migrations/20260708124756_menu_categories_items.sql:78`
  — `add column category_id uuid references public.menu_categories (id) on delete set null`.
- **Gap**: FK validation runs below RLS and checks the id against *all* companies'
  categories. `menu_categories` has no `(company_id, id)` unique constraint, and the
  `menu_items` write policies pin only `menu_items.company_id`. So a company-A owner
  could, via a **direct authenticated insert/update**, stamp their own item with a
  company-B `category_id`. The route layer blocks this (`categoryExistsInCompany`,
  `src/lib/api.ts:101`), which is what `tests/integration/isolation/category-attach.test.ts`
  proves — but the DB itself does not.
- **Analog already fixed**: `tables.room_id` had the same shape and was closed with a
  composite FK in `supabase/migrations/20260728120000_room_tables_composite_fk.sql:28`.
- **Follow-up**: open a change to add `unique (company_id, id)` on `menu_categories`
  and a composite FK `menu_items (company_id, category_id) → menu_categories (company_id, id)`,
  mirroring the room/table fix. Then flip the category-attach test to also assert the
  DB-layer denial.

## 2. Anon-read policies are not `company_id`-scoped (Risk #2)

- **Where**: `companies_anon_read using (true)`, `tables_anon_read_active using (is_active)`,
  `menu_categories_anon_read using (true)`, `menu_items_anon_read_visible` (availability
  predicate only) — see `context/changes/testing-tenant-isolation-integration/research.md`.
- **Gap**: the anon key can read rows across tenants; scoping is done by an app-supplied
  `company_id` filter, not by RLS. There is no anon route to exercise yet (the public QR
  menu, S-07/S-08, is unbuilt), so this is demonstrated at the SQL layer in Phase 4 and
  left as a labeled known gap until S-07/S-08 moves scoping into RLS.
