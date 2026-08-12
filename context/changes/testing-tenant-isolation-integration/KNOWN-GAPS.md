# Known gaps surfaced during Phase 1 tenant-isolation testing

These are real gaps the tests document but deliberately do **not** fix in this
change (test rollout Phase 1). Each names a follow-up.

## 1. ~~`menu_items.category_id` is an id-only FK~~ — **CLOSED 2026-08-12**

- **Was**: `category_id` referenced `menu_categories (id)` alone
  (`20260708124756_menu_categories_items.sql:78`). FK validation runs below RLS and
  checked the id against *all* companies' categories, so a company-A owner could, via a
  **direct authenticated insert/update**, stamp their own item with a company-B
  `category_id`. The route layer blocked it (`categoryExistsInCompany`, `src/lib/api.ts`)
  but the schema did not — any write path that forgot that call reopened the hole.
- **Fixed by**: `supabase/migrations/20260812220000_menu_item_category_composite_fk.sql`
  — `unique (company_id, id)` on `menu_categories` plus
  `menu_items (company_id, category_id) → menu_categories (company_id, id)`, mirroring
  `20260728120000_room_tables_composite_fk.sql`. `category_id` stays nullable: MATCH
  SIMPLE skips the constraint on NULL, and `on delete set null (category_id)` (PG 15+
  column-list form) preserves the re-filing behaviour `DELETE /api/menu/categories/[id]`
  depends on — the unqualified form would have tried to null the NOT NULL `company_id`.
- **Now asserted**: `supabase/tests/rls_isolation.sql` "Assertion 5b" — cross-tenant
  reference refused, NULL still legal, category delete still re-files. Verified
  non-tautological: dropping the composite FK turns the suite red.

## 2. Anon-read policies are not `company_id`-scoped (Risk #2)

- **Where**: `companies_anon_read using (true)`, `tables_anon_read_active using (is_active)`,
  `menu_categories_anon_read using (true)`, `menu_items_anon_read_visible` (availability
  predicate only) — see `context/changes/testing-tenant-isolation-integration/research.md`.
- **Gap**: the anon key can read rows across tenants; scoping is done by an app-supplied
  `company_id` filter, not by RLS. There is no anon route to exercise yet (the public QR
  menu, S-07/S-08, is unbuilt), so this is demonstrated at the SQL layer in Phase 4 and
  left as a labeled known gap until S-07/S-08 moves scoping into RLS.
