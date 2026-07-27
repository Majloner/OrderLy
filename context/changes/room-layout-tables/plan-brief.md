# Schemat sali i stoliki (S-06) — Plan Brief

> Full plan: `context/changes/room-layout-tables/plan.md`

## What & Why

Właściciel lokalu potrzebuje wizualnego schematu sali, na którym rozstawi stoliki i nada im
numery — bo to ten plan pozwoli mu później zmapować wydrukowane kody QR na fizyczne stoliki
(S-07) i odebrać zamówienie z właściwego miejsca (S-08). Realizuje PRD FR-008 (wizualny edytor),
FR-009 (aktywacja/dezaktywacja), FR-010 (numer jako pierwotny identyfikator w obrębie firmy).

## Starting Point

`public.tables` istnieje od F-01 i od tamtej pory nie było na niej ani jednego `ALTER`:
`id, company_id, number, label, is_active, created_at`, bez kolumn układu i bez unikalności
numeru (`supabase/migrations/20260705215147_minimal_tables_menu.sql:15`). Nie istnieje żaden typ
TypeScript dla stolików, żaden endpoint, żadna strona. Tabela nosi też dwa długi RLS z F-01:
`tables_staff_all` to nadal `for all to authenticated` (kelner może dziś usuwać stoliki), a
`tables_anon_read_active` nie ma predykatu `company_id`.

## Desired End State

Właściciel wchodzi na `/room`, widzi zakładki sal (po rejestracji: „Sala główna"), dodaje stolik
z numerem, opisem i kształtem, przeciąga go po kanwasie myszą albo palcem — pozycja zapisuje się
natychmiast. Stolik można dezaktywować i aktywować; **usunąć go nie można nigdzie w systemie** —
ani z UI, ani przez API, ani przez RLS. Numer jest unikalny w firmie, duplikat daje czytelny 409.
Kelner i kuchnia nic nie zapiszą; firma A nie widzi sal ani stolików firmy B.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Model współrzędnych | Swobodne piksele w logicznej przestrzeni 1200×800 | Pozycjonowanie co do piksela; kanwas skaluje tę przestrzeń do kontenera. | Plan |
| Model stolika | `shape` enum (square/circle/rectangle), stały footprint | Wystarczająca rozpoznawalność realnej sali za koszt jednej kolumny; bez `seats` i bez resize (nie ma ich w FR-008–010). | Plan |
| Zasięg edytora | Wiele sal/strefy jako zakładki | Realne lokale mają taras albo drugą salę; nowa encja `rooms`. | Plan |
| Sale ↔ stoliki | `room_id NOT NULL` po backfillu, domyślna sala z triggera | Każdy stolik ma dom, więc zero gałęzi „bez sali"; wzorzec domyślnych kategorii menu. | Plan |
| Mobile | Pełny parytet dotyku | Właściciel ma móc przestawiać salę z telefonu. | Plan |
| Zapis pozycji | Per-upuszczenie, optymistycznie z rollbackiem | Brak stanu „niezapisane"; wzorzec `persistReorder` już w repo. | Plan |
| Nachodzenie stolików | Dozwolone, clamp tylko do granic kanwasu | Zsunięte stoliki są czasem poprawne; zero kodu kolizji. | Plan |
| Kanwas | Jedna logiczna przestrzeń, skalowana do kontenera | Współrzędne stabilne na zawsze, walidacja to stałe zakresy zod. | Plan |
| Usuwanie stolika | Niemożliwe — brak endpointu **i brak polityki delete w RLS** | Realizuje guardrail trwałości QR strukturalnie, nie przez dyscyplinę kodu. | Plan |
| Usuwanie sali | Tylko pustej (`on delete restrict` → 409) | Kaskada zniszczyłaby stoliki i ich przyszłe kody QR. | Plan |
| Unikalność numeru | `unique (company_id, number)` + 409 | FR-010 czyni numer pierwotnym identyfikatorem w obrębie firmy. | Plan |
| Anon RLS na `tables` | Zostawiona bez zmian, poprawka odroczona do S-07 | Decyzja użytkownika; ścieżkę anon projektuje slice QR. | Plan |
| Testy | Unit (schematy + geometria) + asercje zapisu w `rls_isolation.sql` | Domyka dziurę „`tables` ma zero asercji zapisu"; wzorzec S-04. | Plan |

## Scope

**In scope:** encja `rooms` z RLS owner-only; `ALTER` na `tables` (`room_id`, `pos_x`, `pos_y`,
`shape`, unikalny numer); zawężenie `tables_staff_all` do polityk per-operacja bez delete;
domyślna sala w triggerze rejestracji; typy, schematy zod, moduł geometrii; route'y
`/api/room/**` z własnym guardem; strona `/room` z zakładkami sal, CRUD sal, dialogiem stolika,
aktywacją; kanwas dnd-kit z parytetem dotyku; testy unit + RLS.

**Out of scope:** kody QR (S-07); poprawka anon RLS; usuwanie stolików; zoom/pan; resize i liczba
miejsc; blokowanie nachodzenia; `sort_order` na stolikach; refaktor `src/lib/api.ts` (konflikt
z gałęzią S-02); menu, dostępność, zamówienia.

## Architecture / Approach

Dane → API → UI użytkowe → UI wizualne. Jedna transakcyjna migracja stawia `rooms` i rozszerza
`tables` (dodaj nullable → zaseeduj sale → backfill → `set not null`; deduplikuj numery →
unikalny indeks; `drop policy tables_staff_all` → trzy polityki per-operacja). Route'y odpytują
`guard.supabase` bezpośrednio — `company_id` na odczytach nakłada wyłącznie RLS, przy insertach
kolumna podawana jawnie. Guard właściciela trafia do **nowego** `src/lib/room-api.ts`,
importującego helpery z `api.ts` bez jego edycji (rozejście z gałęzią S-02). Frontend to jedna
wyspa `RoomLayoutManager` (`useState` + `callRoomApi`, bez react-query i tostów), a geometria —
konwersja skali i clamp — żyje w czystym, testowanym `src/lib/room-geometry.ts`, nie w komponencie.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fundament danych | `rooms` + kolumny układu + zawężone RLS + asercje zapisu w teście izolacji | Duplikaty `(company_id, number)` w bazie dev blokują unikalny indeks; fixture testowy pęka pod `room_id NOT NULL` |
| 2. API, typy, schematy | Typy, zod + testy, moduł geometrii, route'y `/api/room/**` | Guard w nowym pliku musi zachować dokładny kontrakt `guardMenuRequest`, inaczej kody błędów się rozjadą |
| 3. Strona `/room` bez kanwasu | Działająca strona: zakładki sal, CRUD sal, dialog stolika, aktywacja | Trzy pliki append-only kolidują z gałęzią S-02 (`middleware.ts`, `dashboard.astro`, `types.ts`) |
| 4. Wizualny kanwas | Przeciąganie myszą i palcem, kształty, zapis per-drop z rollbackiem | Konwersja skali (delta w px wyrenderowanych vs pozycja logiczna) — błąd niewidoczny przy skali 1; brak `touch-none` zabija drag na mobile |

**Prerequisites:** S-01 (done). Gałąź `feat/room-layout-tables`. Dostęp do podłączonego projektu
Supabase (`npm run db:push`, `npm run test:rls` działają na hostowanej bazie, nie lokalnej).

**Estimated effort:** ~4 sesje, po jednej na fazę; faza 4 jest najbardziej niepewna, bo swobodny
kanwas 2D to w tym repo nowy wzorzec (dnd-kit służył dotąd tylko do sortowania list pionowych).

## Open Risks & Assumptions

- **Świadomie odroczony dług izolacji.** `tables_anon_read_active` zostaje `using (is_active)` bez
  predykatu `company_id` — otwarta lekcja `context/foundation/lessons.md:5-20`, którą ma zamknąć
  S-07. Ten slice dotyka tabeli i tego nie naprawia; nowa tabela `rooms` startuje bez polityki
  anon, żeby nie powiększać dziury.
- **Dane dev.** Nie zweryfikowano, czy w podłączonej bazie są zdublowane `(company_id, number)`.
  Migracja przenumerowuje kolizje deterministycznie, ale realnie zmieni numery stolików, jeśli
  takie istnieją — warto policzyć je przed `db:push`.
- **Parytet dotyku na iOS.** Plan zakłada, że `PointerSensor` + `touch-none` wystarczy. Jeśli
  Safari na iOS okaże się zawodne, fallbackiem jest dołożenie `TouchSensor` — to zmiana w jednym
  miejscu, ale wykryje ją tylko test na realnym urządzeniu.
- **Brak testów komponentów.** Repo nie ma Playwright ani testing-library, więc zachowanie kanwasu
  weryfikują wyłącznie kroki manualne; automatyzacja pokrywa geometrię jako czyste funkcje.
- **Praca równoległa z S-02.** Trzy pliki są współdzielone i zmieniane tylko przez dopisanie;
  scalenie wymaga uwagi, a `src/lib/api.ts` celowo nie jest refaktoryzowany.

## Success Criteria (Summary)

- Właściciel rozstawia stoliki na wizualnym planie sali i pozycje utrzymują się po odświeżeniu —
  także po przeciąganiu palcem na telefonie
- Stolik da się wyłączyć i włączyć, ale **nie da się go usunąć żadną ścieżką** — kod QR z S-07
  pozostanie ważny na trwałe
- Kelner i kuchnia nie zapisują nic w schemacie sali, a firma A nie widzi danych firmy B —
  potwierdzone asercjami w `npm run test:rls`
