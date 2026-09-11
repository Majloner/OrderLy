<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Menu Availability Toggle (S-05)

- **Plan**: context/changes/menu-availability-toggle/plan.md
- **Scope**: Full plan (4 fazy) + follow-up redirect (5be3d00)
- **Date**: 2026-09-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan Adherence: 18/18 pozycji MATCH; jedyna odchyłka od litery planu (nieedytowanie
zamkniętej migracji 20260708124756) to udokumentowana adaptacja — nagłówek nowej
migracji cytuje spełnioną obietnicę. Scope: dwa EXTRA, oba jawnie zlecone przez
właściciela (bundel kursowy w 7e7c797; follow-up redirect 5be3d00). Success Criteria
(re-run po follow-upie): lint 0 / typecheck 0 / unit 180 / integration **250 passed
exit 0** / RLS 32×OK / e2e 5/5.

## Findings

### F1 — Pojedynczy slot busy dla toggle'a dostępności psuje pauzę pollingu przy równoległych przełączeniach

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; warto się zatrzymać
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/menu/MenuManager.tsx:40,166-180
- **Detail**: Select jest disabled tylko dla pozycji w locie, więc można zacząć
  toggle B, gdy toggle A trwa. `setAvailabilityBusyId(B)` nadpisuje A; `finally` A
  ustawia `null`, co (a) odblokowuje Select B mimo PATCH-a B w locie (możliwy
  duplikat PATCH), (b) odpauzowuje polling w środku lotu B — tick może na moment
  odmalować stan sprzed `refetch`. Nic nie ginie trwale (kolejny tick zbiega), ale
  licznik `busyMutations` trzy linie wyżej rozwiązuje dokładnie tę klasę.
- **Fix**: Objąć `changeAvailability` licznikiem `busyMutations` (increment/finally
  decrement), zostawiając `availabilityBusyId` wyłącznie do disabled per wiersz.
  - Strength: Ten sam wzorzec co persistReorder; naprawia pauzę i duplikaty naraz.
  - Tradeoff: Znikomy — kilka linii.
  - Confidence: HIGH — licznik już istnieje i działa.
  - Blind spot: None significant.
- **Decision**: FIXED (busyMutations wokół changeAvailability; pollPaused bez redundantnego członu)

### F2 — Kryteria fazy 3 nie uruchamiały test:integration; kontrakt testu middleware pękł po cichu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; naprawione w trakcie review
- **Dimension**: Success Criteria (proces)
- **Location**: tests/integration/authz/middleware.test.ts:48 (OWNER_PAGES)
- **Detail**: e534101 wyjął /menu z OWNER_ROUTES, ale test macierzy dalej oczekiwał
  odbicia kelnera z /menu. Kryteria fazy 3 (lint/typecheck/build/e2e) nie zawierały
  integration, a późniejszy zbiorczy run maskował exit code pipe'em do `tail`.
- **Fix**: Zastosowany w 5be3d00 (OWNER_PAGES bez /menu + nowe testy staff→/menu,
  publiczne strony → 302 /dashboard). Wniosek na przyszłość: faza dotykająca
  middleware/guardów zawsze z `npm run test:integration` w kryteriach — kandydat
  na lekcję.
- **Decision**: FIXED (5be3d00)

### F3 — Polityka kelnera dopuszcza wiersze zarchiwizowane (route filtruje, DB nie)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; wąska zmiana
- **Dimension**: Safety & Quality (defense-in-depth)
- **Location**: supabase/migrations/20260910080000_menu_availability_waiter_write.sql:19-25
- **Detail**: Endpoint filtruje `.is("archived_at", null)`, ale kelner uderzający
  w PostgREST bezpośrednio swoim JWT może flipnąć availability zarchiwizowanej
  pozycji własnej firmy. Skutek dziś pomijalny (brak ścieżki odczytu/unarchive),
  ale DB ma być warstwą egzekwowania.
- **Fix**: Nowa migracja dodająca `and archived_at is null` do USING/WITH CHECK
  polityki kelnera + asercja w suicie RLS.
- **Decision**: FIXED (migracja 20260911090000 + asercja archived w 27; push lokalny i hostowany)

### F4 — Reorder RPC jako kelner: blokuje wyłącznie trigger, bez testu pinującego

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — jedna asercja SQL
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260717093000:26-36 × 20260910080000
- **Detail**: Po S-05 kelner MATCHES politykę UPDATE, więc `reorder_menu_items`
  (SECURITY INVOKER, EXECUTE dla PUBLIC) dociera do triggera i pada na P0001
  (sort_order ≠ availability) — prześledzony, bezpieczny. Ale to dokładnie klasa
  ścieżki, dla której trigger istnieje, i nic jej nie pinuje.
- **Fix**: Asercja przy 27 w rls_isolation.sql: `select public.reorder_menu_items(...)`
  jako kelner z permutacją → P0001.
- **Decision**: FIXED (asercja 29: reorder RPC jako kelner -> P0001)

### F5 — Brak trwałego testu integracyjnego happy-path kelnera (PATCH → 200)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria
- **Location**: tests/integration/isolation/ (brak)
- **Detail**: Route-level 200 kelnera na własnym id istniał tylko jako jednorazowy
  spot-check (usunięty po fazie 2). Macierz dowodzi "za guardem", suita RLS dowodzi
  DB — środek (200 + payload) nie jest pinowany.
- **Fix**: Przenieść treść spot-checku do stałego testu (np. obok cross-tenant-write).
- **Decision**: FIXED (tests/integration/menu/availability-toggle.test.ts)

### F6 — Otwarty dropdown Selecta vs zdalna zmiana w oknie ticka

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — accepted-risk MVP
- **Dimension**: Architecture
- **Location**: src/components/menu/MenuItemRow.tsx:104-129
- **Detail**: Tick nie zamyka otwartego dropdownu (stabilne klucze, portal
  przeżywa reconciliation). Kraniec: zdalna zmiana przenosząca/archiwizująca
  pozycję w 4-sekundowym oknie z otwartym dropdownem — dropdown znika lub
  odkleja się wizualnie. Rzadkość klasy accepted-risk; ewentualny fix to
  kontrolowane `open` zasilające `pollPaused` (jak dialogi).
- **Fix**: Zaakceptować jako ryzyko MVP (odnotowane); wracać tylko przy realnych
  zgłoszeniach.
- **Decision**: ACCEPTED (świadome ryzyko MVP; wracamy przy realnych zgłoszeniach)
