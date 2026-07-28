# Obiekty wyposażenia sali (`room_objects`) — Implementation Plan

## Overview

Rozszerzenie edytora schematu sali (`/room`) o encję `room_objects` — dziewięć rodzajów
wyposażenia (ściana, krzesło, drzwi, okno, bar, roślina, schody, toaleta, kasa) z **własnymi
wymiarami** i **swobodnym obrotem**, przeciąganych w tym samym `DndContext` co stoliki i
renderowanych pod nimi.

Encja jest celowo osobna od `tables`, bo różni się w czterech wymiarach, z których pierwszy jest
najważniejszy: **obiekty wolno usuwać**. `public.tables` świadomie nie ma polityki DELETE w RLS —
to strukturalna realizacja guardraila trwałości QR (S-07). Do krzesła nie jest przypięty żaden kod
QR, więc `room_objects` polityki DELETE potrzebuje i dostaje.

Zmiana nie realizuje żadnego FR z PRD — FR-008 mówi wyłącznie o stolikach („dodawać do niego
stoliki"). To rozszerzenie użytkowe zaparkowane w `context/changes/room-layout-tables/change.md`,
świadomie poza zakresem S-06.

## Current State Analysis

**Warstwa danych** — S-06 dowiozło komplet, ale gałąź jest w stanie niedomkniętym:

- `public.rooms` (`supabase/migrations/20260727120000_room_layout_tables.sql:35-41`) z czterema
  politykami per-operacja (`:46-73`) — wzorzec do skopiowania 1:1, włącznie z
  `rooms_delete_owner`. Zero polityk `to anon`.
- `public.tables` rozszerzone o `room_id`/`pos_x`/`pos_y`/`shape`, unikalny
  `tables_company_number_idx`, polityki zawężone do `select_staff` / `insert_owner` /
  `update_owner` — **bez delete**, świadomie (`:168-187`).
- Idiom SQL właściciela: `public.current_company_id()` + `public.current_staff_role() = 'owner'`
  (`20260705212949_tenancy_core.sql:44-66`). Nie ma `is_owner()`.
- **`supabase/migrations/20260728120000_room_tables_composite_fk.sql` leży niezacommitowana i
  niewypchnięta.** Dodaje `rooms_company_id_id_key unique (company_id, id)` i zamienia
  `tables_room_id_fkey` na composite `(company_id, room_id) → rooms (company_id, id)` z
  `on delete no action`. Powstała z findingów impl-review F1 i F6.
- **`supabase db push` jest dziś zablokowany.** Współdzielona hostowana baza ma dwie migracje S-02
  (`20260727220415`, `20260728101449`) nieobecne w tej gałęzi, więc CLI odmawia. Dlatego asercja 13
  w `supabase/tests/rls_isolation.sql` jest bramkowana na `pg_constraint` i emituje `SKIP`.
- `supabase/tests/rls_isolation.sql` — 429 linii, jedna transakcja `begin … rollback`, 13 asercji.
  Idiom kontekstu: `set local role authenticated;` + `set local request.jwt.claims = '{"sub":…}'`.
  Idiom asercji: `get diagnostics n = row_count;` + `raise exception 'FAIL …'`, a dla zapisów, które
  rzucają — zagnieżdżone `begin … leaked := true; exception when others then leaked := false; end;`.
  Asercja 9 jest wzorcem odmowy usunięcia, asercja 12 — izolacji międzyfirmowej.

**Warstwa aplikacji** — spójna i dobrze udokumentowana:

- `src/lib/room-geometry.ts` — `LOGICAL_CANVAS = { width: 1200, height: 800 }`,
  `SHAPE_FOOTPRINTS`, `clampPosition(position, shape)` (`:25`),
  `computeScale(containerWidth)` (`:41`), `applyDragDelta(position, delta, scale, shape)` (`:55`).
  **Wszystko kluczowane kształtem** — `SHAPE_FOOTPRINTS[shape]` — więc obiekt z własnym
  `width`/`height` nie ma jak z tego skorzystać bez refaktoru. 16 przechodzących testów w
  `src/lib/room-geometry.test.ts`.
- `src/lib/room-api.ts` — `guardTablesRequest(context, { write })` (`:18`) świadomie zduplikowany
  z `guardMenuRequest`, `roomExistsInCompany` (`:47`), `isForeignKeyViolation` → `23503` (`:55`).
  Importuje z `src/lib/api.ts` **tylko** `jsonError`.
- `src/lib/schemas/room.ts` — `posXSchema`/`posYSchema` (int 0…1200 / 0…800, celowo **nie**
  footprint-aware, bo serwer clampuje), `roomInputSchema`, `tableInputSchema`,
  `tablePositionSchema`. Bez `.strict()`, bez koercji, komunikaty PL, typy jako `z.output<…>`.
- `src/pages/api/room/**` — 6 plików. `GET /api/room` zwraca agregat
  `{ rooms, tables }` przez `Promise.all` (`index.ts:15-18`). `PATCH …/position` robi **dwa**
  round-tripy: dociąga `shape`, potem clampuje i zapisuje (`tables/[id]/position.ts:33-37`).
  **W całym drzewie nie ma handlera DELETE dla stolików** — komentarz w `tables/[id].ts:12-17`
  wyjaśnia dlaczego.
- `src/components/room/RoomCanvas.tsx` — jeden `DndContext` z
  `useSensor(PointerSensor, { activationConstraint: { distance: 5 } })` (`:24`), `ResizeObserver`
  mierzący szerokość i wyliczający `scale` (`:29-42`), `onDragEnd` liczący
  `applyDragDelta(table, delta, scale, table.shape)` (`:48-60`). Rozdzielenie klik/drag stoi na
  `draggedIdRef` czyszczonym w `setTimeout(…, 0)` — makrotask, bo `click` leci po `dragEnd`.
- `src/components/room/DraggableTable.tsx` — **`<button type="button">`** z rozlanymi
  `{...attributes} {...listeners}` (`:47-48`), klasa `touch-none` z komentarzem „load-bearing"
  (`:28-30`), `isDragging ? "z-10 …"` (`:35`), pozycja `left: table.pos_x * scale` (`:38`),
  `transform: CSS.Translate.toString(transform)` (`:44`).
- `src/components/room/RoomLayoutManager.tsx` — jedyny stanowy orkiestrator,
  `positionQueue = useRef(new Map<string, Promise<void>>())` (`:42`),
  `persistPosition` (`:187-215`) — jedyna optymistyczna mutacja z rollbackiem; pozostałe kończą
  `await refetch()`. Aktualizacje stanu idą przez `patchTablePosition` (`:26`) i **funkcyjną** formę
  `setLayout`, a żądania są **szeregowane per `table.id`** — nie przerywane. Uzasadnienie w kodzie:
  `abort()` zamyka tylko połączenie klienta, więc żądanie już przekazane przez Workera i tak
  commituje, i starsza pozycja mogłaby wylądować w Postgresie jako ostatnia. Szeregowanie zrównuje
  kolejność commitów z kolejnością wysłania, a odpowiedź serwera (po clampie) jest autorytatywna.
- `src/components/hooks/useRoomLayout.ts` — `callRoomApi<T>(method, url, body?, signal?)` (`:11`),
  `useRoomLayout()` → `{ layout, setLayout, loadError, refetch, reload }`.
- `src/types.ts:89-131` — trójka enumów (`TABLE_SHAPES` / `TableShape` / `TABLE_SHAPE_LABELS`),
  `Room`, `RoomTable`, `RoomLayoutPayload`. Pola snake_case 1:1 z kolumnami.
- `lucide-react@1.14.0` jest zależnością i jest idiomem w repo (14 plików). shadcn/ui ma już
  `alert-dialog`, `input`, `label`, `select` — **nic nie trzeba dodawać**.
- `src/middleware.ts:4-8` — `/room` jest w `PROTECTED_ROUTES` i `OWNER_ROUTES`.

**Otwarte findingi impl-review S-06, które ta zmiana zaostrza albo naprawia**
(`context/changes/room-layout-tables/reviews/impl-review.md`):

- **F2/F3 są już naprawione dla stolików** commitem `0f2685d` (triage S-06): snapshot całego układu
  zastąpiony funkcyjnym `setLayout` z punktową łatką, a przerywanie żądań — szeregowaniem per
  `table.id`. Obiekty odwzorowują **ten** wzorzec; wcześniejsza wersja tego planu opisywała
  `AbortController`, którego w repo już nie ma.
- **F1/F6** — naprawione niewypchniętą migracją `20260728120000`; `room_objects` dziedziczy z niej
  wzorzec composite FK i zależy od dodanego przez nią unique constraintu.
- **F5** (toggle nadpisuje na ślepo pełnym PUT) — dla obiektów unikane przez dedykowany
  `PATCH …/position`, który dotyka wyłącznie pozycji.

## Desired End State

Właściciel na `/room` widzi obok przycisku „Dodaj stolik" przycisk „Dodaj obiekt". Wybiera rodzaj
z dziewięciu, dostaje obiekt o rozsądnym domyślnym rozmiarze dla tego rodzaju (ściana 400×20,
krzesło 40×40, bar 240×60 …) w wolnym miejscu kanwasu. Przeciąga go myszą albo palcem — pozycja
zapisuje się natychmiast, optymistycznie. W dialogu edycji zmienia rodzaj, opis, szerokość,
wysokość i obrót (pole liczbowe 0–359° plus przycisk „obróć o 90°"). Obiekty rysują się **pod**
stolikami, każdy z ikoną swojego rodzaju i stonowanym kolorem. Obiekt można **usunąć** — po
potwierdzeniu w `AlertDialog`. Pod kanwasem jest lista obiektów, dostępna z klawiatury, z akcjami
Edytuj i Usuń.

Na poziomie bazy: kelner i kuchnia nie mogą zapisać ani usunąć żadnego obiektu; firma A nigdy nie
widzi obiektów firmy B; obiekt firmy A **nie może** wskazywać na salę firmy B (composite FK, nie
kod aplikacji); usunięcie sali kasuje jej obiekty, ale nadal jest blokowane, gdy ma stoliki.

Weryfikacja: `npm run test` (geometria + schematy), `npm run test:rls` (nowe asercje 14–16),
`npm run typecheck`, `npm run lint`, `npm run build`, plus scenariusze z sekcji Testing Strategy.

### Key Discoveries:

- `clampPosition` i `applyDragDelta` są kluczowane `TableShape` (`src/lib/room-geometry.ts:25`,
  `:55`) — **reuse „jak jest" jest niemożliwy**; potrzebny rdzeń przyjmujący footprint jawnie.
- **`supabase db push` odmawia w tej gałęzi** — hostowana baza ma migracje S-02 nieobecne lokalnie
  (`supabase/tests/rls_isolation.sql`, komentarz przy asercji 13). Faza 2 jest zablokowana do
  scalenia S-02.
- Composite FK wymaga `rooms_company_id_id_key`, który dodaje **niezacommitowana**
  `20260728120000_room_tables_composite_fk.sql` — twarda zależność kolejności.
- FK jest sprawdzany **pod** RLS (finding F1), więc `(company_id = A, room_id = <sala B>)`
  przechodzi, jeśli chroni tylko kod aplikacji. `room_objects` dostaje composite FK od razu.
- `DraggableTable` to `<button>` z rozlanymi listenerami (`:47-48`) — uchwytów resize/rotate nie da
  się w nim zagnieździć (button w buttonie). Dlatego faza 5 jest osobna, a nie „dokładka" do 4.
- **`lucide-react@1.14.0` nie eksportuje `Stairs`** (sprawdzone w
  `node_modules/lucide-react/dist/lucide-react.d.ts`). Zweryfikowany zestaw dziewięciu ikon niżej.
- `SHAPE_FOOTPRINTS` daje stolikom stały footprint per kształt; obiekty mają footprint w wierszu,
  więc `clampPosition` dla obiektu musi dostać wymiary z danych, nie ze stałej.

## What We're NOT Doing

- **Nie ruszamy `tables`** — żadnej nowej kolumny, żadnej zmiany polityk, żadnego handlera DELETE.
  Guardrail trwałości QR zostaje nienaruszony.
- **Nie naprawiamy `tables_anon_read_active`** — to nadal dług S-07 (finding F8, otwarta lekcja
  `context/foundation/lessons.md:5-20`). `room_objects` po prostu nie dostaje żadnej polityki anon.
- **Nie dodajemy `is_active` na obiektach** — obiekty są usuwalne, więc druga ścieżka lifecycle
  byłaby zbędna. `tables.is_active` istnieje wyłącznie dlatego, że usuwanie tam jest zakazane.
- **Nie dodajemy `z_index`** — kolejność w obrębie obiektów nie jest sterowalna; warstwy są dwie
  (obiekty pod stolikami) i wynikają z kolejności renderu. Finding F9 pokazuje, ile kosztuje
  niepodłączona kolumna porządku.
- **Nie dodajemy numeru ani unikalności** — obiekt nie ma identyfikatora widocznego dla gościa.
- **Nie blokujemy nachodzenia** obiektów na siebie ani na stoliki — spójnie ze stolikami.
- **Nie ma zoomu ani panoramowania** — jedna logiczna przestrzeń 1200×800 na salę, jak w S-06.
- **Nie seedujemy domyślnych obiektów** przy rejestracji — `handle_new_user()` zostaje nietknięty
  (impl-review ostrzega, że `create or replace` na tym triggerze koliduje z S-02).
- **Nie refaktoryzujemy `src/lib/api.ts`** — nadal konflikt z gałęzią S-02.
- **Nie naprawiamy findingów F2/F3/F4/F7/F9/F10 dla stolików** — ta zmiana unika ich wzorców u
  siebie, ale nie sanuje istniejącego kodu stolików.
- **Nie ma undo dla usunięcia** — potwierdzenie zamiast cofania (w repo nie ma ani tostów, ani
  żadnego undo).
- **Nie ostrzegamy o obiektach w dialogu usuwania sali** i nie zmieniamy jego tekstu. Obiekty giną
  wyłącznie razem z salą, a do usunięcia sali i tak trzeba najpierw opróżnić ją ze stolików — więc
  moment usunięcia jest zawsze świadomy. Istniejący `AlertDialog` (`RoomLayoutManager.tsx:278-299`)
  mówi o stolikach i zostaje bez zmian.

## Implementation Approach

Kolejność jest podyktowana blokadą `db:push`: faza 1 dowozi **całą matematykę i wszystkie
kontrakty bez dotykania bazy**, więc najbardziej ryzykowna część (AABB obróconego prostokąta) jest
domknięta zielonymi testami, zanim S-02 się scali. Fazy 2–4 idą potem klasycznie: dane → API → UI.
Faza 5 (uchwyty na kanwasie) jest wyznaczoną linią cięcia — fazy 1–4 dają kompletną, dostępną z
klawiatury funkcję bez niej.

Sześć decyzji podjętych w planie, wyprowadzonych z kodu i z findingów, a nie z preferencji:

1. **`room_objects.pos_x`/`pos_y` to ŚRODEK obiektu**, nie lewy górny róg jak w `tables`.
   Wymuszone przez matematykę obrotu — uzasadnienie w Critical Implementation Details.
2. **Composite FK `(company_id, room_id)` od pierwszej migracji**, nie single-column + kontrola w
   kodzie. Finding F1 rozstrzygnął ten wzorzec; nie powtarzamy błędu w nowej tabeli.
3. **`on delete cascade` na sali**, nie `restrict` jak przy stolikach. Obiekt jest zużywalny —
   usunięcie sali ma zabrać jej ściany. Asymetria jest celowa i daje pożądaną kolejność: dopóki w
   sali stoi choćby jeden stolik, `DELETE` sali kończy się `23503` → 409, więc obiektów nie da się
   zgubić przypadkiem; dopiero opróżniona ze stolików sala usuwa się razem z wyposażeniem.
   `CASCADE`, jak `NO ACTION`, jest sprawdzany na koniec instrukcji, więc kasowanie firmy zostaje
   wykonalne (lekcja z findingu F6).
4. **Rollback punktowy plus szeregowanie, nie snapshot i nie `abort()`** — `persistObjectPosition`
   przywraca pozycję jednego obiektu przez funkcyjne `setLayout` i szereguje żądania per
   `object.id`. Oba wzorce są wzięte z triage S-06 (`0f2685d`, findingi F2 i F3), nie wymyślone tu.
5. **Dyskryminacja encji przez `data` w `useDraggable`**, nie przez szukanie uuid w dwóch
   tablicach. Idiomatyczne dla dnd-kit i odporne na rozjazd kolekcji.
6. **Granice wymiarów w zod ORAZ w `CHECK`** — schemat zod jest współdzielony klient/serwer, ale
   nie jest jedyną drogą do bazy (`db query`, przyszłe importy). Ograniczenie należy do danych.

## Critical Implementation Details

**Pozycja obiektu to jego środek — i to nie jest kosmetyka.** Gdyby `pos_x`/`pos_y` oznaczały
lewy górny róg nieobróconego prostokąta (jak w `tables`), clampowanie obróconego obiektu
produkowałoby **ujemne** współrzędne: ściana 400×20 obrócona o 90° ma AABB 20×400, więc przy
dosunięciu do lewej krawędzi jej środek jest na `x = 10`, a lewy górny róg nieobróconego boxa na
`x = -190`. Legalna pozycja, ale nie do przepuszczenia przez `min(0)` w zod ani przez sensowny
`CHECK`. Przy semantyce środka clamp zwraca zawsze `[0, 1200] × [0, 800]`, więc schemat i
constraint zostają takie same jak dla stolików. Cena: render musi liczyć
`left = (pos_x - width / 2) * scale` — rozbieżność ze `DraggableTable` wymaga komentarza w obu
plikach, inaczej ktoś ją „naprawi".

**AABB obróconego prostokąta.** Dla kąta θ w radianach:
`aabbW = |w·cos θ| + |h·sin θ|`, `aabbH = |w·sin θ| + |h·cos θ|`. Środek musi wylądować w
`[aabbW/2, 1200 - aabbW/2] × [aabbH/2, 800 - aabbH/2]`. **Przypadek zdegenerowany jest osiągalny**
i musi być obsłużony: ściana 1200×20 obrócona o 45° ma AABB ≈ 863×863, czyli wyższe niż kanwas —
wtedy `min > max` i jedyne sensowne wyjście to wyśrodkowanie na tej osi. Bez tej gałęzi
`Math.min(Math.max(…))` zwróci wartość zależną od kolejności operacji, czyli cichy bug.

**Kolejność składania transformów CSS.** Węzeł przeciągany potrzebuje jednocześnie translacji z
dnd-kit i obrotu obiektu, a transformy CSS aplikują się **od prawej do lewej**. Poprawnie jest
`transform: translate3d(…) rotate(θdeg)` — najpierw obrót w lokalnym układzie, potem translacja w
układzie rodzica. Odwrotna kolejność obraca wektor przesunięcia i obiekt ucieka spod kursora po
łuku, tym mocniej im większy kąt. `transform-origin` zostaje domyślne (`50% 50%`), co jest zgodne
z semantyką środka z poprzedniego akapitu.

**Delta z dnd-kit jest niezależna od obrotu.** To delta wskaźnika w przestrzeni ekranu, więc
`delta / scale` daje poprawne przesunięcie logiczne bez żadnej korekty o kąt. Obrót wchodzi
wyłącznie do clampowania (przez AABB), nie do konwersji delty.

**Warstwowanie bez żonglowania `pointer-events`.** Naturalna pokusa — dwa kontenery
`absolute inset-0` z różnym `z-index` — wymaga `pointer-events-none` na wrapperze i
`pointer-events-auto` na dzieciach, co łatwo zepsuć. Wszystkie węzły są już `absolute`, więc
wystarczy kolejność w DOM plus jawne klasy `z-*`: obiekty `z-0` (przeciągany `z-10`), stoliki
`z-20` (przeciągany `z-30`). Zmienia to jedną klasę w `DraggableTable.tsx:35` i nic więcej.

**`PATCH …/position` dla obiektu potrzebuje trzech kolumn, nie jednej.** Clamp jest
footprint-aware i obrót-aware, więc endpoint musi dociągnąć `width`, `height` **i** `rotation`
zanim policzy pozycję — analogicznie do tego, jak wersja stolikowa dociąga `shape`
(`tables/[id]/position.ts:33-37`). Dwa round-tripy, tak jak tam.

**Faza 2 nie ruszy bez dwóch rzeczy.** `20260728120000_room_tables_composite_fk.sql` musi być
zacommitowana i zaaplikowana (dostarcza `rooms_company_id_id_key`), a gałąź zrebase'owana na
`main` z S-02 (odblokowuje `db push`). Do tego czasu faza 1 jest jedyną, która ma prawo się
wykonywać.

## Phase 1: Geometria i kontrakty (bez bazy)

### Overview

Rdzeń geometrii przepisany na footprint, AABB obróconego prostokąta, typy domenowe, schematy zod
i testy. Zero zależności od bazy i od S-02, więc ta faza idzie natychmiast. Zamyka też całe
ryzyko matematyczne zmiany.

### Changes Required:

#### 1. Rdzeń geometrii na footprincie

**File**: `src/lib/room-geometry.ts` (rozszerzenie)

**Intent**: Przenieść clampowanie i konwersję delty na jawny footprint, żeby obsłużyły zmienne
wymiary obiektu, a istniejące funkcje kluczowane kształtem zostawić jako cienkie wrappery — tak by
ścieżki stolików nie zmieniły się ani o linię i 16 istniejących testów przeszło bez modyfikacji.

**Contract**: Nowe eksporty:

- `export interface Footprint { width: number; height: number }`.
- `clampToFootprint(position: { pos_x: number; pos_y: number }, footprint: Footprint)` — rdzeń
  dotychczasowego `clampPosition`, przycinający lewy górny róg do
  `[0, width - footprint.width] × [0, height - footprint.height]`, zwracający liczby całkowite.
- `rotatedFootprint(footprint: Footprint, rotation: number): Footprint` — AABP obróconego
  prostokąta wg wzoru z Critical Implementation Details; `rotation` w stopniach, znormalizowany
  modulo 360, wynik zaokrąglony w górę do całkowitych.
- `clampObjectCenter(center: { pos_x: number; pos_y: number }, footprint: Footprint, rotation: number)`
  — przycina **środek** tak, by AABB mieścił się w `LOGICAL_CANVAS`; przy `min > max` (AABB większy
  od kanwasu na danej osi) zwraca środek kanwasu na tej osi. Wynik zawsze całkowity i w
  `[0, 1200] × [0, 800]`.
- `applyObjectDragDelta(center, delta: { x: number; y: number }, scale: number, footprint: Footprint, rotation: number)`
  — dzieli deltę przez `scale` (z tym samym zabezpieczeniem `scale > 0 ? scale : 1` co
  `applyDragDelta:62`), dodaje do środka i przepuszcza przez `clampObjectCenter`.
- `ROOM_OBJECT_DEFAULT_SIZES: Record<RoomObjectKind, Footprint>` — domyślne wymiary per rodzaj:
  `wall 400×20`, `chair 40×40`, `door 80×20`, `window 100×20`, `bar 240×60`, `plant 50×50`,
  `stairs 120×80`, `toilet 120×120`, `till 80×60`.
- `OBJECT_SIZE_BOUNDS = { minWidth: 10, maxWidth: 1200, minHeight: 10, maxHeight: 800 }` — jedno
  źródło granic dla zod i dla `CHECK` w migracji.

`clampPosition(position, shape)` i `applyDragDelta(position, delta, scale, shape)` zostają z
niezmienionymi sygnaturami, delegując do `clampToFootprint`. Nad każdą parą komentarz mówiący,
która warstwa jest dla stolików (footprint ze stałej, pozycja = lewy górny róg), a która dla
obiektów (footprint z wiersza, pozycja = środek).

#### 2. Testy geometrii

**File**: `src/lib/room-geometry.test.ts` (rozszerzenie)

**Intent**: Przypiąć AABB i clamp środka — pomyłka w tej matematyce jest niewidoczna przy
`rotation = 0` i przy `scale = 1`, czyli w każdym oczywistym przypadku.

**Contract**: Nowe `describe` dla `rotatedFootprint`, `clampObjectCenter`,
`applyObjectDragDelta`. Przypadki graniczne, które muszą być pokryte: `rotation = 0` zwraca
footprint niezmieniony; `rotation = 90` zamienia `width` i `height`; `rotation = 180` jest
identyczny z `0`; `rotation = 45` dla 400×20 daje ≈297×297 (asercja z tolerancją albo na
zaokrągleniu w górę); clamp środka dla ściany 400×20 przy `rotation = 90` pozwala na `pos_x = 10`
i nie mniej; **przypadek zdegenerowany** 1200×20 przy `rotation = 45` wyśrodkowuje na osi Y na
400; wynik zawsze całkowity i nieujemny; `applyObjectDragDelta` przy `scale = 0.5` przesuwa o
dwukrotność delty. Istniejące 16 testów **nie może być modyfikowanych** — jeśli któryś padnie,
wrappery są źle napisane.

#### 3. Typy domenowe

**File**: `src/types.ts` (append)

**Intent**: Trójka enumów rodzajów i interfejs wiersza, w konwencji pliku (snake_case 1:1 z
kolumnami), plus rozszerzenie agregatu.

**Contract**: `ROOM_OBJECT_KINDS = ["wall","chair","door","window","bar","plant","stairs","toilet","till"] as const`,
`RoomObjectKind`, `ROOM_OBJECT_KIND_LABELS: Record<RoomObjectKind, string>` z etykietami PL
(Ściana, Krzesło, Drzwi, Okno, Bar, Roślina, Schody, Toaleta, Kasa).
`interface RoomObject { id; company_id; room_id; kind: RoomObjectKind; label: string | null;
pos_x: number; pos_y: number; width: number; height: number; rotation: number; created_at }` —
z komentarzem, że `pos_x`/`pos_y` to **środek**, w przeciwieństwie do `RoomTable`.
`RoomLayoutPayload` dostaje trzecie pole `objects: RoomObject[]`.

#### 4. Schematy zod

**File**: `src/lib/schemas/room.ts` (rozszerzenie)

**Intent**: Walidacja wejścia obiektu, współdzielona serwer+klient, w konwencji pliku.

**Contract**: `roomObjectInputSchema` — `room_id` (`z.uuid`), `kind`
(`z.enum(ROOM_OBJECT_KINDS, …)`), `label` jak `tableInputSchema.label` (`.nullish().transform()`
→ `null`, max 80), `pos_x`/`pos_y` przez istniejące `posXSchema`/`posYSchema` (bez zmian — clamp
środka gwarantuje ten sam zakres), `width` int w `[minWidth, maxWidth]`, `height` int w
`[minHeight, maxHeight]` (granice z `OBJECT_SIZE_BOUNDS`), `rotation` int w `[0, 359]`.
`roomObjectPositionSchema` — tylko `pos_x`/`pos_y`. Komunikaty PL w stylu pliku („Szerokość
obiektu…", „Obrót musi być liczbą całkowitą"). Typy jako `z.output<typeof …>`. Bez `.strict()`,
bez koercji.

#### 5. Testy schematów

**File**: `src/lib/schemas/room.test.ts` (rozszerzenie)

**Intent**: Przypiąć granice, w konwencji pliku.

**Contract**: `describe("roomObjectInputSchema")` — `rotation` 360 i −1 odrzucone, 0 i 359
przyjęte, niecałkowity odrzucony; `width` 9 i 1201 odrzucone, 10 i 1200 przyjęte; `height` 801
odrzucone; nieznany `kind` odrzucony; `label` pusty → `null`.
`describe("roomObjectPositionSchema")` — odrzuca payload z `width` pominiętym? nie: sprawdza, że
przechodzi payload wyłącznie z `pos_x`/`pos_y` i że wartość poza kanwasem jest odrzucona.

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą, w tym 16 istniejących testów geometrii **bez modyfikacji**:
  `npm run test`
- Typy przechodzą: `npm run typecheck`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- Sanity-check AABB w konsoli: `rotatedFootprint({width:400,height:20}, 45)` daje ≈297×297, a
  `clampObjectCenter({pos_x:0,pos_y:0}, {width:1200,height:20}, 45)` zwraca `pos_y = 400`
  (przypadek zdegenerowany), nie `0` ani wartość ujemną

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik sanity-checku, zanim przejdziesz do fazy 2. **Faza 2 dodatkowo
wymaga scalenia S-02** — jeśli to jeszcze nie nastąpiło, zatrzymaj się tutaj na dłużej.

---

## Phase 2: Migracja, RLS i test izolacji

### Overview

Tabela `room_objects` z composite FK, `CHECK`ami wymiarów i obrotu oraz czterema politykami
per-operacja — **w tym `delete_owner`**, czyli pierwszą polityką DELETE w tym module. Plus
asercje izolacji, które dowodzą zarówno że właściciel usunąć **może**, jak i że nikt inny nie
może niczego zapisać.

**Prerekwizyt twardy**: `20260728120000_room_tables_composite_fk.sql` zacommitowana i
zaaplikowana, gałąź zrebase'owana na `main` z S-02, `supabase db push` przechodzi.

### Changes Required:

#### 1. Migracja obiektów sali

**File**: `supabase/migrations/20260729120000_room_objects.sql`

**Intent**: Postawić encję wyposażenia jako tabelę najemcy z pełnym cyklem życia, wzorowaną na
`rooms`, z composite FK od pierwszego dnia. Timestamp musi sortować się po
`20260728120000` i po najnowszej migracji S-02 — sprawdź `supabase migration list --linked` i
podnieś, jeśli trzeba.

**Contract**:

- `create type public.room_object_kind as enum ('wall','chair','door','window','bar','plant','stairs','toilet','till');`
- `public.room_objects`: `id uuid primary key default gen_random_uuid()`,
  `company_id uuid not null references public.companies (id) on delete cascade`,
  `room_id uuid not null`, `kind public.room_object_kind not null`, `label text`,
  `pos_x int not null default 0`, `pos_y int not null default 0`, `width int not null`,
  `height int not null`, `rotation int not null default 0`,
  `created_at timestamptz not null default now()`.
- Composite FK zamiast referencji inline (wzorzec z `20260728120000`):
  `foreign key (company_id, room_id) references public.rooms (company_id, id) on delete cascade`.
  Wymaga `rooms_company_id_id_key` — komentarz musi to odnotować jako zależność.
  `on delete cascade`, nie `restrict`: usunięcie sali zabiera jej wyposażenie, w przeciwieństwie do
  stolików, które usunięcie sali blokują. Komentarz musi wyjaśnić, że asymetria jest celowa.
- `CHECK`i odzwierciedlające zod: `pos_x between 0 and 1200`, `pos_y between 0 and 800`,
  `width between 10 and 1200`, `height between 10 and 800`, `rotation between 0 and 359`.
  Komentarz: `pos_x`/`pos_y` to **środek** obiektu, nie lewy górny róg (inaczej niż w `tables`).
- Indeksy: `room_objects_company_id_idx on (company_id)`,
  `room_objects_room_id_idx on (room_id)`. **Żadnego unikalnego** — obiekt nie ma numeru.
- `alter table public.room_objects enable row level security;` + cztery polityki dokładnie wg
  wzorca `rooms_*` (`20260727120000_room_layout_tables.sql:46-73`): `room_objects_select_staff`
  (`to authenticated`, `company_id = public.current_company_id()`),
  `room_objects_insert_owner` (tylko `with check`), `room_objects_update_owner` (`using` +
  `with check`), `room_objects_delete_owner` (tylko `using`) — każda z
  `and public.current_staff_role() = 'owner'`. **Żadnej polityki `to anon`.**
- Komentarz przy `room_objects_delete_owner` wyjaśniający kontrast: `public.tables` świadomie nie
  ma polityki delete (trwałość QR, S-07), a obiekt wyposażenia nie ma przypiętego kodu, więc
  usuwanie jest tu dozwolone i celowe.
- `handle_new_user()` **nietknięty** — nie seedujemy domyślnych obiektów.

#### 2. Asercje izolacji dla obiektów

**File**: `supabase/tests/rls_isolation.sql` (rozszerzenie)

**Intent**: Dowieść zapis, usuwanie, odmowę dla kelnera i izolację międzyfirmową dla nowej
tabeli — plus jedyną asercję, która w tym repo dowodzi, że usunięcie **ma** się udać.

**Contract**: Fixture — po dwa obiekty dla firmy A i jeden dla B, wstawione po salach (FK
composite wymaga istniejącej pary `(company_id, id)`). Nowe asercje w idiomie pliku, numerowane
dalej po 13:

- **14** — właściciel A: INSERT obiektu = 1 wiersz, UPDATE = 1 wiersz, **DELETE = 1 wiersz**
  (jawny kontrast z asercją 9, gdzie DELETE stolika daje 0; komentarz musi ten kontrast nazwać).
- **15** — kelner A: SELECT widzi obiekty firmy A, INSERT rzuca naruszenie polityki, UPDATE i
  DELETE dają `row_count = 0`.
- **16** — izolacja: właściciel A widzi 0 obiektów firmy B; INSERT obiektu z `company_id = B`
  rzuca; UPDATE obiektów B daje 0 wierszy; **own `company_id` + `room_id` firmy B → `23503`**
  (composite FK, wzorzec asercji 13); usunięcie sali A z obiektami **udaje się** i kasuje obiekty
  kaskadowo (`select count(*)` po `delete` = 0), przy czym sala ze stolikiem nadal rzuca `23503`.
- Rozszerz asercję 5 (anon) o `room_objects` — anon musi widzieć **0** wierszy.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npm run db:push`
- Test izolacji przechodzi, w tym asercja 13 **bez `SKIP`** (composite FK stolików już na remote):
  `npm run test:rls`
- Typy i lint bez regresji: `npm run typecheck` oraz `npm run lint`

#### Manual Verification:

- W Supabase Studio lista polityk na `room_objects` to dokładnie `select_staff`, `insert_owner`,
  `update_owner`, `delete_owner` — cztery, w tym **delete**, i żadnej `to anon`
- Wstawienie wiersza z `rotation = 400` albo `width = 5` jest odrzucone przez `CHECK`
- `delete from public.rooms where id = <sala z obiektami i bez stolików>` udaje się i kasuje
  obiekty; ta sama sala ze stolikiem daje `23503`
- Kasowanie firmy (`delete from public.companies where id = …`) nadal przechodzi — kaskada
  obiektów nie wprowadziła nowej blokady

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych, zanim przejdziesz do fazy 3.

---

## Phase 3: API obiektów

### Overview

Cztery route'y pod `/api/room/objects/**` i rozszerzenie agregatu `GET /api/room` o trzecią
kolekcję. Pierwszy handler `DELETE` w tym drzewie.

### Changes Required:

#### 1. Agregat układu

**File**: `src/pages/api/room/index.ts`

**Intent**: Dołożyć obiekty do jedynego odczytu, żeby kanwas dostawał cały plan sali w jednym
żądaniu.

**Contract**: Trzecie zapytanie w istniejącym `Promise.all` (`:15-18`) — `room_objects`
`.select("*").order("created_at")`; ten sam wspólny 500 przy błędzie któregokolwiek;
`jsonData({ rooms, tables, objects })`. Guard `{ write: false }` bez zmian — odczyt jest dla
całego personelu.

#### 2. Tworzenie obiektu

**File**: `src/pages/api/room/objects.ts`

**Intent**: `POST` obiektu, w konwencji `src/pages/api/room/tables.ts`.

**Contract**: `export const prerender = false`, guard `{ write: true }`,
`parseBody(context, roomObjectInputSchema)`, `roomExistsInCompany` → 400
„Nie znaleziono wskazanej sali" (obrona w głąb — composite FK i tak by to złapał, ale jako 23503,
czyli gorszy komunikat), pozycja przez `clampObjectCenter(input, { width, height }, rotation)`,
insert z jawnym `company_id: guard.companyId`, `.select("*").single<RoomObject>()`, 201.
Mapowanie błędów: `isForeignKeyViolation` → 400 „Nie znaleziono wskazanej sali"; brak `409` —
nie ma tu żadnego unikalnego indeksu; inne → 500 „Nie udało się utworzyć obiektu".

#### 3. Edycja i usunięcie obiektu

**File**: `src/pages/api/room/objects/[id].ts`

**Intent**: `PUT` (pełna aktualizacja, w tym przeniesienie do innej sali) oraz **`DELETE`** —
pierwszy handler usuwania w tym drzewie, celowo dozwolony.

**Contract**: `const idSchema = z.uuid()`, 400 „Nieprawidłowy identyfikator obiektu" przy złym
parametrze. `PUT`: `roomObjectInputSchema`, `roomExistsInCompany`, clamp środka, update
`room_id, kind, label, pos_x, pos_y, width, height, rotation`, `.select("*")`,
`data.length === 0` → 404 „Nie znaleziono obiektu", 200 `jsonData(data[0])`.
`DELETE`: `.delete().eq("id", id.data).select("id")`, `data.length === 0` → 404, 200
`jsonData({ id: id.data })`, 500 „Nie udało się usunąć obiektu". Komentarz nagłówkowy pliku
**musi** wyjaśniać, dlaczego `DELETE` tu jest, a w `tables/[id].ts` go nie ma — inaczej wygląda
jak niespójność.

#### 4. Gorąca ścieżka pozycji

**File**: `src/pages/api/room/objects/[id]/position.ts`

**Intent**: Lekki `PATCH` pod przeciąganie, dotykający wyłącznie pozycji — żeby drag nigdy nie
nadpisał na ślepo rozmiaru ani obrotu (klasa błędu z findingu F5).

**Contract**: Guard `{ write: true }`, `parseBody(context, roomObjectPositionSchema)`, dociągnięcie
`width, height, rotation` zapytaniem w granicach RLS (`.select("width, height, rotation").eq("id", …).maybeSingle()`;
brak wiersza → 404), `clampObjectCenter`, update wyłącznie `pos_x`/`pos_y`, 200
`jsonData(data[0])` z pełnym wierszem. Wzorzec 1:1 z `tables/[id]/position.ts:33-37`, z trzema
kolumnami zamiast jednej.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm run test`
- Typy przechodzą: `npm run typecheck`
- Lint przechodzi: `npm run lint`

#### Manual Verification:

- `GET /api/room` zwraca `objects` obok `rooms` i `tables`, tylko dla własnej firmy
- `POST /api/room/objects` z `room_id` innej firmy daje 400 z komunikatem PL (nie 500)
- `DELETE /api/room/objects/{id}` na własnym obiekcie daje 200, na cudzym 404
- `PATCH …/objects/{id}/position` ze środkiem poza kanwasem zapisuje wartość **przyciętą**, nie
  odrzuca żądania, i **nie zmienia** `width`, `height` ani `rotation`
- Zalogowany kelner dostaje 403 na każdym zapisie obiektu i 200 na `GET /api/room`

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych, zanim przejdziesz do fazy 4.

---

## Phase 4: UI — obiekty na kanwasie, dialog, lista, usuwanie

### Overview

Obiekty renderowane pod stolikami w tym samym `DndContext`, dialog z rodzajem, opisem, wymiarami
i obrotem, lista dostępna z klawiatury oraz usuwanie z potwierdzeniem. Po tej fazie funkcja jest
kompletna.

### Changes Required:

#### 1. Warstwa wizualna rodzajów

**File**: `src/components/room/room-object-visuals.ts`

**Intent**: Odseparować mapy ikon i kolorów od komponentu, żeby dialog, lista i kanwas czytały je
z jednego miejsca.

**Contract**: `ROOM_OBJECT_ICONS: Record<RoomObjectKind, LucideIcon>` — **zweryfikowane nazwy z
`lucide-react@1.14.0`**: `wall → BrickWall`, `chair → Armchair`, `door → DoorOpen`,
`window → Blinds`, `bar → Martini`, `plant → Sprout`, `stairs → ChevronsUp`, `toilet → Toilet`,
`till → Calculator`. Komentarz musi odnotować, że `Stairs` w tej wersji **nie istnieje** — stąd
`ChevronsUp`. `ROOM_OBJECT_STYLES: Record<RoomObjectKind, string>` — klasy Tailwind wypełnienia i
obrysu, stonowane względem purpurowych stolików (`DraggableTable.tsx:32`), bo obiekty są tłem.

#### 2. Węzeł przeciągany obiektu

**File**: `src/components/room/DraggableRoomObject.tsx`

**Intent**: Odpowiednik `DraggableTable` dla obiektu — z semantyką środka, obrotem i warstwą pod
stolikami.

**Contract**: Props `{ object: RoomObject; scale: number; onActivate: () => void }`.
`useDraggable({ id: object.id, data: { entity: "object" } })` — `data` jest tym, po czym
`onDragEnd` rozpoznaje encję. Element to `<button type="button">` z `{...attributes} {...listeners}`
(jak `DraggableTable:47-48`) i klasą **`touch-none`** (bez niej mobilna przeglądarka przewinie
stronę i `PointerSensor` nie dostanie zdarzeń — komentarz obowiązkowy, jak w `DraggableTable:28-29`).
Pozycjonowanie: `left: (object.pos_x - object.width / 2) * scale`,
`top: (object.pos_y - object.height / 2) * scale`, `width: object.width * scale`,
`height: object.height * scale` — z komentarzem, że `pos_*` to **środek**, inaczej niż w
`DraggableTable`. Transform: `` `${CSS.Translate.toString(transform) ?? ""} rotate(${object.rotation}deg)` ``
— **w tej kolejności** (patrz Critical Implementation Details), `transform-origin` domyślne.
Warstwa: klasa bazowa `z-0`, przy `isDragging` → `z-10`. Zawartość: ikona z
`ROOM_OBJECT_ICONS`, skalowana tak, by nie wylewała się z cienkiej ściany. `aria-label` w idiomie
`DraggableTable:24-26`: etykieta rodzaju + opcjonalny `label` + wymiary i obrót.

#### 3. Kanwas dla dwóch encji

**File**: `src/components/room/RoomCanvas.tsx`

**Intent**: Przyjąć obiekty obok stolików w jednym `DndContext` i rozdzielić `onDragEnd` po typie
encji.

**Contract**: Props rosną o `objects: RoomObject[]`, `onOpenObject`, `onMoveObject`.
Render: obiekty **przed** stolikami w JSX (kolejność w DOM + klasy `z-*` załatwiają warstwy, bez
kontenerów `absolute inset-0` i bez żonglowania `pointer-events`). `onDragEnd` czyta
`event.active.data.current?.entity` i dla `"object"` liczy
`applyObjectDragDelta(object, delta, scale, { width, height }, object.rotation)`, a dla stolika
zostaje przy `applyDragDelta` — istniejąca gałąź bez zmian. `draggedIdRef` i ochrona klik-vs-drag
obsługują oba typy (jeden ref, id są uuid). Sensory i `ResizeObserver` bez zmian.

#### 4. Warstwa stolików nad obiektami

**File**: `src/components/room/DraggableTable.tsx`

**Intent**: Wypchnąć stoliki nad obiekty i oznaczyć encję dla `onDragEnd`.

**Contract**: `useDraggable({ id: table.id, data: { entity: "table" } })`. Klasy warstwy: bazowa
`z-20`, przy `isDragging` `z-30` (dziś `:35` ma `z-10`). To **jedyne** zmiany w tym pliku —
pozycjonowanie, `touch-none` i reszta zostają nietknięte.

#### 5. Dialog obiektu

**File**: `src/components/room/RoomObjectDialog.tsx`

**Intent**: Jedyna ścieżka ustawiania rodzaju, wymiarów i obrotu w tej fazie — a zarazem trwała
ścieżka dostępna z klawiatury, także po dodaniu uchwytów w fazie 5.

**Contract**: Podział na zewnętrzny `Dialog` + wewnętrzny formularz z `key={object?.id ?? "new"}`,
żeby Radix resetował stan przez unmount, nie efektem (wzorzec `TableDialog.tsx:44-46`).
Props w konwencji `TableDialogProps`: `open`, `object`, `rooms`, `defaultRoomId`,
`defaultPosition`, `onOpenChange`, `onSubmit`. Pola: `kind` (`select` z
`ROOM_OBJECT_KIND_LABELS`; **zmiana rodzaju przy tworzeniu podstawia wymiary z
`ROOM_OBJECT_DEFAULT_SIZES`**, przy edycji istniejącego nie nadpisuje), `label` (opcjonalny),
`width` i `height` (`input type="number"` z `min`/`max` z `OBJECT_SIZE_BOUNDS`), `rotation`
(`input type="number"` 0–359 **plus przycisk „Obróć o 90°"** inkrementujący modulo 360 — bez tego
ustawienie ściany pionowo to ręczne wpisanie „90"), sala (`select`, jak w `TableDialog`).
Funkcja zapisu **nie łapie** wyjątku, żeby błąd propagował do formularza (idiom
`RoomLayoutManager`).

#### 6. Lista obiektów

**File**: `src/components/room/RoomObjectList.tsx`

**Intent**: Ścieżka a11y do wszystkich akcji — przeciąganie jest wskaźnikowe, więc lista jest
wymogiem, nie ozdobą (ten sam argument, co komentarz przy `TableList` w
`RoomLayoutManager.tsx:250-251`).

**Contract**: Props `{ objects: RoomObject[]; busyObjectId: string | null; onEdit; onDelete }`.
Wiersz: ikona rodzaju, etykieta rodzaju, opcjonalny `label`, wymiary i obrót jako podtytuł, akcje
**Edytuj** (`Pencil`) i **Usuń** (`Trash2`) — wzorzec `TableList.tsx`, tylko z akcją usuwania,
której `TableList` celowo nie ma.

#### 7. Orkiestracja i utrwalanie

**File**: `src/components/room/RoomLayoutManager.tsx` (rozszerzenie)

**Intent**: Dołożyć stan i mutacje obiektów, w tym optymistyczny zapis pozycji z **punktowym**
rollbackiem.

**Contract**: Nowy stan: `objectDialogOpen`, `editedObject`, `objectToDelete`, `busyObjectId`,
oraz **osobna** kolejka `objectPositionQueue = useRef(new Map<string, Promise<void>>())`.
`objectsInRoom` filtrowane po `activeRoom.id`. `nextFreeObjectPosition` — wolne miejsce w siatce,
analogicznie do `nextFreePosition` (`:105`), ale zwracające **środek**.
`saveObject` (`POST`/`PUT` + `await refetch()`, błąd propagowany do dialogu),
`confirmDeleteObject` (`DELETE` + `refetch()`, `AlertDialog` z tekstem mówiącym, że obiektu nie
da się przywrócić — wzorzec `confirmDeleteRoom` (`:219`)),
`persistObjectPosition(object, next)` — odwzoruj `persistPosition` (`:187-215`) **w jego obecnej,
po-triage'owej formie**, czyli trzy rzeczy naraz:

- łatka punktowa przez **funkcyjne** `setLayout` i własny odpowiednik `patchTablePosition` (`:26`)
  dla kolekcji `objects` — nigdy snapshot `{...layout}` z momentu wywołania, bo przy trzech
  kolekcjach w payloadzie gubiłby tym więcej równoległych zapisów (finding F2);
- **szeregowanie** żądań per `object.id` przez łańcuch promisów, a **nie** `AbortController`:
  `abort()` zamyka tylko połączenie klienta, więc żądanie już przekazane przez Workera commituje
  i starsza pozycja mogłaby wylądować w bazie jako ostatnia — po cichu, bo przerwana odpowiedź
  nigdy nie wraca (finding F3);
- **odpowiedź serwera jest autorytatywna** — po sukcesie wpisz `pos_x`/`pos_y` z odpowiedzi, bo
  serwerowy `clampObjectCenter` mógł je zmienić względem tego, co przewidział klient.

Przycisk „Dodaj obiekt" obok „Dodaj stolik" w nagłówku sali. `RoomCanvas` dostaje nowe propsy;
`RoomObjectList` renderuje się pod `TableList`.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm run test`
- Typy przechodzą: `npm run typecheck`
- Lint (w tym `jsx-a11y` i `react-hooks`) przechodzi: `npm run lint`
- Build SSR przechodzi: `npm run build`

#### Manual Verification:

- Dodanie ściany daje długi cienki prostokąt bez ręcznego wymiarowania; dodanie krzesła — mały
  kwadrat
- Przeciągnięcie obiektu myszą zapisuje pozycję; po odświeżeniu obiekt jest tam, gdzie go
  upuszczono
- To samo działa palcem i strona **nie przewija się** w trakcie przeciągania
- Obiekty rysują się **pod** stolikami; przeciągany obiekt nie przeskakuje nad stolik
- Obrót o 90° na ścianie ustawia ją pionowo i utrzymuje się po odświeżeniu; obrót o 45° nie
  pozwala wyjechać narożnikiem za kanwas
- Przeciąganie obróconego obiektu idzie **prosto pod kursorem**, nie po łuku (weryfikuje kolejność
  składania transformów)
- Zwężenie okna skaluje obiekty proporcjonalnie razem ze stolikami i drag nadal trafia pod kursor
- Usunięcie obiektu wymaga potwierdzenia, a po potwierdzeniu obiekt znika i nie wraca po
  odświeżeniu
- Cała ścieżka (dodaj / edytuj / usuń) jest wykonalna z klawiatury przez listę pod kanwasem
- Odcięcie sieci (DevTools offline) przy upuszczeniu cofa **tylko ten obiekt** na poprzednią
  pozycję i pokazuje komunikat; pozycje pozostałych obiektów i stolików zostają nietknięte

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych. **Faza 5 jest opcjonalna** — jeśli fazy 1–4 są
zielone, funkcja jest kompletna i można ją domknąć bez fazy 5.

---

## Phase 5: Uchwyty zmiany rozmiaru i obrotu (opcjonalna)

### Overview

Bezpośrednia manipulacja na kanwasie: zaznaczenie obiektu pokazuje uchwyty skalowania w
narożnikach i uchwyt obrotu. To wyznaczona linia cięcia planu — realnie tyle pracy, ile cały
kanwas ze stolikami, a fazy 1–4 dowożą pełną funkcję bez niej.

### Changes Required:

#### 1. Geometria uchwytów

**File**: `src/lib/room-geometry.ts` (rozszerzenie)

**Intent**: Utrzymać zasadę, że cała matematyka kanwasu żyje w czystym, testowanym module.

**Contract**: `applyResizeDelta(object, handle, delta, scale, rotation)` — przelicza deltę
wskaźnika na nowe `width`/`height` **i skorygowany środek** (skalowanie od narożnika przesuwa
środek o połowę przyrostu), przycina do `OBJECT_SIZE_BOUNDS`, potem przez `clampObjectCenter`.
`applyRotateDelta(center, pointer, scale)` — kąt z `Math.atan2` między środkiem a wskaźnikiem,
znormalizowany do `[0, 359]`, ze snapowaniem do 15° przy wciśniętym `Shift`. Oba czyste, oba
z testami w `src/lib/room-geometry.test.ts`.

#### 2. Zaznaczenie i uchwyty

**File**: `src/components/room/DraggableRoomObject.tsx`, `RoomCanvas.tsx`

**Intent**: Wprowadzić stan zaznaczenia i uchwyty, nie łamiąc rozdzielenia klik/drag.

**Contract**: `RoomCanvas` trzyma `selectedObjectId` (klik bez przeciągnięcia zaznacza; klik w tło
odznacza). **`DraggableRoomObject` przestaje być `<button>`** — uchwyty są elementami
interaktywnymi, a `<button>` w `<button>` jest niepoprawny; zamiast tego `<div role="button">` z
`tabIndex={0}` i obsługą `Enter`/`Space`, a `{...listeners}` przenoszą się na wewnętrzną
powierzchnię przeciągania, nie na korzeń. Uchwyty renderują się tylko dla zaznaczonego obiektu,
są obrócone razem z nim i **muszą zatrzymać propagację `pointerdown`**, inaczej `PointerSensor`
kanwasu potraktuje ich użycie jako drag obiektu. Zapis przez `PUT` obiektu na koniec gestu
(nie `PATCH position` — zmienia się rozmiar i obrót, nie pozycja), optymistycznie, z punktowym
rollbackiem.

### Success Criteria:

#### Automated Verification:

- Testy geometrii uchwytów przechodzą: `npm run test`
- Typy przechodzą: `npm run typecheck`
- Lint przechodzi: `npm run lint`
- Build SSR przechodzi: `npm run build`

#### Manual Verification:

- Kliknięcie obiektu zaznacza go i pokazuje uchwyty; kliknięcie w tło odznacza
- Ciągnięcie uchwytu narożnego zmienia rozmiar, a nie przesuwa obiektu
- Ciągnięcie uchwytu obrotu obraca obiekt wokół środka; `Shift` snapuje do 15°
- Uchwyty działają palcem i nie powodują przewijania strony
- Ścieżka klawiaturowa z fazy 4 (lista + dialog) nadal działa i daje ten sam wynik

**Implementation Note**: Po tej fazie i przejściu weryfikacji automatycznej zatrzymaj się i
potwierdź z człowiekiem wynik testów manualnych.

---

## Testing Strategy

### Unit Tests:

- `src/lib/room-geometry.test.ts` — `rotatedFootprint` (0°, 90°, 180°, 45°), `clampObjectCenter`
  (dosunięcie do każdej krawędzi, **przypadek zdegenerowany** AABB > kanwas, całkowitość,
  nieujemność), `applyObjectDragDelta` (skala 1, 0.5, 2, delta wypychająca poza kanwas),
  a w fazie 5 `applyResizeDelta` i `applyRotateDelta`. **16 istniejących testów stolików musi
  przejść bez modyfikacji** — to jest test poprawności wrapperów.
- `src/lib/schemas/room.test.ts` — granice `rotation` (−1, 0, 359, 360, niecałkowity), `width` i
  `height` (9, 10, 1200, 1201, 801), nieznany `kind`, `label` pusty → `null`.

### Integration Tests:

- `supabase/tests/rls_isolation.sql` — asercje 14–16: właściciel zapisuje **i usuwa** obiekt
  (kontrast z asercją 9, gdzie stolika usunąć nie może); kelner czyta, ale nie zapisuje i nie
  usuwa; izolacja międzyfirmowa; własne `company_id` + obce `room_id` → `23503`; kaskada obiektów
  przy usunięciu sali; anon widzi 0 obiektów.

### Manual Testing Steps:

1. Zaloguj się jako właściciel, wejdź na `/room`, wybierz „Sala główna"
2. Dodaj ścianę — powinna pojawić się jako długi cienki prostokąt, nie kwadrat
3. Obróć ją o 90° przyciskiem w dialogu — staje pionowo; odśwież stronę — obrót utrzymany
4. Ustaw obrót na 45° i przeciągnij ścianę w narożnik — narożnik obiektu zatrzymuje się na
   granicy kanwasu, nie wyjeżdża za nią
5. Przeciągnij obróconą ścianę na środku ekranu — idzie prosto pod kursorem, nie po łuku
6. Dodaj krzesło i przeciągnij je na stolik — krzesło rysuje się **pod** stolikiem
7. Zwęź okno do ~700 px i przeciągnij obiekt — trafia pod kursor (konwersja skali)
8. Powtórz przeciąganie palcem (lub emulacją dotyku) — działa i strona się nie przewija
9. Usuń krzesło z listy pod kanwasem — pojawia się potwierdzenie; po potwierdzeniu znika i nie
   wraca po odświeżeniu
10. Wykonaj cały cykl (dodaj / edytuj / usuń) wyłącznie z klawiatury przez listę
11. Włącz DevTools offline i przeciągnij obiekt — cofa się **tylko on**, z komunikatem; pozycje
    pozostałych obiektów i stolików bez zmian
12. Usuń salę, w której są obiekty ale nie ma stolików — udaje się, obiekty znikają razem z nią
13. Dodaj stolik do tej sali i spróbuj ją usunąć — komunikat 409, sala zostaje
14. Zaloguj się jako kelner (po scaleniu S-02) — `/room` przekierowuje na `/dashboard`
15. W drugiej firmie sprawdź, że nie widać obiektów pierwszej

## Performance Considerations

Skala jest mała — dziesiątki obiektów na salę — więc zapis per-upuszczenie nie wymaga
batchowania, tak samo jak przy stolikach. Trzecia kolekcja w payloadzie `GET /api/room` dokłada
jedno zapytanie do istniejącego `Promise.all`, czyli zero dodatkowych round-tripów.

Dwie rzeczy warte pilnowania. Po pierwsze, `rotatedFootprint` liczy dwa `Math.sin`/`Math.cos` na
wywołanie i jest wołany w `clampObjectCenter`, czyli raz na `onDragEnd` — nie w pętli renderu.
Nie wolno go przenieść do ciała komponentu bez memoizacji. Po drugie, dnd-kit przesuwa węzeł
transformem CSS, więc nie ruszamy stanu na `onDragMove` i nie zapisujemy nic przed `onDragEnd` —
ta zasada z S-06 obowiązuje bez zmian, a przy obrocie jest ważniejsza, bo `transform` łączy teraz
dwie operacje i przeliczanie go w stanie kosztowałoby re-render na każdą klatkę.

## Migration Notes

Migracja tworzy nową tabelę, więc nie ma backfillu ani ryzyka na istniejących danych. Trzy rzeczy
do odnotowania:

1. **Twarda zależność kolejności.** Composite FK wymaga `rooms_company_id_id_key`, który dodaje
   `20260728120000_room_tables_composite_fk.sql`. Ta migracja jest dziś **niezacommitowana i
   niewypchnięta**. Bez niej migracja obiektów padnie na tworzeniu FK.
2. **`supabase db push` odmawia w tej gałęzi**, bo hostowana baza ma dwie migracje S-02
   (`20260727220415`, `20260728101449`) nieobecne lokalnie. Faza 2 startuje po scaleniu S-02 i
   rebase na `main` — to prerekwizyt, nie ryzyko.
3. **Timestamp do zweryfikowania przed utworzeniem pliku.** `20260729120000` sortuje się po
   wszystkim znanym dziś, ale S-02 może dołożyć nowsze migracje do czasu scalenia — sprawdź
   `supabase migration list --linked` i podnieś, jeśli trzeba.

Rollback: Supabase nie trzyma `down`, więc cofnięcie oznacza nową migrację z
`drop table public.room_objects` i `drop type public.room_object_kind`. W przeciwieństwie do S-06
jest to bezpieczne i kompletne — tabela jest nowa, nic na nią nie wskazuje, żadna kolumna
istniejącej tabeli nie została zmieniona.

## References

- Notatki zmiany: `context/changes/room-objects/change.md`
- Poprzedni slice tej samej domeny: `context/changes/room-layout-tables/plan.md`
- Findingi, z których ta zmiana bierze wzorce (F1, F2, F5, F6):
  `context/changes/room-layout-tables/reviews/impl-review.md`
- Wzorzec czterech polityk per-operacja **z delete**:
  `supabase/migrations/20260727120000_room_layout_tables.sql:46-73`
- Wzorzec composite FK dla najemcy: `supabase/migrations/20260728120000_room_tables_composite_fk.sql`
- Wzorzec asercji izolacji: `supabase/tests/rls_isolation.sql` (asercja 9 — odmowa usunięcia,
  asercja 12 — izolacja, asercja 13 — composite FK)
- Wzorzec route'a i guarda: `src/pages/api/room/tables.ts`, `src/lib/room-api.ts:18`
- Wzorzec gorącej ścieżki pozycji: `src/pages/api/room/tables/[id]/position.ts:33-37`
- Wzorzec węzła przeciąganego i `touch-none`: `src/components/room/DraggableTable.tsx:28-48`
- Wzorzec optymistycznej mutacji (punktowa łatka + szeregowanie, po triage `0f2685d`):
  `src/components/room/RoomLayoutManager.tsx:187-215`
- Wzorzec dialogu z resetem przez unmount: `src/components/room/TableDialog.tsx:44-46`
- Lekcja o anon RLS bez `company_id`: `context/foundation/lessons.md:5-20`
- PRD: FR-008 pokrywa **wyłącznie stoliki** — ta zmiana nie realizuje żadnego FR

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Geometria i kontrakty (bez bazy)

#### Automated

- [x] 1.1 Testy jednostkowe przechodzą, w tym 16 istniejących testów geometrii bez modyfikacji: `npm run test` — 3c8612f
- [x] 1.2 Typy przechodzą: `npm run typecheck` — 3c8612f
- [x] 1.3 Lint przechodzi: `npm run lint` — 3c8612f

#### Manual

- [x] 1.4 Sanity-check AABB: 400×20 @45° ≈ 297×297, a 1200×20 @45° wyśrodkowuje `pos_y` na 400 — 3c8612f

### Phase 2: Migracja, RLS i test izolacji

#### Automated

- [ ] 2.1 Migracja aplikuje się czysto: `npm run db:push`
- [ ] 2.2 Test izolacji przechodzi, w tym asercja 13 bez `SKIP`: `npm run test:rls`
- [ ] 2.3 Typy i lint bez regresji: `npm run typecheck` oraz `npm run lint`

#### Manual

- [ ] 2.4 Polityki na `room_objects` to dokładnie select_staff / insert_owner / update_owner / delete_owner, żadnej `to anon`
- [ ] 2.5 `rotation = 400` i `width = 5` odrzucone przez `CHECK`
- [ ] 2.6 Usunięcie sali z obiektami bez stolików udaje się i kasuje obiekty; ta sama sala ze stolikiem daje `23503`
- [ ] 2.7 Kasowanie firmy nadal przechodzi — kaskada obiektów nie wprowadziła blokady

### Phase 3: API obiektów

#### Automated

- [ ] 3.1 Testy przechodzą: `npm run test`
- [ ] 3.2 Typy przechodzą: `npm run typecheck`
- [ ] 3.3 Lint przechodzi: `npm run lint`

#### Manual

- [ ] 3.4 `GET /api/room` zwraca `objects` obok `rooms` i `tables`, tylko własnej firmy
- [ ] 3.5 `POST /api/room/objects` z obcym `room_id` daje 400 z komunikatem PL, nie 500
- [ ] 3.6 `DELETE /api/room/objects/{id}` na własnym obiekcie daje 200, na cudzym 404
- [ ] 3.7 `PATCH …/position` poza kanwasem zapisuje wartość przyciętą i nie zmienia `width`/`height`/`rotation`
- [ ] 3.8 Kelner dostaje 403 na każdym zapisie obiektu i 200 na `GET /api/room`

### Phase 4: UI — obiekty na kanwasie, dialog, lista, usuwanie

#### Automated

- [ ] 4.1 Testy przechodzą: `npm run test`
- [ ] 4.2 Typy przechodzą: `npm run typecheck`
- [ ] 4.3 Lint przechodzi: `npm run lint`
- [ ] 4.4 Build SSR przechodzi: `npm run build`

#### Manual

- [ ] 4.5 Dodanie ściany daje długi cienki prostokąt, dodanie krzesła mały kwadrat
- [ ] 4.6 Przeciągnięcie myszą zapisuje pozycję i utrzymuje się po odświeżeniu
- [ ] 4.7 Przeciąganie palcem działa i strona się nie przewija
- [ ] 4.8 Obiekty rysują się pod stolikami, także w trakcie przeciągania
- [ ] 4.9 Obrót o 90° utrzymuje się po odświeżeniu; przy 45° narożnik nie wyjeżdża za kanwas
- [ ] 4.10 Przeciąganie obróconego obiektu idzie prosto pod kursorem, nie po łuku
- [ ] 4.11 Zwężenie okna skaluje obiekty razem ze stolikami i drag nadal trafia pod kursor
- [ ] 4.12 Usunięcie wymaga potwierdzenia, po nim obiekt nie wraca po odświeżeniu
- [ ] 4.13 Cała ścieżka dodaj/edytuj/usuń jest wykonalna z klawiatury przez listę
- [ ] 4.14 Błąd sieci przy upuszczeniu cofa tylko ten obiekt; pozostałe pozycje nietknięte

### Phase 5: Uchwyty zmiany rozmiaru i obrotu (opcjonalna)

#### Automated

- [ ] 5.1 Testy geometrii uchwytów przechodzą: `npm run test`
- [ ] 5.2 Typy przechodzą: `npm run typecheck`
- [ ] 5.3 Lint przechodzi: `npm run lint`
- [ ] 5.4 Build SSR przechodzi: `npm run build`

#### Manual

- [ ] 5.5 Kliknięcie zaznacza obiekt i pokazuje uchwyty; kliknięcie w tło odznacza
- [ ] 5.6 Uchwyt narożny zmienia rozmiar, a nie przesuwa obiektu
- [ ] 5.7 Uchwyt obrotu obraca wokół środka; `Shift` snapuje do 15°
- [ ] 5.8 Uchwyty działają palcem i nie przewijają strony
- [ ] 5.9 Ścieżka klawiaturowa z fazy 4 nadal działa i daje ten sam wynik
