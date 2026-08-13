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

## 2. ~~Anon-read policies are not `company_id`-scoped (Risk #2)~~ — **CLOSED 2026-08-13**

- **Was**: `companies_anon_read using (true)`, `tables_anon_read_active using (is_active)`,
  `menu_categories_anon_read using (true)`, `menu_items_anon_read_visible` (availability
  predicate only). The anon key read rows across every tenant — venue codes, floor-plan
  geometry, prices, and `photo_path` (which also undid the Storage anti-enumeration defence).
- **Fixed by**: `supabase/migrations/20260813010000_drop_unscoped_anon_read_policies.sql` —
  the four policies were **dropped**, not narrowed. A `company_id` predicate is not
  expressible for anon (no session identity: `current_company_id()` is NULL, nothing mints
  anon JWTs, GUCs don't survive PostgREST's per-request transaction), and research found the
  surface had **no consumer at all**, so removing it broke nothing. Matches the
  `rooms` / `room_objects` / `storage.objects` precedent.
- **This gap's premise was wrong.** It said the fix "waits for S-07/S-08". That only holds
  if something already consumes the anon surface; nothing did. The belief cost a full
  rollout phase. See `context/foundation/lessons.md`.
- **Now asserted**: `rls_isolation.sql` Assertion 5 (re-baselined to zero) + Assertion 5c,
  and `tests/integration/isolation/anon-read-scoping.test.ts` on the real anon-key path with
  a service-role control. Verified non-tautological: reinstating one policy turns both the
  SQL suite and the integration suite red.
- **For S-07/S-08**: do not re-add `using (true)`. Add a `SECURITY DEFINER` RPC taking the
  venue code and returning a column projection.
