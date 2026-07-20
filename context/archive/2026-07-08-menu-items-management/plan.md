# Menu Items Management (S-03) Implementation Plan

## Overview

Właściciel buduje aktywne menu lokalu (PRD US-02, FR-004, FR-006): kategorie z ręczną kolejnością,
pozycje z nazwą, opisem, ceną, opcjonalną kategorią, 3-stanową dostępnością i tagami 14 alergenów UE.
Zarządzanie odbywa się na jednej stronie `/menu` (dialogi + drag&drop), przez JSON API walidowane zod,
z politykami RLS zawężonymi tak, że menu edytuje wyłącznie właściciel.

## Current State Analysis

- **`menu_items` już istnieje** (F-01, `supabase/migrations/20260705215147_minimal_tables_menu.sql:26-33`):
  `id, company_id, name, price numeric(10,2), is_available boolean default true, created_at`.
  Notatka archiwizacyjna F-01: rozszerzać przez `ALTER`, nigdy nie re-CREATE.
- **RLS jest szeroki „na kredyt"**: `menu_items_staff_all` (tamże, linie 52-56) daje pełny CRUD całemu
  personelowi; zawężenie było jawnie odroczone „do S-03/S-05". PRD Access Control: menu edytuje tylko
  właściciel; kelner jedynie przełącza dostępność (to S-05).
- **Polityka anon**: `menu_items_anon_read_available` (linie 69-72) filtruje po `is_available = true`.
- **Helpery RLS** (F-01, `20260705212949_tenancy_core.sql:44-66`): `current_company_id()`,
  `current_staff_role()` — `SECURITY DEFINER`, `set search_path = ''`.
- **Trigger rejestracji** (S-01, `20260705232213_owner_registration_trigger.sql:9-29`):
  `handle_new_user()` tworzy firmę + profil ownera, warunkowo na metadanych `company_name`.
- **Test izolacji**: `supabase/tests/rls_isolation.sql` (uruchamiany `npm run test:rls`) seeduje 2 firmy
  i asertuje izolację cross-tenant + granicę anon; rollback po asercjach.
- **Wzorce aplikacji**: middleware wystawia `locals.user/company_id/role` (`src/middleware.ts`);
  `PROTECTED_ROUTES = ["/dashboard", "/settings"]`; Supabase client z `src/lib/supabase.ts` (może zwrócić
  `null`); istniejące route'y API to form-POST→redirect z ręczną walidacją (ta zmiana świadomie przechodzi
  na JSON + zod, zgodnie z AGENTS.md); polskie stringi na twardo; shadcn/ui new-york (jest tylko `button`).
- **Brak frameworka testów JS** — AGENTS.md: „add one before the first feature"; to pierwsza feature.
- **Kategorie i alergeny nie istnieją nigdzie** — nowy model danych.

## Desired End State

Zalogowany właściciel wchodzi na `/menu` i w jednym widoku: tworzy/edytuje/usuwa kategorie, układa ich
kolejność drag&drop, dodaje/edytuje pozycje (nazwa, opis, cena, kategoria, dostępność, alergeny),
układa kolejność pozycji drag&drop, archiwizuje pozycje. Nowa firma startuje z domyślnym zestawem
kategorii. Kelner/kuchnia nie mogą modyfikować menu (RLS). Anonimowy dostęp czyta tylko pozycje
niezarchiwizowane o dostępności `available`/`sold_out`.

Weryfikacja: `npm run test:rls` (rozszerzony), `npm test` (nowy Vitest), `npm run build`,
`npm run lint`, manualny przebieg CRUD + drag&drop na `/menu`.

### Key Discoveries:

- `menu_items` do rozszerzenia przez ALTER — `supabase/migrations/20260705215147_minimal_tables_menu.sql:26`
- Wzorzec polityk RLS i helperów — `supabase/migrations/20260705212949_tenancy_core.sql:44-99`
- Trigger `handle_new_user` do rozszerzenia o domyślne kategorie — `20260705232213_owner_registration_trigger.sql:9`
- Konwencja nazw polityk: `<tabela>_<operacja>_<zakres>`
- `astro:env/server` dla sekretów; API routes muszą eksportować `const prerender = false` (AGENTS.md)

## What We're NOT Doing

- **Zdjęcia pozycji i miniatury** — S-04 (`menu-item-photos`).
- **Przełączanie dostępności przez kelnera + polling klienta** — S-05; tu powstaje tylko model
  (enum 3-stanowy) i owner może ustawiać dostępność w formularzu edycji.
- **Menu klienta / QR** — S-07/S-08; polityki anon aktualizujemy, ale żaden widok anon nie powstaje.
- **Własne tagi (diety, „wegańskie")** — tylko stała lista 14 alergenów UE.
- **Pełne listy składników i formalne zamknięcie PRD Open Question #1** — mitygacja disclaimerem w UI.
- **Warianty/dodatki pozycji** — parked (faza 2+).
- **Wyrównanie starych route'ów auth do zod/JSON** — osobny dług, nie ta zmiana.

## Implementation Approach

Backend-first, wzorem S-01: (1) migracja domenowa + RLS + trigger + test izolacji, (2) warstwa API
JSON z walidacją zod i pierwszym setupem Vitest, (3) UI `/menu` jako wyspa React z dnd-kit.
Każda faza kończy się weryfikacją automatyczną i bramką manualną.

## Critical Implementation Details

- **Migracja na żywej bazie hostowanej**: zmiana `is_available boolean` → `availability enum` musi być
  wykonana jako add-column → backfill → drop-policy → drop-column → create-policy w jednej migracji
  (transakcyjnej) — inaczej okno, w którym anon widzi wszystko albo nic. Wzorem F-01 wszystkie statementy
  przeglądamy przed `db push`.
- **Widoczność anon**: `sold_out` pozostaje widoczne dla anon (FR-007 — klient musi zobaczyć zmianę na
  „wyprzedane"), `unavailable` i zarchiwizowane są ukryte. To kontrakt dla S-08.
- **Snapshot dla S-08 (kontrakt)**: przyszłe pozycje zamówień kopiują nazwę i cenę pozycji menu w momencie
  zamówienia; archiwizacja (`archived_at`) istnieje po to, by historia rachunków nie wskazywała na
  usunięte wiersze. Zapisać w lessons/notatce przy archiwizacji tej zmiany.
- **Trigger a firmy istniejące**: rozszerzony `handle_new_user` seeduje kategorie tylko nowym firmom;
  migracja robi jednorazowy backfill domyślnych kategorii dla firm bez żadnej kategorii, żeby środowiska
  dev/test miały parytet.
- **dnd-kit i wyspy Astro**: `@dnd-kit/*` działa w React 19 bez SSR-owych haczyków, ale cała lista musi
  być jedną wyspą (`client:load`) — sortable context nie może przecinać granic wysp.

## Phase 1: Fundament danych (migracja + RLS + trigger + test izolacji)

### Overview

Jedna migracja `YYYYMMDDHHmmss_menu_categories_items.sql` rozszerza model menu, zawęża RLS do ownera,
aktualizuje politykę anon i trigger rejestracji; test `rls_isolation.sql` rośnie o nowe asercje.

### Changes Required:

#### 1. Nowe typy i tabela kategorii

**File**: `supabase/migrations/<timestamp>_menu_categories_items.sql`

**Intent**: Utworzyć enum dostępności i alergenów oraz tabelę `menu_categories` z ręczną kolejnością,
w konwencjach F-01 (company_id, indeks, RLS default-deny).

**Contract**:
- `public.menu_item_availability` enum: `('available', 'unavailable', 'sold_out')`.
- `public.allergen` enum: 14 wartości UE 1169/2011 (`gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs`).
- `public.menu_categories`: `id uuid pk`, `company_id uuid not null fk companies`, `name text not null`,
  `sort_order int not null default 0`, `created_at timestamptz default now()`; indeks po `company_id`;
  częściowy unikalny indeks `(company_id, lower(name))`.
- RLS enabled; polityki: `menu_categories_select_staff` (SELECT, authenticated, `company_id = current_company_id()`),
  `menu_categories_write_owner` (INSERT/UPDATE/DELETE, authenticated, company-scope AND `current_staff_role() = 'owner'`),
  `menu_categories_anon_read` (SELECT, anon, `true` — spójnie z `companies_anon_read`).

#### 2. Rozszerzenie `menu_items` (ALTER, nie CREATE)

**File**: ta sama migracja

**Intent**: Dodać pola opisu, kategorii, alergenów, kolejności i archiwizacji; wymienić boolean
na enum dostępności bez okna niespójności; wymusić unikalność nazw wśród niezarchiwizowanych.

**Contract**:
- `ALTER TABLE public.menu_items ADD COLUMN`: `description text`, `category_id uuid references
  public.menu_categories(id) on delete set null`, `allergens public.allergen[] not null default '{}'`,
  `sort_order int not null default 0`, `archived_at timestamptz`.
- Wymiana dostępności w tej samej migracji, w kolejności „najpierw odpięcie zależności, usunięcie na
  końcu": `ADD COLUMN availability public.menu_item_availability not null default 'available'` →
  `UPDATE ... SET availability = case when is_available then 'available' else 'unavailable' end` →
  `DROP POLICY menu_items_anon_read_available` (polityka zależy od kolumny w pg_depend — zwykły
  `DROP COLUMN` skończyłby się błędem zależności, a `CASCADE` usunąłby politykę po cichu; nie używać
  CASCADE) → `DROP COLUMN is_available` → `CREATE POLICY menu_items_anon_read_visible` na nowej
  kolumnie (definicja w #3).
- Częściowy unikalny indeks: `(company_id, lower(name)) WHERE archived_at IS NULL`.
- Indeks po `category_id`.

#### 3. Zawężenie RLS `menu_items` + nowa polityka anon

**File**: ta sama migracja

**Intent**: Zamknąć jawnie odroczony dług F-01 — zapisy tylko dla ownera; anon widzi pozycje
niezarchiwizowane o dostępności `available`/`sold_out`.

**Contract**:
- `DROP POLICY menu_items_staff_all`; nowe polityki: `menu_items_select_staff` (SELECT, company-scope),
  `menu_items_write_owner` (INSERT/UPDATE/DELETE, company-scope AND owner).
- Nowa polityka anon `menu_items_anon_read_visible` (SELECT, anon):
  `archived_at is null and availability in ('available', 'sold_out')` — DROP starej i CREATE nowej
  zachodzi w sekwencji opisanej w #2 (odpięcie zależności przed usunięciem kolumny).
- `tables_staff_all` i polityki `companies`/`profiles` — bez zmian.

#### 4. Domyślne kategorie: trigger + backfill

**File**: ta sama migracja

**Intent**: Nowa firma startuje z zestawem kategorii (Przystawki, Dania główne, Desery, Napoje,
sort_order 1–4); firmy istniejące bez kategorii dostają jednorazowy backfill.

**Contract**: `CREATE OR REPLACE FUNCTION public.handle_new_user()` — po INSERT do `companies`
dochodzi INSERT 4 kategorii; warunek na `company_name` w metadanych bez zmian (S-02 nadal bezpieczne).
Po definicji funkcji: `INSERT INTO menu_categories ... SELECT ... FROM companies c WHERE NOT EXISTS
(SELECT 1 FROM menu_categories mc WHERE mc.company_id = c.id)`.

#### 5. Rozszerzenie testu izolacji

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: Guardrail izolacji pokrywa nowy model i zawężone polityki.

**Contract**: Nowe asercje: (a) owner A widzi tylko kategorie firmy A; (b) waiter nie może
INSERT/UPDATE/DELETE na `menu_items` ani `menu_categories` (nowa fixture: profil waiter w firmie A);
(c) owner może; (d) anon nie widzi pozycji `unavailable` ani zarchiwizowanych, widzi `sold_out`;
(e) dotychczasowe asercje zaktualizowane z `is_available` na `availability`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto na hosted: `npx supabase db push`
- Test izolacji przechodzi: `npm run test:rls`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Przegląd diffu migracji przed `db push` (żywa baza) — wszystkie statementy zgodne z planem
- W Supabase Studio: nowa rejestracja tworzy firmę z 4 domyślnymi kategoriami; istniejące firmy mają backfill

**Implementation Note**: Po tej fazie pauza na manualne potwierdzenie przed przejściem do fazy 2.

---

## Phase 2: Warstwa API (zod + JSON) i setup Vitest

### Overview

Współdzielone typy i schematy zod, endpointy JSON pod `/api/menu/*` (owner-only zapisy), pierwszy
framework testowy (Vitest) z testami jednostkowymi schematów.

### Changes Required:

#### 1. Współdzielone typy i schematy zod

**File**: `src/types.ts`, `src/lib/schemas/menu.ts`

**Intent**: Jedno źródło typów `MenuCategory`/`MenuItem`/`Allergen`/`Availability` (src/types.ts —
konwencja AGENTS.md) oraz schematy zod dla wejścia API: create/update pozycji i kategorii, reorder.

**Contract**:
- `zod` jako nowa dependency (`npm install zod`) — konwencja z AGENTS.md dotąd niezmaterializowana,
  pakiet nie jest zainstalowany.
- `ALLERGENS` (14 slugów) + mapa polskich etykiet; `AVAILABILITY = ['available','unavailable','sold_out']`.
- `menuItemInputSchema`: `name` (trim, 1–120), `description` (opcjonalny, ≤500), `price` (dodatnia,
  ≤2 miejsca dziesiętne), `category_id` (uuid, nullable), `availability` (enum), `allergens`
  (tablica enum, unikalne).
- `menuCategoryInputSchema`: `name` (trim, 1–80).
- `reorderSchema`: niepusta tablica uuid.

#### 2. Endpointy JSON menu

**File**: `src/pages/api/menu/index.ts`, `src/pages/api/menu/categories.ts`,
`src/pages/api/menu/categories/[id].ts`, `src/pages/api/menu/categories/reorder.ts`,
`src/pages/api/menu/items.ts`, `src/pages/api/menu/items/[id].ts`, `src/pages/api/menu/items/reorder.ts`

**Intent**: CRUD + reorder przez JSON. Odczyt (`GET /api/menu`) dla całego personelu (S-05 wykorzysta go
do pollingu), zapisy tylko owner. RLS jest egzekucją właściwą; guard w route to warstwa UX.

**Contract**:
- Każdy plik: `export const prerender = false`; uppercase `GET`/`POST`/`PUT`/`DELETE`.
- Wspólny guard: brak `locals.user` → 401; zapis bez `locals.role === 'owner'` → 403; JSON
  `{ error: string }` (komunikaty PL), sukces `{ data: ... }`; walidacja zod → 400 z pierwszym błędem.
- `GET /api/menu`: `{ categories: [...], items: [...] }` — kategorie po `sort_order`, pozycje
  niezarchiwizowane po `sort_order`; jeden payload dla wyspy.
- `DELETE /api/menu/items/[id]`: archiwizacja (`archived_at = now()`), nie DELETE.
- `DELETE /api/menu/categories/[id]`: fizyczny DELETE (FK `SET NULL` przenosi pozycje do „Bez kategorii").
- Reorder: `PUT` z uporządkowaną tablicą id → zapis `sort_order` wg pozycji w tablicy (pozycje: w obrębie
  jednej kategorii lub „Bez kategorii"; przeniesienie między kategoriami idzie przez `PUT items/[id]`
  z nowym `category_id` + reorder).
- Naruszenie unikalności nazwy (kod błędu 23505) → 409 z komunikatem PL.

#### 3. Setup Vitest + typecheck + testy jednostkowe

**File**: `package.json`, `vitest.config.ts`, `src/lib/schemas/menu.test.ts`

**Intent**: Pierwszy framework testowy w repo (wymóg AGENTS.md „przed pierwszą feature") oraz bramka
typecheck — `astro build` nie uruchamia pełnego typechecku, a projekt jest TS strict.

**Contract**: `vitest` oraz `@astrojs/check` + `typescript` jako devDependencies; skrypty
`"test": "vitest run"` i `"typecheck": "astro check"`. Testy: walidacja ceny (ujemna/3 miejsca
dziesiętne odrzucone), trim nazwy, odrzucenie nieznanego alergenu, deduplikacja/odrzucenie duplikatów
alergenów, reorder odrzuca pustą tablicę i nie-uuid.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Typecheck przechodzi: `npm run typecheck`

#### Manual Verification:

- Smoke test endpointów (curl/devtools na `npm run dev`): 401 bez sesji, 403 dla nie-ownera na zapisie,
  pełny cykl kategorii i pozycji, archiwizacja znika z `GET /api/menu`

**Implementation Note**: Po tej fazie pauza na manualne potwierdzenie przed przejściem do fazy 3.

---

## Phase 3: UI `/menu` — lista, dialogi, drag&drop

### Overview

Strona `/menu` (owner-only) z jedną wyspą React: lista pozycji pogrupowana po kategoriach, dialogi
dodawania/edycji, drag&drop kolejności kategorii i pozycji (dnd-kit), checklista alergenów
z disclaimerem, empty state, link z dashboardu.

### Changes Required:

#### 1. Routing i strona

**File**: `src/middleware.ts`, `src/pages/menu.astro`, `src/pages/dashboard.astro`

**Intent**: `/menu` chronione middlewarem; strona server-side wymusza rolę owner (redirect na
`/dashboard` dla kelnera/kuchni — wzorem guardów settings); dashboard dostaje link „Menu".

**Contract**: `PROTECTED_ROUTES` + `"/menu"`; strona renderuje layout + `<MenuManager client:load />`
z initial data z SSR (fetch przez klienta Supabase w frontmatterze) albo pustym stanem ładowania —
implementer wybiera prostsze; komunikaty PL.

#### 2. Komponenty shadcn/ui

**File**: `src/components/ui/*`

**Intent**: Doinstalować brakujące prymitywy przez `npx shadcn@latest add` (new-york):
`dialog`, `input`, `label`, `textarea`, `select`, `checkbox`, `badge`, `alert-dialog`, `card`.

**Contract**: standardowe komponenty shadcn; stylowanie łączone przez `cn()` z `@/lib/utils`.

#### 3. Wyspa MenuManager

**File**: `src/components/menu/MenuManager.tsx` + podkomponenty (`CategorySection.tsx`,
`MenuItemRow.tsx`, `MenuItemDialog.tsx`, `CategoryDialog.tsx`), hooki w `src/components/hooks/`

**Intent**: Pełny CRUD klienta API z fazy 2. Stan lokalny + refetch `GET /api/menu` po mutacjach;
optymistyczne tylko drag&drop (rollback przy błędzie). Sekcje kategorii wg `sort_order`, na końcu
„Bez kategorii"; wiersz pozycji: nazwa, cena (format `12,50 zł`), badge dostępności, badge'y alergenów.

**Contract**:
- `@dnd-kit/core` + `@dnd-kit/sortable` jako dependencies; sortowanie kategorii (pionowe) i pozycji
  w obrębie sekcji; po upuszczeniu wywołanie odpowiedniego endpointu reorder.
- Dialog pozycji: pola z `menuItemInputSchema` (walidacja klienta tym samym schematem zod), checklista
  14 alergenów z polskimi etykietami + stały disclaimer („Pełna informacja o alergenach dostępna
  u obsługi lokalu"), select kategorii z opcją „Bez kategorii", select dostępności (3 stany, PL).
- Usunięcie pozycji = `alert-dialog` potwierdzenia → archiwizacja. Usunięcie kategorii = `alert-dialog`
  z informacją, że pozycje trafią do „Bez kategorii".
- Empty state: firma ma domyślne kategorie, ale zero pozycji → zachęta „Dodaj pierwszą pozycję".
- Hooki wyciągnięte do `src/components/hooks/` (konwencja AGENTS.md).

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Testy jednostkowe nadal przechodzą: `npm test`
- Typecheck przechodzi: `npm run typecheck`

#### Manual Verification:

- Pełny przebieg właściciela: dodanie kategorii, 3+ pozycji (z opisem, ceną, alergenami), edycja,
  zmiana dostępności, archiwizacja — wszystko bez przeładowania strony
- Drag&drop kategorii i pozycji utrzymuje kolejność po odświeżeniu strony
- Usunięcie kategorii z pozycjami przenosi je do „Bez kategorii"
- Duplikat nazwy pozycji pokazuje czytelny błąd PL (409)
- Kelner (konto testowe lub podmiana roli w profilu) nie wchodzi na `/menu` (redirect) i dostaje 403 na zapisie
- Widok responsywny na mobile

**Implementation Note**: Po tej fazie pauza na manualne potwierdzenie — zamyka zmianę.

---

## Testing Strategy

### Unit Tests:

- Schematy zod: cena (ujemna, >2 miejsca), nazwa (puste/trim/za długa), alergeny (nieznany slug,
  duplikaty), reorder (pusta tablica, nie-uuid)

### Integration Tests:

- `supabase/tests/rls_isolation.sql`: izolacja cross-tenant kategorii, zapis owner-only
  (waiter INSERT/UPDATE/DELETE odrzucone), granica anon (unavailable/archived niewidoczne,
  sold_out widoczne)

### Manual Testing Steps:

1. Rejestracja nowej firmy → 4 domyślne kategorie widoczne na `/menu`
2. Budowa mini-menu: 2 kategorie własne + 5 pozycji z alergenami i różną dostępnością
3. Drag&drop kolejności; odświeżenie strony; kolejność zachowana
4. Archiwizacja pozycji → znika z listy; unikalność nazwy pozwala użyć nazwy ponownie
5. Konto waiter: `/menu` niedostępne, `PUT /api/menu/items/[id]` → 403

## Performance Considerations

Menu MVP to dziesiątki wierszy — jeden payload `GET /api/menu` bez paginacji wystarcza i będzie tanim
celem pollingu w S-05. Reorder zapisuje `sort_order` wsadowo (jedno żądanie na operację drag).

## Migration Notes

Migracja idzie na żywą hostowaną bazę (wzorzec F-01/S-01: `npx supabase db push` po przeglądzie diffu).
Wszystkie zmiany są addytywne poza: DROP `is_available` (po backfillu w tej samej migracji), DROP starych
polityk (natychmiast zastąpione). Trigger `handle_new_user` jest `CREATE OR REPLACE` — bez downtime.
Backfill domyślnych kategorii jest idempotentny (`WHERE NOT EXISTS`).

## References

- Roadmapa S-03: `context/foundation/roadmap.md:119-130`
- PRD: US-02, FR-004, FR-006, Access Control — `context/foundation/prd.md`
- Model wyjściowy: `supabase/migrations/20260705215147_minimal_tables_menu.sql`
- Wzorzec RLS/helpery: `supabase/migrations/20260705212949_tenancy_core.sql`
- Trigger rejestracji: `supabase/migrations/20260705232213_owner_registration_trigger.sql`
- Poprzedni plan (wzorzec faz): `context/archive/2026-07-04-owner-company-registration/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fundament danych (migracja + RLS + trigger + test izolacji)

#### Automated

- [x] 1.1 Migracja aplikuje się czysto na hosted: `npx supabase db push` — 6ed4de8
- [x] 1.2 Test izolacji przechodzi: `npm run test:rls` — 6ed4de8
- [x] 1.3 Build przechodzi: `npm run build` — 6ed4de8

#### Manual

- [x] 1.4 Przegląd diffu migracji przed `db push` — statementy zgodne z planem — 6ed4de8
- [x] 1.5 Nowa rejestracja tworzy firmę z 4 domyślnymi kategoriami; istniejące firmy mają backfill — 6ed4de8

### Phase 2: Warstwa API (zod + JSON) i setup Vitest

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą: `npm test` — c30bbbf
- [x] 2.2 Lint przechodzi: `npm run lint` — c30bbbf
- [x] 2.3 Build przechodzi: `npm run build` — c30bbbf
- [x] 2.4 Typecheck przechodzi: `npm run typecheck` — c30bbbf

#### Manual

- [x] 2.5 Smoke test endpointów: 401/403/pełny cykl CRUD/archiwizacja znika z `GET /api/menu` — 2ba736a

### Phase 3: UI `/menu` — lista, dialogi, drag&drop

#### Automated

- [x] 3.1 Lint przechodzi: `npm run lint` — 2ba736a
- [x] 3.2 Build przechodzi: `npm run build` — 2ba736a
- [x] 3.3 Testy jednostkowe nadal przechodzą: `npm test` — 2ba736a
- [x] 3.4 Typecheck przechodzi: `npm run typecheck` — 2ba736a

#### Manual

- [x] 3.5 Pełny przebieg CRUD właściciela bez przeładowania strony — 2ba736a
- [x] 3.6 Drag&drop kategorii i pozycji trwały po odświeżeniu — 2ba736a
- [x] 3.7 Usunięcie kategorii przenosi pozycje do „Bez kategorii" — 2ba736a
- [x] 3.8 Duplikat nazwy → czytelny błąd PL — 2ba736a
- [x] 3.9 Waiter: brak dostępu do `/menu` i 403 na zapisie — 2ba736a
- [x] 3.10 Widok responsywny na mobile — 2ba736a
