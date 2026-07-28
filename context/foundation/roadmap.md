---
project: OrderLY
version: 1
status: draft
created: 2026-07-01
updated: 2026-07-17
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: OrderLY

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

OrderLY to jedno, tanie narzędzie all-in-one dla małych i średnich lokali gastronomicznych:
aktywne menu ze zdjęciami, stały kod QR przy stoliku i obsługa zamówień zarówno przez klienta,
jak i personel — żeby uporządkować rozproszone menu/cennik i odciążyć kelnera jako wąskie gardło.
Wyróżnik produktu (ang. *wedge* — jedna cecha, której usunięcie czyni produkt nieodróżnialnym od
zwykłego cyfrowego menu) to **stały kod QR per stolik wiążący anonimową sesję klienta z konkretnym
stolikiem**: zerowy nakład gościa, automatyczne wiązanie zamówienia ze stolikiem.

## North star

**S-08: Klient skanuje QR → przegląda aktywne menu → składa i dokłada zamówienie ze stolika** —
to walidacja kluczowej hipotezy produktu (Kryterium sukcesu #1: pełna pętla zamówienia end-to-end),
więc sekwencjonowana tak wcześnie, jak pozwolą zależności (menu + stoliki + QR).

> Gwiazda przewodnia oznacza tu najmniejszy pełny (end-to-end) przepływ, którego udane dostarczenie
> dowodzi, że rdzeń produktu działa — umieszczony możliwie wcześnie, bo wszystko inne ma znaczenie
> tylko, jeśli ten przepływ zadziała.

## At a glance

| ID    | Change ID                  | Outcome (użytkownik może …)                                            | Prerequisites    | PRD refs                     | Status   |
| ----- | -------------------------- | --------------------------------------------------------------------- | ---------------- | ---------------------------- | -------- |
| F-01  | multitenant-rls-foundation | (fundament) izolacja firm `company_id` + RLS i model ról personelu     | —                | Access Control, NFR-iso      | done     |
| S-01  | owner-company-registration | właściciel rejestruje firmę, loguje się i edytuje profil lokalu        | F-01             | US-02, FR-001, FR-002        | done     |
| S-02  | staff-accounts-roles       | właściciel tworzy konta personelu i nadaje role (kelner/kuchnia)       | S-01             | FR-003                       | proposed |
| S-03  | menu-items-management      | właściciel buduje menu — pozycje, kategorie, tagi alergenów            | S-01             | US-02, FR-004, FR-006        | done     |
| S-04  | menu-item-photos           | właściciel dodaje zdjęcia pozycji z generowaniem miniatur              | S-03             | US-02, FR-005                | proposed |
| S-05  | menu-availability-toggle   | kelner przełącza dostępność pozycji (dostępna/niedostępna/wyprzedana)  | S-03, S-02       | FR-007                       | proposed |
| S-06  | room-layout-tables         | właściciel projektuje schemat sali i zarządza stolikami                | S-01             | FR-008, FR-009, FR-010       | proposed |
| S-07  | table-qr-codes             | właściciel generuje stały kod QR przypisany na trwałe do stolika       | S-06             | FR-011                       | proposed |
| S-08  | client-qr-ordering         | klient skanuje QR, przegląda menu i składa/dokłada zamówienie ze stolika | S-03, S-07     | US-01, FR-012, FR-015        | proposed |
| S-09  | staff-order-panel          | personel prowadzi statusy pozycji, widzi rozliczenie i zamyka rachunek | S-08, S-02       | FR-014, FR-016, FR-019       | proposed |
| S-10  | waiter-created-orders      | kelner tworzy i edytuje zamówienia w panelu personelu                 | S-08, S-02       | FR-013                       | proposed |
| S-11  | kitchen-display            | kuchnia widzi pozycje do przygotowania i oznacza je jako gotowe        | S-09             | US-03, FR-017, FR-018        | proposed |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące łańcuch prerekwizytów. Kanoniczna kolejność żyje w
grafie zależności poniżej; ta tabela to proponowana kolejność czytania w równoległych torach.

| Stream | Theme                  | Chain                                  | Note                                                          |
| ------ | ---------------------- | -------------------------------------- | ------------------------------------------------------------ |
| A      | Onboarding właściciela | `F-01` → `S-01` → `S-02`               | Ścieżka konta/firmy/personelu; głowa całej sekwencji.        |
| B      | Menu                   | `S-03` → `S-04` / `S-05`               | Dołącza do Stream A w `S-01`; `S-04` i `S-05` równolegle.    |
| C      | Sala i QR              | `S-06` → `S-07`                        | Dołącza do Stream A w `S-01`; równolegle ze Stream B.        |
| D      | Pętla zamówienia       | `S-08` → `S-09` → `S-11` / `S-10`      | Gwiazda `S-08` łączy Stream B (`S-03`) i C (`S-07`).         |

## Baseline

Co jest już w kodzie na `2026-07-01` (auto-zinwentaryzowane + potwierdzone przez użytkownika).
Fundamenty poniżej zakładają obecność tych warstw i ich NIE odbudowują.

- **Frontend:** present — Astro 6 + React 19 + Tailwind 4; strony auth/dashboard, komponenty (`src/pages`, `src/components`).
- **Backend / API:** partial — SSR API tylko dla auth (`src/pages/api/auth/*`); brak API menu/zamówień/stolików.
- **Data:** absent — projekt Supabase istnieje, ale schemat pusty (brak migracji/tabel domenowych); tylko `auth.users`.
- **Auth:** partial — Supabase Auth + middleware ochrony tras (`src/middleware.ts`) działa; brak ról i multi-tenant RLS.
- **Deploy / infra:** present — Cloudflare Workers, live (`orderly`), sekrety, runbook (`context/deployment/deploy-plan.md`).
- **Observability:** partial — observability Workerów ON (`wrangler.jsonc`); brak logowania/błędów na poziomie aplikacji.

## Foundations

### F-01: Multi-tenant fundament (company_id + RLS) i model ról

- **Outcome:** (fundament) każda tabela domenowa nosi `company_id`, polityki RLS wymuszają izolację per firma, a role personelu (właściciel/kelner/kuchnia) są reprezentowane na bazie istniejącego Supabase Auth.
- **Change ID:** multitenant-rls-foundation
- **PRD refs:** Access Control (multi-tenant, role), Non-Functional Requirements (żadne żądanie nie ujawnia danych innej firmy)
- **Unlocks:** S-01 (pierwsza tenant-owana encja: firma), oraz każdy kolejny slice operujący na danych firmy; redukuje guardrail „izolacja danych między firmami"; zapewnia ścieżkę weryfikacji „firma A nie widzi danych firmy B".
- **Prerequisites:** — (na bazie obecnego Supabase Auth — partial)
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Błędna konfiguracja RLS → wyciek danych między firmami (kluczowy guardrail). Robimy minimalny wzorzec + test izolacji raz, zanim dołożą się menu/zamówienia.
- **Status:** done

## Slices

### S-01: Rejestracja firmy i profil lokalu

- **Outcome:** właściciel rejestruje konto firmy, loguje się i edytuje profil lokalu (nazwa, adres, godziny otwarcia).
- **Change ID:** owner-company-registration
- **PRD refs:** US-02, FR-001, FR-002
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy realny tenant — jeśli wiązanie konta właściciela z `company_id` jest słabe, każdy kolejny slice dziedziczy lukę izolacji. Sekwencjonowany zaraz po F-01.
- **Status:** done

### S-02: Konta personelu i role

- **Outcome:** właściciel tworzy/zaprasza konta personelu i przypisuje im role (kelner, kuchnia); brak samodzielnej rejestracji personelu.
- **Change ID:** staff-accounts-roles
- **PRD refs:** FR-003
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Niepilny dla gwiazdy (właściciel jest nadzbiorem uprawnień i może pełnić rolę personelu na starcie), więc odłożony za ścieżkę konieczną — zgodnie z celem „szybkość".
- **Status:** proposed

### S-03: Budowa menu (pozycje, kategorie, alergeny)

- **Outcome:** właściciel tworzy i edytuje pozycje aktywnego menu — nazwa, opis, cena, kategoria — oraz oznacza tagi alergenów.
- **Change ID:** menu-items-management
- **PRD refs:** US-02, FR-004, FR-006
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-06
- **Blockers:** —
- **Unknowns:**
  - Czy tagi alergenów (bez pełnej listy składników) są wystarczające w świetle wymogów informacyjnych gastronomii? — Owner: użytkownik. Block: no.
- **Risk:** Model pozycji menu zasila i klienta (S-08), i dostępność (S-05); pole dostępności musi tu powstać z domyślną wartością, inaczej brama dostępności klienta nie zadziała.
- **Status:** done

### S-04: Zdjęcia pozycji menu z miniaturami

- **Outcome:** właściciel dodaje zdjęcia potraw do pozycji menu, a system generuje miniaturę używaną na liście pozycji.
- **Change ID:** menu-item-photos
- **PRD refs:** US-02, FR-005
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Ścieżka generowania miniatur na edge (sharp nie działa na workerd) — Supabase Storage transforms czy Cloudflare Images? — Owner: TBD. Block: no.
- **Risk:** Generowanie miniatur nie może użyć `sharp` na runtime Workerów (patrz `infrastructure.md`); zła decyzja = przeróbka. Nie blokuje zamawiania, więc równolegle do ścieżki koniecznej.
- **Status:** proposed

### S-05: Przełączanie dostępności pozycji

- **Outcome:** kelner przełącza dostępność pozycji menu (dostępna / niedostępna / wyprzedana); zmiana jest widoczna dla przeglądającego menu klienta (model pollingu, nie trwałe połączenie).
- **Change ID:** menu-availability-toggle
- **PRD refs:** FR-007
- **Prerequisites:** S-03, S-02
- **Parallel with:** S-04, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** „Czas rzeczywisty" jest świadomie zdegradowany do pollingu (per tech-stack.md); jeśli odświeżanie jest zbyt rzadkie, klient zamówi pozycję właśnie oznaczoną jako wyprzedana.
- **Status:** proposed

### S-06: Schemat sali i stoliki

- **Outcome:** właściciel projektuje schemat sali w wizualnym edytorze, dodaje stoliki, aktywuje/dezaktywuje je i identyfikuje numerem (z nazwą lokalu jako kontekstem).
- **Change ID:** room-layout-tables
- **PRD refs:** FR-008, FR-009, FR-010
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wizualny edytor to największy element UI w tej warstwie; dezaktywacja (nie usuwanie) musi zachować stały kod QR stolika — inaczej łamie guardrail trwałości QR.
- **Status:** proposed

### S-07: Stały kod QR per stolik

- **Outcome:** właściciel generuje stały kod QR przypisany na trwałe do stolika; kod nie zmienia się przy edycji menu ani cennika.
- **Change ID:** table-qr-codes
- **PRD refs:** FR-011
- **Prerequisites:** S-06
- **Parallel with:** S-03, S-04, S-05
- **Blockers:** Zamknięcie `tables_anon_read_active` jest w tym slice **blokujące, nie opcjonalne**.
  Polityka nadal brzmi `using (is_active)` bez predykatu `company_id` (lekcja
  „Anon RLS reads must be scoped by company_id"), a S-06 dopiął do tego wiersza `pos_x`, `pos_y`,
  `shape` i `room_id` — wyciekająca dla anonimowego klucza powierzchnia wzrosła z numeru i opisu
  stolika o geometrię planu sali i powiązanie ze strefami. Odłożono raz świadomie, bo scoping
  wymaga tokenu QR, który należy do tego slice'a; drugi raz odłożyć nie wolno. Źródło:
  `context/changes/room-layout-tables/reviews/impl-review.md` §F8.
- **Unknowns:** —
- **Risk:** Trwałość QR to guardrail (wydrukowane kody muszą pozostać ważne); identyfikator zakodowany w QR musi być niezależny od zmiennych danych menu/cennika.
- **Status:** proposed

### S-08: Klient zamawia ze stolika przez QR (gwiazda przewodnia)

- **Outcome:** klient skanuje stały kod QR, dostaje anonimową sesję związaną z konkretnym stolikiem, przegląda wyłącznie dostępne pozycje i składa zamówienie; może dokładać pozycje do otwartego rachunku, dopóki personel go nie zamknie.
- **Change ID:** client-qr-ordering
- **PRD refs:** US-01, FR-012, FR-015
- **Prerequisites:** S-03, S-07
- **Parallel with:** S-02, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Jak twardo związać anonimową sesję wyłącznie z jednym stolikiem, by zamówienia różnych stolików się nie mieszały? — Owner: team. Block: no.
- **Risk:** Rdzeń wartości i guardraili (anonimowa sesja nie wycieka między stolikami; brak danych innych firm). Najbardziej ryzykowny, dowodzący slice — dlatego gwiazda i sekwencjonowany tak wcześnie, jak pozwolą menu i QR.
- **Status:** proposed

### S-09: Panel personelu — statusy, rozliczenie, zamknięcie

- **Outcome:** personel prowadzi pozycje zamówienia przez statusy (nowe → w toku → zrealizowane, per pozycja, z grupowaniem), widzi podsumowanie rozliczenia (kwota i pozycje) i jawnie zamyka rachunek po opłaceniu w kasie.
- **Change ID:** staff-order-panel
- **PRD refs:** FR-014, FR-016, FR-019
- **Prerequisites:** S-08, S-02
- **Parallel with:** S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Zamknięcie rachunku odcina edycję klienta i kończy sesję stolika — błąd w tej regule albo psuje dokładanie pozycji (FR-015), albo pozwala edytować zamknięte zamówienie.
- **Status:** proposed

### S-10: Kelner tworzy i edytuje zamówienia

- **Outcome:** kelner tworzy i edytuje zamówienia w panelu personelu (równoległa ścieżka przyjęcia, dla gości którzy nie zeskanują QR).
- **Change ID:** waiter-created-orders
- **PRD refs:** FR-013
- **Prerequisites:** S-08, S-02
- **Parallel with:** S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Współdzieli model zamówienia z S-08; dwie ścieżki tworzenia (klient/kelner) na tym samym rachunku stolika muszą się nie kolidować.
- **Status:** proposed

### S-11: Kitchen display

- **Outcome:** kuchnia widzi dedykowany widok listy pozycji do przygotowania (sortowanej wg statusu) i oznacza poszczególne pozycje jako gotowe; rola kuchni nie ma dostępu do menu ani konfiguracji.
- **Change ID:** kitchen-display
- **PRD refs:** US-03, FR-017, FR-018
- **Prerequisites:** S-09
- **Parallel with:** S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Oznaczenie pozycji jako gotowej musi spójnie aktualizować status widoczny dla personelu (FR-014); rozjazd modelu statusów między kuchnią a panelem personelu rozspójnia pętlę.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                  | Ready for `/10x-plan` | Notes |
| ---------- | -------------------------- | ------------------------------------------------------ | --------------------- | ----- |
| F-01       | multitenant-rls-foundation | Fundament multi-tenant: company_id + RLS + role        | yes                   | Odblokowuje gwiazdę (S-08) przez S-01 |
| S-01       | owner-company-registration | Rejestracja firmy, logowanie i profil lokalu           | no                    | Wymaga F-01 |
| S-02       | staff-accounts-roles       | Konta personelu i przypisywanie ról                    | no                    | Wymaga S-01 |
| S-03       | menu-items-management      | Zarządzanie menu: pozycje, kategorie, alergeny         | no                    | Wymaga S-01 |
| S-04       | menu-item-photos           | Zdjęcia pozycji menu z miniaturami                     | no                    | Decyzja: Supabase transforms vs Cloudflare Images |
| S-05       | menu-availability-toggle   | Przełączanie dostępności pozycji menu                  | no                    | Wymaga S-03, S-02 |
| S-06       | room-layout-tables         | Schemat sali i zarządzanie stolikami                   | no                    | Wymaga S-01 |
| S-07       | table-qr-codes             | Stałe kody QR per stolik                               | no                    | Wymaga S-06 |
| S-08       | client-qr-ordering         | Klient zamawia ze stolika przez QR (gwiazda)           | no                    | Wymaga S-03, S-07 |
| S-09       | staff-order-panel          | Panel personelu: statusy, rozliczenie, zamknięcie      | no                    | Wymaga S-08, S-02 |
| S-10       | waiter-created-orders      | Zamówienia tworzone przez kelnera                      | no                    | Wymaga S-08, S-02 |
| S-11       | kitchen-display            | Kitchen display: lista pozycji i oznaczanie gotowych   | no                    | Wymaga S-09 |

## Open Roadmap Questions

1. **Kompletność informacji o alergenach (FR-006)** — Owner: użytkownik. Block: `S-03` (tag jako Unknown, Block: no). Czy tagi alergenów bez pełnych składników wystarczą, czy potrzebny disclaimer / przyspieszenie pełnych składników z fazy 2.
2. **Data twardego terminu** — Owner: użytkownik. Block: `roadmap-wide` (wpływa na tempo i zakres pod celem „szybkość", nie blokuje konkretnego slice'a). Do uzupełnienia w `timeline_budget.hard_deadline`.

## Parked

- **Płatności online i podział rachunku** — Why parked: PRD §Non-Goals (płatność w kasie, faza 2).
- **Fiskalizacja i integracja z POS/kasami** — Why parked: PRD §Non-Goals.
- **Zarządzanie magazynem / stany składników** — Why parked: PRD §Non-Goals.
- **Moduł rezerwacji stolików** — Why parked: PRD §Non-Goals.
- **Sieć wielu lokalizacji w ramach jednego konta** — Why parked: PRD §Non-Goals (konto = jeden lokal).
- **Wielojęzyczne menu z tłumaczeniem AI + pełne definiowanie składników** — Why parked: PRD §Non-Goals (faza 2; MVP jednojęzyczny, tagi alergenów).
- **Natywne aplikacje mobilne (iOS/Android)** — Why parked: PRD §Non-Goals (tylko responsywny web).
- **Zaawansowana analityka i raporty sprzedaży** — Why parked: PRD §Non-Goals.
- **Powiadomienia personelu/kuchni o nowym zamówieniu (dźwięk/badge)** — Why parked: shape-notes §Forward (faza 2+).
- **Warianty i dodatki do pozycji (rozmiar, sosy, „bez cebuli")** — Why parked: shape-notes §Forward (faza 2+).
- **Historia zamówień klienta w obrębie sesji stolika** — Why parked: shape-notes §Forward (faza 2+).

## Done

(Pusta przy pierwszym generowaniu. `/10x-archive` dopisze tu wpis i przełączy `Status` na `done`, gdy zmiana o pasującym Change ID zostanie zarchiwizowana.)

- **F-01: (fundament) każda tabela domenowa nosi `company_id`, polityki RLS wymuszają izolację per firma, a role personelu (właściciel/kelner/kuchnia) są reprezentowane na bazie istniejącego Supabase Auth.** — Archived 2026-07-06 → `context/archive/2026-07-04-multitenant-rls-foundation/`. Lesson: —.
- **S-01: właściciel rejestruje konto firmy, loguje się i edytuje profil lokalu (nazwa, adres, godziny otwarcia).** — Archived 2026-07-07 → `context/archive/2026-07-04-owner-company-registration/`. Lesson: —.
- **S-03: właściciel tworzy i edytuje pozycje aktywnego menu — nazwa, opis, cena, kategoria — oraz oznacza tagi alergenów.** — Archived 2026-07-17 → `context/archive/2026-07-08-menu-items-management/`. Lesson: Anon RLS reads must be scoped by company_id (context/foundation/lessons.md).
