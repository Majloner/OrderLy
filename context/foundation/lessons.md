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
- **Rule**: Polityka anon SELECT bez predykatu `company_id` nie ma prawa istnieć.
  Jeśli **żaden konsument jej nie potrzebuje — nie nadawaj jej wcale**. Nienadana
  powierzchnia to czysta powierzchnia ataku: nikomu nie służy, a wszystkim szkodzi.
  Gdy publiczny odczyt będzie realnie potrzebny (menu QR, S-07/S-08), dodaj funkcję
  `SECURITY DEFINER` biorącą kod lokalu i zwracającą **projekcję kolumn** — RLS działa
  na wierszach i nie potrafi ukryć `companies.address` ani `companies.code`, więc
  polityka jest złym narzędziem do publicznego endpointu.
- **Rozstrzygnięte 2026-08-13** (migracja `20260813010000_drop_unscoped_anon_read_policies.sql`):
  cztery nieszczelne polityki **usunięto**, a nie zawężono. Wcześniejszy zapis tej lekcji
  mówił, że naprawa czeka na S-07/S-08 — to było **błędne** i zablokowało naprawę na całą
  fazę rolloutu. Przesłanka „musimy czekać na kontekst QR" trzyma się tylko wtedy, gdy coś
  tę powierzchnię już konsumuje. Nic jej nie konsumowało (brak klienta przeglądarkowego,
  klucze `access: "secret"`, brak tras publicznych), więc usunięcie niczego nie zepsuło.
  **Zanim uznasz lukę bezpieczeństwa za zablokowaną przez przyszły slice, sprawdź, czy
  dziurawa funkcjonalność ma w ogóle użytkownika.**
- **Applies to**: nowe polityki RLS `to anon` na tabelach z danymi najemcy
  (menu_categories, menu_items, companies, tables) — Supabase/Postgres RLS.
  Precedens „nie nadawaj nic anon": `rooms`, `room_objects`, `storage.objects`.

## Supabase Storage nie honoruje tokenu użytkownika — operacje przez service_role

- **Context**: S-04 (`menu-item-photos`). Upload zdjęć wymagał autoryzacji do
  Storage jako właściciel. Próbowano: klient `@supabase/ssr` (cookie), opcja
  `accessToken`, surowy REST z `Authorization: Bearer <user JWT>`, oraz
  `createBrowserClient` z sesją z cookies.
- **Problem**: Każda droga z tokenem użytkownika kończyła się `new row violates
  row-level security policy` — Storage widział żądanie jako `anon`, mimo że
  PostgREST ten sam token akceptuje (izolacja weryfikacji JWT: PostgREST vs
  usługa Storage). Symulacja polityki w SQL z `request.jwt.claims` właściciela
  przechodziła, więc polityka była poprawna — problem był w dostarczeniu tożsamości.
- **Rule**: Operacje Storage wymagające tożsamości najemcy (mint signed upload
  URL, `remove`) wykonuj **po stronie serwera kluczem `service_role`** (omija RLS),
  a autoryzację egzekwuj w endpoincie: guard roli + przynależność zasobu do firmy
  + ścieżkę obiektu buduj serwerowo z `company_id` (klient nie może jej sfałszować).
  Nie polegaj na tym, że token użytkownika dotrze do RLS Storage. `service_role`
  trzymaj wyłącznie w `.dev.vars` / sekretach workera, użyj tylko w module serwerowym.
- **Applies to**: każda serwerowa operacja Supabase Storage w tym projekcie
  (bucket `menu-photos` i przyszłe) — `src/lib/storage.ts`. Powiązane:
  [[anon-rls-reads-must-be-scoped-by-company-id]].

## Zmiana middleware/guardów zawsze z test:integration w kryteriach fazy

- **Context**: Każda faza dotykająca src/middleware.ts, guardów w src/lib/*api.ts
  lub route-gatingu (PROTECTED_ROUTES/OWNER_ROUTES).
- **Problem**: S-05 (impl-review F2): e534101 wyjął /menu z OWNER_ROUTES, a kontrakt
  testu macierzy middleware pękł po cichu — kryteria fazy 3 gnały tylko
  lint/typecheck/build/e2e, a zbiorczy re-run maskował exit code pipe'em do tail.
- **Rule**: Faza dotykająca middleware/guardów/route-gatingu musi mieć
  `npm run test:integration` w kryteriach automatycznych; wynik testów czytaj
  z exit code, nigdy przez pipe do tail/grep.
- **Applies to**: plan, implement, impl-review
