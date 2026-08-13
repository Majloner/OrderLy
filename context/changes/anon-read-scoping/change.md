---
change_id: anon-read-scoping
title: Close Risk #2 — anon reads are not company_id-scoped
status: implemented
created: 2026-08-13
updated: 2026-08-13
archived_at: null
---

## Notes

Risk #2 from context/foundation/test-plan.md §2 — the only risk in the map that is
today DEMONSTRATED but not PROTECTED. `supabase/tests/rls_isolation.sql` carries a
`KNOWN GAP (Risk #2)` block that prints notices (never asserts) showing the anon key
reads company-B rows on four policies with no `company_id` predicate:

- `companies_anon_read`            using (true)
- `tables_anon_read_active`        using (is_active)
- `menu_categories_anon_read`      using (true)
- `menu_items_anon_read_visible`   availability predicate only

Not an e2e risk: it lives at the SQL RLS layer, with an anon-key client. The Phase 1
harness already provides an anon principal (`seed.anon`, `anonClient()`).

Risk response intent (to VERIFY in research, not assume):
- Prove the anon key cannot read rows of a company it has no context for.
- Challenge "anon read is harmless" — anon can currently enumerate every venue code,
  every active table with its room geometry, and every published menu across tenants.
- The prior research (Phase 1) concluded the fix was blocked on S-07/S-08 because
  scoping needs a QR/table context. Research must re-check that premise: if NO anon
  consumer exists in the app today, the cheapest correct fix may be to remove the
  anon read surface entirely until S-07/S-08 reintroduces it scoped — a policy change,
  not a product decision.

Key question for research: is there ANY anon reader today (client-side query, public
page, QR path, unauthenticated route)? That single fact decides whether this is a
"tighten the predicate" change or a "drop the unused surface" change.
