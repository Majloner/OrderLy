# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Anon RLS reads must be scoped by company_id

- **Context**: supabase/migrations/20260708124756_menu_categories_items.sql:68 —
  menu_categories_anon_read `using (true)`; menu_items_anon_read_visible bez
  predykatu company_id. Wzorzec odziedziczony z F-01 (companies_anon_read,
  tables_anon_read_active).
- **Problem**: Anonimowy klient (publiczny klucz anon) może enumerować kategorie
  i opublikowane pozycje wszystkich najemców — scoping robi dopiero aplikacja na
  podstawie firmy rozwiązanej z QR. Łamie zasadę „tenant isolation is
  non-negotiable" na poziomie DB dla ścieżki anon.
- **Rule**: Polityki anon SELECT muszą zawężać po company_id (rozwiązanym z
  kontekstu skanowanego stołu/QR), nie `using (true)`. Przy budowie publicznego
  menu QR (S-07/S-08) zrewidować anon-read wszystkich tabel menu i przenieść
  scoping z aplikacji do RLS.
- **Applies to**: nowe polityki RLS `to anon` na tabelach z danymi najemcy
  (menu_categories, menu_items, companies, tables) — Supabase/Postgres RLS.
