# Menu Items Management (S-03) — Plan Brief

> Full plan: `context/changes/menu-items-management/plan.md`

## What & Why

Właściciel buduje aktywne menu lokalu — kategorie, pozycje (nazwa, opis, cena), tagi 14 alergenów UE
i 3-stanowa dostępność (PRD US-02, FR-004, FR-006). To slice na ścieżce krytycznej do gwiazdy S-08
(klient zamawia przez QR): model pozycji menu zasila i klienta, i przełączanie dostępności (S-05).

## Starting Point

F-01 zostawił minimalne `menu_items` (name, price, is_available boolean) z RLS „staff-all na kredyt"
i anon-read po `is_available`. Kategorie i alergeny nie istnieją. Trigger rejestracji (S-01) tworzy
firmę + profil ownera. W repo nie ma frameworka testów JS (AGENTS.md: dodać przed pierwszą feature).

## Desired End State

Owner na `/menu` zarządza całym menu w jednym widoku: CRUD kategorii i pozycji w dialogach, drag&drop
kolejności obu poziomów, checklista alergenów z disclaimerem, archiwizacja zamiast usuwania. Nowa firma
startuje z 4 domyślnymi kategoriami. Kelner/kuchnia nie mogą modyfikować menu (RLS), anon widzi tylko
pozycje niezarchiwizowane `available`/`sold_out`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Kategorie | Tabela `menu_categories` (owner-managed, sort_order) | Każdy lokal ma własną strukturę; gotowe pod S-08 |
| Alergeny | Stała lista 14 alergenów UE (enum[]) | Zgodne z UE 1169/2011; zero zarządzania słownikiem |
| Dostępność | Enum 3-stanowy już teraz (boolean → enum) | S-05/S-08 dostają docelowy model bez drugiej migracji |
| Usuwanie pozycji | Miękkie (`archived_at`) | Bezpieczne referencje dla przyszłych zamówień (user override) |
| RLS | Zapisy menu tylko owner; SELECT staff bez zmian | Domyka dług jawnie odroczony w F-01 „do S-03/S-05" |
| Walidacja | zod od tej zmiany | Konwencja AGENTS.md; najbogatszy model dotąd |
| API | JSON CRUD + reorder pod `/api/menu/*` | 20+ pozycji bez przeładowań; reużycie w S-05 (polling) i S-08 |
| Kategoria pozycji | Opcjonalna (sekcja „Bez kategorii") | Nie blokuje onboardingu <30 min |
| UI | Jedna strona `/menu`, wyspa React + dialogi | Cały workflow budowy menu bez nawigacji |
| Kolejność | Pełny drag&drop kategorii i pozycji (dnd-kit) | Pełna kontrola prezentacji (user override) |
| Nazwy pozycji | Unikalne per firma (case-insensitive, wśród niezarchiwizowanych) | Duplikat w MVP bez wariantów = pomyłka |
| Usuwanie kategorii | Dozwolone; FK `SET NULL` → „Bez kategorii" | Współgra z opcjonalną kategorią, bez blokad |
| Testy | Vitest (setup) + rozszerzony test RLS SQL | AGENTS.md: framework przed pierwszą feature |
| Alergeny — ryzyko prawne | Statyczny disclaimer w UI | Tania mitygacja PRD Open Question #1 |
| Domyślne kategorie | Seed w triggerze rejestracji + backfill istniejących | Szybszy start właściciela (user override) |

## Scope

**In scope:** migracja (kategorie, rozszerzenie `menu_items`, enum dostępności, RLS owner-only, anon
policy, trigger + backfill), JSON API + zod, setup Vitest, strona `/menu` z wyspą React (CRUD, dnd-kit,
alergeny, empty state), rozszerzony test izolacji.

**Out of scope:** zdjęcia/miniatury (S-04), przełączanie dostępności przez kelnera i polling (S-05),
menu klienta/QR (S-07/S-08), własne tagi diet, pełne składniki, warianty pozycji, wyrównanie starych
route'ów auth do zod/JSON.

## Architecture / Approach

Backend-first w trzech fazach: (1) jedna migracja domenowa + RLS + trigger + test izolacji na hostowanej
bazie; (2) współdzielone typy + schematy zod + endpointy JSON (`GET /api/menu` jako jeden payload —
przyszły cel pollingu S-05) + Vitest; (3) wyspa React `MenuManager` na `/menu` (owner-only) konsumująca
API, z dnd-kit i komponentami shadcn. RLS jest egzekucją właściwą; guardy w route'ach to warstwa UX.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fundament danych | migracja + zawężony RLS + trigger + test izolacji | wymiana boolean→enum i polityk na żywej bazie bez okna niespójności |
| 2. API + Vitest | JSON CRUD/reorder z zod + pierwszy framework testowy | spójny kontrakt błędów (401/403/409) dla UI |
| 3. UI `/menu` | wyspa React: CRUD, drag&drop, alergeny, empty state | największa wyspa dotąd; poprawny optimistic reorder z rollbackiem |

**Prerequisites:** F-01 + S-01 na hosted (done); Supabase CLI zlinkowane; przegląd diffu przed `db push`.
**Estimated effort:** ~2–3 sesje w 3 fazach.

## Open Risks & Assumptions

- Migracja zmienia żywą bazę: wymiana kolumny dostępności i polityk musi zajść w jednej migracji
  (add → backfill → drop), z przeglądem diffu przed push.
- Kontrakt dla S-08: pozycje zamówień będą snapshotować nazwę/cenę; `sold_out` widoczne dla anon,
  `unavailable`/archived ukryte — zapisać przy archiwizacji zmiany.
- S-05 doda kelnerowi ścieżkę zapisu dostępności (dziś zapisy owner-only) — świadomie odroczone.
- dnd-kit w wyspie Astro: cała lista musi być jedną wyspą; sortable context nie przecina granic wysp.

## Success Criteria (Summary)

- Właściciel buduje pełne menu (kategorie + pozycje z alergenami) w jednym widoku, bez przeładowań;
  kolejność drag&drop trwała po odświeżeniu.
- Kelner/kuchnia nie mogą modyfikować menu (RLS + 403), anon nie widzi pozycji ukrytych/zarchiwizowanych
  — dowiedzione przez `npm run test:rls`.
- `npm test` (nowy Vitest), `npm run typecheck` (nowy `astro check`), `npm run build`, `npm run lint` przechodzą.
