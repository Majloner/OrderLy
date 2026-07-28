# Schemat sali i stoliki (S-06) — Implementation Plan

## Overview

Rozbudowa istniejącego zaczątka `tables` z F-01 do pełnej funkcji schematu sali: nowa encja
`rooms` (strefy/sale), stoliki pozycjonowane swobodnie w pikselach na skalowanym logicznym
kanwasie, kształt stolika, zapisy wyłącznie dla właściciela oraz cykl życia
„dezaktywuj, nigdy nie usuwaj" — tak by przyszły stały kod QR (S-07) pozostał na trwałe ważny.

Realizuje PRD FR-008 (wizualny edytor sali), FR-009 (aktywacja/dezaktywacja stolików),
FR-010 (numer jako pierwotny identyfikator stolika w obrębie firmy + opcjonalny opis).

## Current State Analysis

**Warstwa danych** — `public.tables` istnieje od F-01 i od tamtej pory nie było na niej
żadnego `ALTER`:

- `supabase/migrations/20260705215147_minimal_tables_menu.sql:15` — kolumny
  `id, company_id, number, label, is_active, created_at`. Brak kolumn układu (pozycja, kształt),
  brak `sort_order`, brak unikalności `(company_id, number)`. Jedyny indeks to nieunikalny
  `tables_company_id_idx` (`:24`).
- Nagłówek tej migracji (`:5-6`) wprost stwierdza, że S-06 ma robić `ALTER`, nie odtwarzać tabeli.
- **Dług RLS #1**: `tables_staff_all` (`:46-50`) to nadal `for all to authenticated` — kelner może
  dziś tworzyć i usuwać stoliki. S-03 zostawił komentarz o zawężeniu „w S-03/S-05" (`:43-45`) i
  zrealizował ten wzorzec dla menu.
- **Dług RLS #2**: `tables_anon_read_active` (`:64-67`) to `using (is_active)` — bez predykatu
  `company_id`. To otwarta lekcja `context/foundation/lessons.md:5-20`, która wprost wymienia
  `tables`. **Decyzja tego planu: nie ruszamy jej** (patrz Open Risks) — dostęp anon dla ścieżki QR
  projektuje S-07.
- Wzorzec zawężania do 4 polityk per-operacja jest gotowy do skopiowania:
  `20260708124756_menu_categories_items.sql:111-141`.
- Wzorzec unikalności nazwy w obrębie firmy: `menu_categories_company_name_idx`
  (`20260708124756_menu_categories_items.sql:35-36`).
- Rozwiązywanie firmy/roli w SQL: `public.current_company_id()` i `public.current_staff_role()`
  (`20260705212949_tenancy_core.sql:44-66`), idiom właściciela to
  `public.current_staff_role() = 'owner'`. Nie ma funkcji `is_owner()`.
- Trigger rejestracji `public.handle_new_user()` (aktualna wersja:
  `20260708124756_menu_categories_items.sql:146-173`) zakłada firmę, profil właściciela i
  4 domyślne kategorie menu — to wzorzec seedowania domyślnych danych dla nowej firmy.
- Ostatni timestamp migracji: `20260722100000`.

**Warstwa aplikacji** — cienka i bardzo spójna:

- Brak warstwy serwisów. Route'y odpytują `guard.supabase` bezpośrednio, a `company_id` na
  odczytach/aktualizacjach nakłada wyłącznie RLS (żadnych `.eq("company_id", …)`); przy insertach
  kolumna podawana jest jawnie: `company_id: guard.companyId`.
- `guardMenuRequest(context, { write })` — `src/lib/api.ts:29`; zwraca
  `{ error: Response } | { supabase, companyId }`, dyskryminowane przez `if ("error" in guard)`.
  Kody: 401 brak sesji, 403 nie-właściciel przy zapisie, 403 brak firmy, 500 brak Supabase.
- Koperty odpowiedzi: `{ data }` / `{ error: "<komunikat PL>" }` (`src/lib/api.ts:7`, `:14`).
  Brak pól `code`/`details`.
- `parseBody` (`:70`) zwraca tylko pierwszy komunikat zod: `parsed.error.issues[0]?.message`.
  `isUniqueViolation` (`:89`) → `code === "23505"`, mapowane na 409.
- 404 realizowane przez `.select("*")` bez `.single()` i sprawdzenie `data.length === 0`
  (`src/pages/api/menu/categories/[id].ts:38-42`) — RLS sprawia, że cudzy wiersz jest po prostu
  „nieobecny".
- Zod: `src/lib/schemas/menu.ts` — konwencja `<entity>InputSchema`, **bez `.strict()`**, bez
  koercji, zod v4 (`z.uuid(msg)`, `z.enum(ARR, msg)`), komunikaty po polsku, typy jako
  `z.output<typeof …>`. Schematy współdzielone serwer+klient.
- Typy: `src/types.ts` — interfejsy PascalCase z polami **snake_case 1:1 z kolumnami DB**; enumy
  jako trójka `as const` + union + `_LABELS` (`:4-13`). Brak konwencji `*Dto`/`*Command`.
  **Dla `tables` nie istnieje dziś żaden typ TS.**
- Stan w React: `useState` + własny `callMenuApi` (`src/components/hooks/useMenu.ts:11`).
  Bez react-query/SWR, bez tostów. Błędy dwoma kanałami: banner `actionError` w managerze i
  lokalny `error` w dialogu. Mutacje kończą się `await refetch()` — **jedyna mutacja
  optymistyczna to reorder z rollbackiem** (`src/components/menu/MenuManager.tsx:153`).
- dnd-kit (`@dnd-kit/core`, `/sortable`, `/utilities`) jest zainstalowany, ale używany
  **wyłącznie do sortowania list pionowych** (`SortableContext` + `verticalListSortingStrategy` +
  `arrayMove`, utrwalane RPC `reorder_*` z płaską tablicą uuid). Brak `@dnd-kit/modifiers`,
  brak `DragOverlay`, brak `KeyboardSensor`. **Swobodny kanwas 2D to w tym repo nowy wzorzec.**
- Middleware: `src/middleware.ts:4` `PROTECTED_ROUTES = ["/dashboard", "/settings", "/menu"]`,
  `:7` `OWNER_ROUTES = ["/menu"]`. Ścieżki `/api/**` nie są w żadnej z list — autoryzacja API
  żyje w guardzie.
- Wzorzec strony-wyspy: `src/pages/menu.astro` — brak gating w frontmatterze (robi to
  middleware), `client:load`, shell `Layout` + gradientowy `h1` + link „← Powrót do panelu".
- shadcn/ui obecne: `alert-dialog, badge, button, checkbox, dialog, input, label, select, textarea`
  — **wszystko, czego ten slice potrzebuje; nic nie trzeba dodawać.**
- Testy: vitest tylko unit (`vitest.config.ts`, `include: ["src/**/*.test.ts"]`), jeden plik
  `src/lib/schemas/menu.test.ts`. Brak Playwright, brak testów komponentów.
  `supabase/tests/rls_isolation.sql` pokrywa `tables` **tylko na odczyt** (fixture `:38-42`,
  asercje `:65`/`:71` i `:160-161`/`:168`) — **zero asercji zapisu**.

**Ograniczenie pracy równoległej** (z `change.md`): gałąź S-02 (`staff-accounts-roles`) dotyka
`src/lib/api.ts`. Nie refaktoryzujemy tam guarda do wspólnego helpera; własny guard trafia do
**nowego** modułu. Pliki append-only do scalenia z S-02: `src/middleware.ts`,
`src/pages/dashboard.astro`, `src/types.ts`, `supabase/tests/rls_isolation.sql`.

## Desired End State

Zalogowany właściciel wchodzi na `/room` i widzi zakładki sal (po rejestracji jedna: „Sala
główna"). Może dodać/przemianować salę oraz usunąć salę pustą. W obrębie sali dodaje stolik
(numer, opcjonalny opis, kształt), przeciąga go po kanwasie — mysz albo palec — a pozycja zapisuje
się natychmiast. Stolik można dezaktywować (renderuje się przygaszony) i ponownie aktywować;
**nie da się go usunąć — ani z UI, ani przez API, ani przez RLS.** Numer stolika jest unikalny w
obrębie firmy; próba duplikatu daje czytelny komunikat 409. Kelner i kuchnia nie mogą nic zapisać;
firma A nigdy nie widzi sal ani stolików firmy B.

Weryfikacja: `npm run test` (schematy + geometria), `npm run test:rls` (izolacja + nowe asercje
zapisu na `tables` i `rooms`), `npm run typecheck`, `npm run lint`, plus scenariusze manualne
z sekcji Testing Strategy.

### Key Discoveries:

- `public.tables` już istnieje i **musi być zmieniana przez `ALTER`**
  (`supabase/migrations/20260705215147_minimal_tables_menu.sql:5-6, :15`).
- Wzorzec zawężenia RLS do 4 polityk per-operacja:
  `20260708124756_menu_categories_items.sql:111-141`.
- Wzorzec seedowania domyślnych danych nowej firmy: `handle_new_user()` +
  idempotentny backfill (`20260708124756_menu_categories_items.sql:146-179`).
- `supabase/tests/rls_isolation.sql:38` wstawia `tables` **bez sali** — `room_id NOT NULL`
  rozwali ten fixture, jeśli go nie zaktualizujemy w tej samej fazie.
- Optymistyczna mutacja z rollbackiem: `src/components/menu/MenuManager.tsx:153` (`persistReorder`).
- dnd-kit użyty tu dotąd tylko przez `useSortable`; kanwas swobodny potrzebuje `useDraggable`.
- `src/lib/api.ts:58` `categoryExistsInCompany` — wzorzec walidacji FK w granicach RLS
  (FK sprawdzany przez DB obchodziłby RLS, więc istnienie sprawdzamy zapytaniem).

## What We're NOT Doing

- **Nie generujemy kodów QR** — to S-07. Ten slice nie dodaje żadnej kolumny QR/tokenu.
- **Nie naprawiamy `tables_anon_read_active`** — świadome odroczenie do S-07 (patrz Open Risks).
- **Nie dodajemy polityki anon dla `rooms`** — nowa tabela startuje bez dostępu anonimowego.
- **Nie ma ścieżki usuwania stolika** — brak endpointu `DELETE`, brak polityki `delete` w RLS.
- **Nie ma zoomu ani panoramowania** kanwasu; jedna logiczna przestrzeń współrzędnych na salę.
- **Nie ma zmiany rozmiaru stolika ani liczby miejsc** — kształt ma stały footprint; `seats` nie
  występuje w FR-008–FR-010.
- **Nie ma blokowania nachodzenia stolików** — dozwolone, ograniczamy tylko do granic kanwasu.
- **Nie ma `sort_order` na stolikach** — porządek wizualny daje pozycja, nie lista.
- **Nie refaktoryzujemy `src/lib/api.ts`** (konflikt z gałęzią S-02).
- **Nie dotykamy menu, dostępności ani zamówień.**

## Implementation Approach

Kolejność klasyczna: dane → API → UI użytkowe → UI wizualne. Faza 1 domyka dług RLS i stawia
model danych w jednej transakcyjnej migracji. Faza 2 dokłada typy, schematy zod i route'y, w tym
dedykowany, lekki endpoint pozycji pod gorącą ścieżkę przeciągania. Faza 3 dowozi **działającą
stronę `/room` bez kanwasu** (zakładki sal, CRUD sal, dialog stolika, aktywacja) — slice ma
wartość nawet jeśli faza 4 się przesunie. Faza 4 dokłada wizualny edytor: czystą, testowaną
geometrię + `useDraggable` z parytetem dotyku.

Trzy decyzje podjęte w planie bez pytania, wyprowadzone z guardraili PRD:

1. **Brak polityki `delete` na `tables`** — domyślna odmowa RLS czyni twarde usunięcie stolika
   strukturalnie niemożliwym dla każdej roli personelu. To najmocniejsza możliwa realizacja
   guardraila trwałości QR: nie polegamy na dyscyplinie warstwy aplikacji.
2. **`tables.room_id` z `on delete restrict`** — sala z choćby jednym stolikiem nie może zostać
   usunięta na poziomie DB; API mapuje naruszenie FK (`23503`) na 409. Usuwalne są tylko sale puste.
3. **Unikalność `number` per firma** — FR-010 czyni numer pierwotnym identyfikatorem stolika
   w obrębie firmy, więc `unique (company_id, number)` + 409 przez istniejące `isUniqueViolation`.

## Critical Implementation Details

**Kolejność w migracji.** `room_id NOT NULL` wymaga trzech kroków w jednej transakcji: dodaj
kolumnę jako nullable → zaseeduj po jednej domyślnej sali na firmę i zbackfilluj → `set not null`.
Unikalny indeks `(company_id, number)` trzeba poprzedzić deterministycznym rozbrojeniem duplikatów
w danych dev (repo jest podłączone do hostowanej bazy, w której mogą istnieć zdublowane numery) —
w przeciwnym razie migracja padnie na tworzeniu indeksu. Zawężenie polityk wymaga najpierw
`drop policy tables_staff_all`, bo `for all` przykrywa polityki per-operacja.

**Konwersja skali (jedyna nieoczywista matematyka).** Współrzędne są zapisywane w logicznej
przestrzeni 1200×800, ale kanwas renderuje się przeskalowany do szerokości kontenera. Delta z
dnd-kit przychodzi w **pikselach wyrenderowanych**, więc przed zapisem trzeba ją podzielić przez
współczynnik skali, a przy renderowaniu pozycję pomnożyć. Pomyłka w kierunku konwersji daje
stolik, który „ucieka" spod kursora proporcjonalnie do rozmiaru okna — objaw łatwy do przeoczenia
na dokładnie 1200 px szerokości. Dlatego geometria mieszka w czystym, testowanym modułem
`src/lib/room-geometry.ts`, a nie w komponencie.

**Parytet dotyku.** Na węźle przeciąganym musi być `touch-action: none` (klasa `touch-none`),
inaczej przeglądarka mobilna przewinie stronę zamiast rozpocząć drag — `PointerSensor` nigdy nie
dostanie zdarzeń. To ten sam powód, dla którego uchwyty w menu mają `touch-none`
(`src/components/menu/MenuItemRow.tsx:48`). Jeśli `PointerSensor` okaże się zawodny na iOS
Safari, alternatywą jest dołożenie `TouchSensor` obok niego — nie odwrotnie.

**Wyścig przy szybkim przeciąganiu.** Zapis jest per-upuszczenie, więc dwa szybkie dragi tego
samego stolika mogą dojechać w odwrotnej kolejności i utrwalić starszą pozycję. Utrzymuj
`AbortController` per `table.id` i przerwij poprzedni żądanie zanim wyślesz nowe — przerwanie
nie może być pokazywane jako błąd (wzorzec detekcji: `DOMException` o `name === "AbortError"`,
`src/components/menu/MenuItemDialog.tsx:156`).

**Fixture testowy pęknie.** `supabase/tests/rls_isolation.sql:38-42` wstawia `tables` bez
`room_id`. Faza 1 musi dodać fixture sal i uzupełnić te inserty, inaczej `npm run test:rls`
przestanie przechodzić natychmiast po migracji.

---

## Phase 1: Fundament danych — `rooms`, kolumny układu, zawężenie RLS

### Overview

Jedna migracja: nowa encja `rooms` z politykami owner-only, rozszerzenie `tables` o `room_id`
(NOT NULL po backfillu), pozycję i kształt, unikalny numer w firmie, zawężenie
`tables_staff_all` do polityk per-operacja **bez polityki delete**, rozszerzenie triggera
rejestracji o domyślną salę. Plus rozszerzenie testu izolacji o `rooms` i o brakujące asercje
zapisu na `tables`.

### Changes Required:

#### 1. Migracja układu sali

**File**: `supabase/migrations/20260727120000_room_layout_tables.sql`

**Intent**: Postawić model danych schematu sali i domknąć dług RLS na `tables` odziedziczony
z F-01. Wszystko w jednej migracji, bo `room_id NOT NULL` i backfill nie dają się rozdzielić.

**Contract**:

- `create type public.table_shape as enum ('square', 'circle', 'rectangle');`
- `public.rooms`: `id uuid pk default gen_random_uuid()`,
  `company_id uuid not null references public.companies (id) on delete cascade`,
  `name text not null`, `sort_order int not null default 0`,
  `created_at timestamptz not null default now()`. Indeks `rooms_company_id_idx`
  oraz unikalny `rooms_company_name_idx on public.rooms (company_id, name)` — wzorzec
  `menu_categories_company_name_idx`.
- RLS na `rooms`: `enable row level security` + cztery polityki wg konwencji nazw
  `rooms_select_staff` (`to authenticated`, `company_id = public.current_company_id()`),
  `rooms_insert_owner`, `rooms_update_owner`, `rooms_delete_owner` (każda z warunkiem
  `and public.current_staff_role() = 'owner'`; INSERT tylko `with check`, UPDATE `using` +
  `with check`, DELETE tylko `using`). **Żadnej polityki `to anon`.**
- `alter table public.tables`: `add column room_id uuid references public.rooms (id) on delete restrict`
  (na razie nullable), `add column pos_x int not null default 0`,
  `add column pos_y int not null default 0`,
  `add column shape public.table_shape not null default 'square'`.
- Seed + backfill: dla każdej firmy bez sali wstaw `('Sala główna', sort_order 0)`; następnie
  `update public.tables set room_id = <domyślna sala firmy> where room_id is null`; następnie
  `alter table public.tables alter column room_id set not null`. Backfill idempotentny (wzorzec
  `20260708124756_menu_categories_items.sql:177-179`) i obejmujący **wszystkie** firmy, także
  te bez stolików, żeby nowe rejestracje i dev były na równi.
- Deduplikacja numerów przed indeksem: deterministyczne przenumerowanie kolizji
  `(company_id, number)` (np. porządek po `created_at, id`, nadmiarowym rekordom nadaj kolejne
  wolne numery), potem
  `create unique index tables_company_number_idx on public.tables (company_id, number);`
- Zawężenie polityk: `drop policy tables_staff_all on public.tables;` i utworzenie
  `tables_select_staff`, `tables_insert_owner`, `tables_update_owner` — dokładnie wg wzorca
  `20260708124756_menu_categories_items.sql:111-141`. **Świadomie nie tworzymy
  `tables_delete_owner`**: domyślna odmowa RLS realizuje guardrail trwałości QR strukturalnie.
  Zostaw komentarz wyjaśniający, że brak polityki delete jest celowy.
- `tables_anon_read_active` zostaje nietknięta; dodaj komentarz odsyłający do
  `context/foundation/lessons.md:5-20` i do S-07 jako właściciela poprawki.
- `create or replace function public.handle_new_user()` — odtwórz aktualne ciało
  (`20260708124756_menu_categories_items.sql:146-173`) i dołóż insert domyślnej sali
  `('Sala główna', 0)` dla nowo utworzonej firmy.

#### 2. Rozszerzenie testu izolacji

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: Naprawić fixture, który pęknie pod `room_id NOT NULL`, i domknąć lukę
„`tables` bez asercji zapisu" — dziś żadna asercja nie sprawdza, kto może pisać do stolików.

**Contract**: Fixture — dodaj sale z jawnymi uuid (po jednej dla firmy A i B) przed insertem
`tables` z `:38` i uzupełnij te inserty o `room_id`. Nowe asercje, w idiomie pliku
(`set local role authenticated` + `request.jwt.claims`, `raise exception 'FAIL …'`):
właściciel A tworzy i aktualizuje stolik oraz salę; kelner A czyta stoliki, ale INSERT rzuca
naruszenie polityki, a UPDATE/DELETE daje `row_count = 0`; właściciel A nie może zapisać ani
odczytać wiersza firmy B; **żadna rola personelu nie może usunąć stolika** (brak polityki delete
→ `row_count = 0` również dla właściciela); duplikat `(company_id, number)` w obrębie firmy
rzuca `23505`; sala z stolikiem nie daje się usunąć (`23503`). Zaktualizuj liczby w istniejących
asercjach `:65`/`:71` i `:160-161`/`:168`, jeśli nowe fixture'y zmienią liczbę wierszy.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npm run db:push`
- Test izolacji przechodzi (w tym nowe asercje zapisu): `npm run test:rls`
- Typy i lint bez regresji: `npm run typecheck` oraz `npm run lint`

#### Manual Verification:

- W Supabase Studio `public.tables` ma `room_id NOT NULL`, `pos_x`, `pos_y`, `shape`, a każdy
  istniejący wiersz wskazuje na salę swojej firmy
- Lista polityk na `tables` to dokładnie `tables_select_staff`, `tables_insert_owner`,
  `tables_update_owner`, `tables_anon_read_active` — **bez polityki delete**
- Rejestracja nowej firmy zakłada salę „Sala główna" (obok domyślnych kategorii menu)

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych, zanim przejdziesz do fazy 2.

---

## Phase 2: API, typy i schematy

### Overview

Typy domenowe, schematy zod z testami jednostkowymi, moduł geometrii z clampowaniem oraz route'y
`/api/room/**` z własnym guardem właściciela w nowym pliku — tak by nie dotykać
`src/lib/api.ts` równolegle z gałęzią S-02.

### Changes Required:

#### 1. Typy domenowe

**File**: `src/types.ts` (append)

**Intent**: Dołożyć typy sal i stolików w konwencji pliku, żeby route'y i wyspa React miały
wspólny kontrakt.

**Contract**: Trójka enumów wg wzorca `:4-13` — `TABLE_SHAPES = ["square","circle","rectangle"] as const`,
`TableShape`, `TABLE_SHAPE_LABELS: Record<TableShape, string>` (etykiety PL).
`interface Room { id; company_id; name; sort_order: number; created_at }`.
`interface RoomTable { id; company_id; room_id; number: number; label: string | null;
shape: TableShape; pos_x: number; pos_y: number; is_active: boolean; created_at }` — pola
snake_case 1:1 z kolumnami. `interface RoomLayoutPayload { rooms: Room[]; tables: RoomTable[] }`
jako agregat dla `GET /api/room`. Nazwa `RoomTable`, nie `Table`, żeby nie kolidować z przyszłym
komponentem shadcn `table`.

#### 2. Moduł geometrii

**File**: `src/lib/room-geometry.ts`

**Intent**: Wydzielić logiczną przestrzeń współrzędnych, footprinty kształtów i clampowanie do
granic kanwasu jako czyste funkcje — używane zarówno przez route (walidacja serwerowa), jak i
przez kanwas w fazie 4. Konwersja skali dołoży się w fazie 4 do tego samego modułu.

**Contract**: Eksportuje `LOGICAL_CANVAS = { width: 1200, height: 800 }`,
`SHAPE_FOOTPRINTS: Record<TableShape, { width: number; height: number }>`
(`square` i `circle` 80×80, `rectangle` 140×80) oraz
`clampPosition(pos: { pos_x: number; pos_y: number }, shape: TableShape): { pos_x: number; pos_y: number }`
przycinające do `[0, width - footprint.width]` × `[0, height - footprint.height]` i zwracające
liczby całkowite. Clamp jest **autorytatywny na serwerze** — klient nie może wypchnąć stolika
poza kanwas.

#### 3. Schematy zod

**File**: `src/lib/schemas/room.ts`

**Intent**: Walidacja wejścia współdzielona serwer+klient, w konwencji `src/lib/schemas/menu.ts`.

**Contract**: `roomInputSchema` — `name` po trimie 1–60 znaków. `tableInputSchema` — `room_id`
(`z.uuid`), `number` całkowity 1–999, `label` `.nullish().transform()` → `null`, `shape`
`z.enum(TABLE_SHAPES, …)`, `pos_x`/`pos_y` całkowite w granicach `LOGICAL_CANVAS`,
`is_active` boolean. `tablePositionSchema` — tylko `pos_x`/`pos_y` w tych samych granicach
(lekki payload gorącej ścieżki drag). Bez `.strict()`, bez koercji, komunikaty po polsku,
typy eksportowane jako `z.output<typeof …>`.

#### 4. Guard i helpery route'ów

**File**: `src/lib/room-api.ts`

**Intent**: Własny guard właściciela z komunikatem właściwym dla sali oraz sprawdzenie
przynależności sali do firmy — w **nowym** pliku, bo `src/lib/api.ts` jest równolegle zmieniany
na gałęzi S-02 (`change.md`).

**Contract**: `guardTablesRequest(context: APIContext, options: { write: boolean })` o **identycznym
kształcie zwrotki i identycznej kolejności kontroli** jak `guardMenuRequest` (`src/lib/api.ts:29`),
z komunikatem 403 właściwym dla schematu sali. `roomExistsInCompany(supabase, roomId): Promise<boolean>`
— wzorzec `categoryExistsInCompany` (`src/lib/api.ts:58`); istnienie sprawdzamy zapytaniem w
granicach RLS, bo FK sprawdzany przez DB obchodziłby RLS. `jsonData`, `jsonError`, `parseBody`,
`isUniqueViolation` są **importowane** z `src/lib/api.ts` bez jego edycji.

#### 5. Route'y

**File**: `src/pages/api/room/index.ts`, `rooms.ts`, `rooms/[id].ts`, `tables.ts`,
`tables/[id].ts`, `tables/[id]/position.ts`

**Intent**: Pełny CRUD sal (bez usuwania niepustych) i stolików (bez usuwania w ogóle) plus
lekki endpoint pozycji dla przeciągania.

**Contract**: Każdy plik: `export const prerender = false`, guard jako pierwszy krok,
`parseBody` do walidacji, `company_id: guard.companyId` jawnie przy insertach, brak
`.eq("company_id", …)` na odczytach (RLS), 404 przez `.select("*")` + `data.length === 0`,
`idSchema = z.uuid()` na parametrze ścieżki.

- `GET /api/room` → `{ data: RoomLayoutPayload }`; `Promise.all` dwóch zapytań, sale
  `.order("sort_order").order("name")`, stoliki `.order("number")`; jeden wspólny 500 przy błędzie
  (wzorzec `src/pages/api/menu/index.ts:13-22`). Guard `{ write: false }`.
- `POST /api/room/rooms` → 201 `{ data: Room }`; 409 przy `23505` (duplikat nazwy sali).
- `PUT /api/room/rooms/[id]` → zmiana nazwy. `DELETE /api/room/rooms/[id]` → 200 `{ data: { id } }`,
  ale **409 przy `23503`** (sala ma stoliki; `on delete restrict`) z komunikatem wyjaśniającym,
  że stoliki trzeba najpierw przenieść.
- `POST /api/room/tables` → 201 `{ data: RoomTable }`; przed insertem `roomExistsInCompany`
  (400 przy obcej/nieistniejącej sali, wzorzec `src/pages/api/menu/items.ts:30`); pozycja przez
  `clampPosition`; 409 przy `23505` (duplikat numeru w firmie).
- `PUT /api/room/tables/[id]` → pełna aktualizacja z `tableInputSchema`, w tym `is_active`
  (aktywacja/dezaktywacja, FR-009) i `room_id` (przeniesienie między salami); ta sama walidacja
  sali, clamp i 409.
- `PATCH /api/room/tables/[id]/position` → `tablePositionSchema`, clamp, zwraca
  `{ data: RoomTable }`. **Brak `DELETE` na stolikach w całym drzewie** — świadomie, spójnie
  z brakiem polityki delete w RLS.

#### 6. Testy jednostkowe

**File**: `src/lib/schemas/room.test.ts`

**Intent**: Przypiąć reguły walidacji, w konwencji `src/lib/schemas/menu.test.ts`.

**Contract**: `describe` per schemat; przypadki graniczne: numer 0 i 1000 odrzucone, numer
niecałkowity odrzucony, nieznany `shape` odrzucony, `label` pusty/`undefined` → `null`,
`pos_x`/`pos_y` poza `LOGICAL_CANVAS` odrzucone, nazwa sali po trimie pusta odrzucona.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm run test`
- Typy przechodzą: `npm run typecheck`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- `GET /api/room` zwraca sale i stoliki tylko własnej firmy
- Utworzenie stolika z numerem już istniejącym w firmie daje 409 z czytelnym komunikatem PL
- `DELETE` na sali z stolikami daje 409; na sali pustej — 200
- Zalogowany kelner dostaje 403 na każdym zapisie, a 200 na `GET /api/room`
- `PATCH …/position` z współrzędnymi poza kanwasem zapisuje wartość przyciętą, nie odrzuca żądania

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych, zanim przejdziesz do fazy 3.

---

## Phase 3: Strona `/room` — sale, stoliki, aktywacja (bez kanwasu)

### Overview

Działająca strona zarządzania: zakładki sal, CRUD sal, dialog stolika i przełączanie
aktywności — w formie listy. Slice ma tu już wartość użytkową; kanwas dokłada faza 4.

### Changes Required:

#### 1. Rejestracja trasy

**File**: `src/middleware.ts`

**Intent**: `/room` jest stroną właściciela, tak jak `/menu`.

**Contract**: Dopisz `"/room"` do `PROTECTED_ROUTES` (`:4`) i do `OWNER_ROUTES` (`:7`).
Plik jest współdzielony z gałęzią S-02 — zmiana wyłącznie append, bez przenoszenia linii.

#### 2. Wejście z panelu

**File**: `src/pages/dashboard.astro`

**Intent**: Dać właścicielowi wejście na nową stronę.

**Contract**: W bloku widocznym tylko dla właściciela (`:19-28`) dodaj link do `/room` obok
istniejącego linku do `/menu`, w tym samym stylu kafla. Zmiana append-only (konflikt z S-02).

#### 3. Shell strony

**File**: `src/pages/room.astro`

**Intent**: Skopiować shell `src/pages/menu.astro` i zhydratyzować wyspę.

**Contract**: `Layout title="Schemat sali"`, gradientowy `h1`, link „← Powrót do panelu",
`<RoomLayoutManager client:load />`. Brak gatingu w frontmatterze (robi to middleware); brak
propsów env — ten slice nie dotyka Storage. Pamiętaj o zakazie top-level `return` we
frontmatterze (`src/pages/settings.astro:7`).

#### 4. Hook danych

**File**: `src/components/hooks/useRoomLayout.ts`

**Intent**: Odwzorować `useMenu` dla nowej domeny.

**Contract**: `callRoomApi<T>(method, url, body?, signal?)` rozpakowujące `{ data }` i rzucające
`new Error(envelope?.error ?? …)` przy `!response.ok` — wzorzec `src/components/hooks/useMenu.ts:11`.
`useRoomLayout()` zwracające `{ layout, setLayout, loadError, refetch, reload }`; ładowanie w
`useEffect` z gwardią `cancelled`; `refetch` **rzuca** (błąd trafia do akcji), `reload` łapie do
`loadError` (panel z „Spróbuj ponownie").

#### 5. Wyspa i komponenty

**File**: `src/components/room/RoomLayoutManager.tsx`, `RoomTabs.tsx`, `RoomDialog.tsx`,
`TableDialog.tsx`, `TableList.tsx`

**Intent**: Jedyny stanowy orkiestrator + prezentacyjne dzieci, dokładnie jak
`MenuManager` + `CategorySection`/`MenuItemRow`/dialogi.

**Contract**: `RoomLayoutManager` to jedyny `export default` (wejście wyspy); trzyma
`activeRoomId`, `actionError` i stan dialogów; mutacje kończą się `await refetch()`; błędy akcji
w bannerze inline, błędy formularza w stanie lokalnym dialogu (funkcje zapisu **nie łapią**
wyjątku, żeby propagował do formularza). `RoomTabs` — wybór aktywnej sali + „Dodaj salę";
`RoomDialog` — nazwa sali (create/rename) + usunięcie z `alert-dialog` i obsługą 409
„sala ma stoliki"; `TableDialog` — numer, opcjonalny opis, kształt (`select`), sala,
`is_active` (`checkbox`); `TableList` — wiersze stolików aktywnej sali z akcjami Edytuj /
Aktywuj-Dezaktywuj, **bez akcji usuwania**. Stan formularzy resetowany przez unmount Radix, nie
efektem (`src/components/menu/CategoryDialog.tsx:23`). Komponenty shadcn są już w repo.

### Success Criteria:

#### Automated Verification:

- Typy przechodzą: `npm run typecheck`
- Lint (w tym `jsx-a11y` i `react-hooks`) przechodzi: `npm run lint`
- Build SSR przechodzi: `npm run build`

#### Manual Verification:

- Właściciel widzi `/room` z zakładką „Sala główna"; kelner wchodząc na `/room` wraca na `/dashboard`
- Dodanie, przemianowanie i usunięcie pustej sali działa; usunięcie sali ze stolikiem pokazuje
  komunikat, nie znika po cichu
- Dodanie stolika o duplikującym się numerze pokazuje błąd w dialogu, a dialog zostaje otwarty
- Dezaktywacja i ponowna aktywacja stolika działa i utrzymuje się po odświeżeniu
- Nigdzie w UI nie ma akcji usunięcia stolika

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych, zanim przejdziesz do fazy 4.

---

## Phase 4: Wizualny kanwas — przeciąganie, kształty, dotyk

### Overview

Wizualny edytor sali: skalowany kanwas w logicznej przestrzeni 1200×800, swobodne przeciąganie
stolików myszą i palcem, kształty, przygaszone stoliki nieaktywne, zapis per-upuszczenie
optymistycznie z rollbackiem.

### Changes Required:

#### 1. Konwersja skali w module geometrii

**File**: `src/lib/room-geometry.ts` (rozszerzenie)

**Intent**: Dołożyć do czystego modułu przeliczanie między pikselami wyrenderowanymi a logicznymi
— jedyna nieoczywista matematyka w edytorze, dlatego testowana osobno.

**Contract**: `computeScale(containerWidth: number): number` (stosunek do
`LOGICAL_CANVAS.width`, z sensownym minimum) oraz
`applyDragDelta(pos, delta: { x: number; y: number }, scale: number, shape: TableShape)`
zwracające nową **logiczną** pozycję: dzieli deltę przez `scale`, dodaje do pozycji,
zaokrągla do całkowitych i przepuszcza przez `clampPosition`. Renderowanie mnoży logiczną
pozycję przez `scale`.

#### 2. Testy geometrii

**File**: `src/lib/room-geometry.test.ts`

**Intent**: Przypiąć konwersję i clamp, bo pomyłka w kierunku dzielenia jest niewidoczna przy
skali 1.

**Contract**: `applyDragDelta` przy `scale = 0.5` przesuwa o dwukrotność delty w przestrzeni
logicznej; przy `scale = 1` o dokładnie deltę; delta wypychająca poza kanwas jest przycięta do
`width - footprint.width` (osobno dla `rectangle`, który ma inny footprint niż `square`);
wynik jest zawsze całkowity i nieujemny.

#### 3. Kanwas

**File**: `src/components/room/RoomCanvas.tsx`, `DraggableTable.tsx`

**Intent**: Swobodne pozycjonowanie 2D — nowy wzorzec w tym repo: `useDraggable`, nie
`useSortable`, i żadnego `arrayMove`.

**Contract**: `RoomCanvas` renderuje jeden `DndContext` z
`useSensor(PointerSensor, { activationConstraint: { distance: 5 } })` (wzorzec
`src/components/menu/MenuManager.tsx:42`) i `onDragEnd`; kontener mierzy własną szerokość
(`ResizeObserver`) i wylicza `scale`, utrzymując proporcję 1200×800. `DraggableTable` używa
`useDraggable({ id: table.id })`, pozycjonuje się absolutnie na `pos_x * scale` / `pos_y * scale`,
w trakcie dragu dokłada `CSS.Translate.toString(transform)`, ma klasę `touch-none`
(bez niej mobilna przeglądarka przewinie stronę i drag nigdy nie wystartuje), renderuje kształt
zgodnie z `SHAPE_FOOTPRINTS` (`circle` przez `rounded-full`), pokazuje numer, a stoliki
`is_active === false` renderuje przygaszone z widocznym oznaczeniem. Kliknięcie stolika (bez
przeciągnięcia) otwiera `TableDialog` — próg 5 px oddziela klik od dragu.

#### 4. Utrwalanie pozycji

**File**: `src/components/room/RoomLayoutManager.tsx` (rozszerzenie)

**Intent**: Zapis per-upuszczenie, optymistycznie z rollbackiem — dokładnie jak jedyna
optymistyczna mutacja w repo.

**Contract**: `persistPosition(tableId, next)` odwzorowujące `persistReorder`
(`src/components/menu/MenuManager.tsx:153`): zapamiętaj `previous`, ustaw stan optymistycznie,
`PATCH /api/room/tables/{id}/position`, a przy błędzie przywróć `previous` i ustaw `actionError`.
Utrzymuj `AbortController` per `table.id` i przerwij poprzednie żądanie przed wysłaniem nowego;
przerwanie (`DOMException` o `name === "AbortError"`) **nie** jest błędem i nie robi rollbacku.

#### 5. Kanwas w widoku

**File**: `src/components/room/RoomLayoutManager.tsx`, `TableList.tsx`

**Intent**: Wprowadzić kanwas jako główny widok sali, zachowując listę jako uzupełnienie.

**Contract**: Kanwas jest widokiem podstawowym dla aktywnej sali; lista z fazy 3 pozostaje pod
nim (albo jako widok alternatywny) jako dostępna z klawiatury ścieżka do wszystkich akcji —
przeciąganie jest wskaźnikowe, więc lista jest ścieżką a11y, nie ozdobą.

### Success Criteria:

#### Automated Verification:

- Testy geometrii i schematów przechodzą: `npm run test`
- Typy przechodzą: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Build SSR przechodzi: `npm run build`

#### Manual Verification:

- Przeciągnięcie stolika myszą zapisuje pozycję; po odświeżeniu stolik jest tam, gdzie go
  upuszczono
- To samo działa palcem na telefonie i strona nie przewija się w trakcie przeciągania
- Zwężenie okna przeskalowuje układ proporcjonalnie, a przeciąganie po zwężeniu nadal trafia pod
  kursor (test konwersji skali „na oko")
- Przeciągnięcie w stronę krawędzi zatrzymuje stolik na granicy kanwasu, nie wypycha go poza
- Kliknięcie bez przeciągnięcia otwiera dialog edycji, a nie przesuwa stolika
- Stoliki nieaktywne są wizualnie odróżnialne
- Odcięcie sieci (DevTools offline) przy upuszczeniu cofa stolik na poprzednią pozycję i pokazuje
  komunikat

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych.

---

## Testing Strategy

### Unit Tests:

- `src/lib/schemas/room.test.ts` — granice numeru (0, 1, 999, 1000, niecałkowity), nieznany
  kształt, normalizacja `label` do `null`, granice `pos_x`/`pos_y`, trim nazwy sali
- `src/lib/room-geometry.test.ts` — `clampPosition` per kształt (różne footprinty),
  `applyDragDelta` przy skali 1 i 0.5, całkowitość i nieujemność wyniku

### Integration Tests:

- `supabase/tests/rls_isolation.sql` — izolacja firm na `rooms` i `tables`; właściciel pisze,
  kelner nie; **nikt nie usuwa stolika**; duplikat `(company_id, number)` → `23505`; usunięcie
  sali ze stolikami → `23503`

### Manual Testing Steps:

1. Zaloguj się jako właściciel, wejdź na `/room` — powinna być zakładka „Sala główna"
2. Dodaj salę „Taras", dodaj w niej stolik nr 1 o kształcie `circle`
3. Spróbuj dodać drugi stolik nr 1 (w dowolnej sali tej samej firmy) — oczekuj błędu 409
   w dialogu
4. Przeciągnij stolik, odśwież stronę — pozycja utrzymana
5. Powtórz przeciąganie na telefonie (lub emulacji dotyku) — działa i nie przewija strony
6. Zwęź okno do ~700 px i przeciągnij ponownie — stolik idzie pod palcem/kursorem
7. Przeciągnij stolik na prawą krawędź — zatrzymuje się przy granicy
8. Dezaktywuj stolik — przygaszony; aktywuj ponownie — wraca
9. Spróbuj usunąć salę „Taras" ze stolikiem — komunikat 409; przenieś stolik do „Sali głównej",
   usuń „Taras" — udaje się
10. Zaloguj się jako kelner, wejdź na `/room` — przekierowanie na `/dashboard`
11. W drugiej firmie sprawdź, że nie widać sal ani stolików pierwszej

## Performance Considerations

Skala jest mała (dziesiątki stolików na firmę), więc zapis per-upuszczenie nie wymaga
batchowania. Jedyny realny koszt to re-render kanwasu w trakcie dragu — dnd-kit przesuwa węzeł
transformem CSS, więc nie ruszamy stanu na `onDragMove` i nie zapisujemy nic do czasu
`onDragEnd`. `ResizeObserver` mierzący kontener aktualizuje `scale`; nie potrzebuje debouncingu
przy tej liczbie węzłów, ale nie może być trzymany w stanie odczytywanym w pętli renderu dragu.

## Migration Notes

Migracja jest jednorazowa i idempotentna w części seedującej. Trzy ryzyka na istniejących danych:

1. **Duplikaty `(company_id, number)`** w podłączonej bazie dev zablokują unikalny indeks —
   dlatego deterministyczne przenumerowanie poprzedza `create unique index`. Przed `db:push`
   warto policzyć duplikaty zapytaniem kontrolnym, żeby wiedzieć, czy przenumerowanie coś ruszy.
2. **`room_id NOT NULL`** wymaga, by backfill objął wszystkie istniejące wiersze — dla firmy bez
   sali seed musi ją utworzyć wcześniej w tej samej transakcji.
3. **Fixture testowy** `supabase/tests/rls_isolation.sql:38-42` przestanie działać bez dopisania
   `room_id` — to część fazy 1, nie osobne zadanie.

Rollback: migracja nie jest odwracalna automatycznie (Supabase nie trzyma `down`). Powrót
oznaczałby nową migrację zdejmującą `not null`, kolumny i indeks oraz przywracającą
`tables_staff_all` — warto to odnotować, ale przy braku ruchu produkcyjnego na `tables`
praktyczne ryzyko jest niskie.

## References

- Roadmap slice: `context/foundation/roadmap.md` § S-06
- PRD: `context/foundation/prd.md` FR-008, FR-009, FR-010; § Access Control
- Notatki zmiany: `context/changes/room-layout-tables/change.md`
- Lekcje: `context/foundation/lessons.md:5-20` (anon RLS scoping — świadomie odroczone)
- Wzorzec zawężenia RLS: `supabase/migrations/20260708124756_menu_categories_items.sql:111-141`
- Wzorzec seedowania nowej firmy: `supabase/migrations/20260708124756_menu_categories_items.sql:146-179`
- Wzorzec route'a: `src/pages/api/menu/categories.ts:8-37`; guard: `src/lib/api.ts:29`
- Wzorzec wyspy i optymistycznej mutacji: `src/components/menu/MenuManager.tsx:153`
- Poprzedni plan tej samej klasy: `context/changes/menu-item-photos/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fundament danych — `rooms`, kolumny układu, zawężenie RLS

#### Automated

- [x] 1.1 Migracja aplikuje się czysto: `npm run db:push` — 864304a
- [x] 1.2 Test izolacji przechodzi (w tym nowe asercje zapisu): `npm run test:rls` — 864304a
- [x] 1.3 Typy i lint bez regresji: `npm run typecheck` oraz `npm run lint` — 864304a

#### Manual

- [x] 1.4 `public.tables` ma `room_id NOT NULL`, `pos_x`, `pos_y`, `shape`, a każdy wiersz wskazuje na salę swojej firmy — 864304a
- [x] 1.5 Polityki na `tables` to dokładnie select_staff / insert_owner / update_owner / anon_read_active — bez delete — 864304a
- [x] 1.6 Rejestracja nowej firmy zakłada salę „Sala główna" — 864304a

### Phase 2: API, typy i schematy

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą: `npm run test` — 2730685
- [x] 2.2 Typy przechodzą: `npm run typecheck` — 2730685
- [x] 2.3 Lint przechodzi: `npm run lint` — 2730685

#### Manual

- [x] 2.4 `GET /api/room` zwraca sale i stoliki tylko własnej firmy — 085be82
- [x] 2.5 Duplikat numeru stolika w firmie daje 409 z czytelnym komunikatem PL — 085be82
- [x] 2.6 `DELETE` sali ze stolikami daje 409; sali pustej — 200 — 085be82
- [x] 2.7 Kelner dostaje 403 na każdym zapisie i 200 na `GET /api/room` — 085be82
- [x] 2.8 `PATCH …/position` poza kanwasem zapisuje wartość przyciętą, nie odrzuca żądania

### Phase 3: Strona `/room` — sale, stoliki, aktywacja (bez kanwasu)

#### Automated

- [x] 3.1 Typy przechodzą: `npm run typecheck` — 085be82
- [x] 3.2 Lint przechodzi: `npm run lint` — 085be82
- [x] 3.3 Build SSR przechodzi: `npm run build` — 085be82

#### Manual

- [x] 3.4 Właściciel widzi `/room` z zakładką „Sala główna"; kelner wraca na `/dashboard` — 085be82
- [x] 3.5 Dodanie, przemianowanie i usunięcie pustej sali działa; sala ze stolikiem pokazuje komunikat — 085be82
- [x] 3.6 Duplikat numeru pokazuje błąd w dialogu, dialog zostaje otwarty — 085be82
- [x] 3.7 Dezaktywacja i ponowna aktywacja stolika utrzymuje się po odświeżeniu — 085be82
- [x] 3.8 Nigdzie w UI nie ma akcji usunięcia stolika — 085be82

### Phase 4: Wizualny kanwas — przeciąganie, kształty, dotyk

#### Automated

- [x] 4.1 Testy geometrii i schematów przechodzą: `npm run test`
- [x] 4.2 Typy przechodzą: `npm run typecheck`
- [x] 4.3 Lint przechodzi: `npm run lint`
- [x] 4.4 Build SSR przechodzi: `npm run build`

#### Manual

- [x] 4.5 Przeciągnięcie myszą zapisuje pozycję; utrzymuje się po odświeżeniu
- [x] 4.6 Przeciąganie palcem działa i strona się nie przewija
- [x] 4.7 Zwężenie okna skaluje układ, a drag nadal trafia pod kursor
- [x] 4.8 Przeciągnięcie ku krawędzi zatrzymuje stolik na granicy kanwasu
- [x] 4.9 Kliknięcie bez przeciągnięcia otwiera dialog edycji
- [x] 4.10 Stoliki nieaktywne są wizualnie odróżnialne
- [x] 4.11 Błąd sieci przy upuszczeniu cofa pozycję i pokazuje komunikat
