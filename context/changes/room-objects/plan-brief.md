# Obiekty wyposażenia sali (`room_objects`) — Plan Brief

> Full plan: `context/changes/room-objects/plan.md`

## What & Why

Edytor schematu sali (`/room`) umie dziś tylko stoliki, więc plan sali nie przypomina prawdziwego
lokalu i mapowanie kodów QR na fizyczne miejsca jest trudniejsze, niż być musi. Ta zmiana dokłada
encję `room_objects` — dziewięć rodzajów wyposażenia (ściana, krzesło, drzwi, okno, bar, roślina,
schody, toaleta, kasa) z własnymi wymiarami i swobodnym obrotem. Encja jest celowo osobna od
`tables`, bo różni się w rzeczy najważniejszej: **obiekty wolno usuwać**.

## Starting Point

S-06 (`room-layout-tables`) dowiozło `public.rooms`, kolumny układu na `public.tables`, API pod
`src/pages/api/room/**` i kanwas dnd-kit z geometrią w `src/lib/room-geometry.ts`. Gałąź jest
jednak niedomknięta: migracja `20260728120000_room_tables_composite_fk.sql` (naprawa findingów
impl-review F1/F6) leży niezacommitowana, a `supabase db push` **odmawia**, bo hostowana baza ma
dwie migracje S-02 nieobecne w tej gałęzi. Do tego cała geometria jest kluczowana `TableShape`, nie
footprintem, więc obiekt o dowolnych wymiarach nie ma jak z niej skorzystać bez refaktoru.

## Desired End State

Właściciel dodaje obiekt wybranego rodzaju, dostaje go w rozsądnym domyślnym rozmiarze (ściana
400×20, krzesło 40×40), przeciąga myszą albo palcem, ustawia wymiary i obrót w dialogu, i może go
**usunąć** po potwierdzeniu. Obiekty rysują się pod stolikami, każdy z ikoną swojego rodzaju. Pod
kanwasem jest lista dostępna z klawiatury z akcjami Edytuj i Usuń. Na poziomie bazy: kelner nic nie
zapisze, firma A nie widzi obiektów firmy B, a obiekt firmy A **nie może** wskazywać na salę firmy
B — bo tego pilnuje composite FK, nie kod aplikacji.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Blokada `db:push` | Faza 2 czeka na scalenie S-02 i rebase na `main` | Jedna ścieżka prawdy zamiast rozjazdu historii migracji; odblokowuje też zaległą `20260728120000`. | Plan |
| Fazowanie wobec blokady | Geometria i kontrakty jako faza 1, bez bazy | Front-loaduje całe ryzyko matematyczne i domyka je zielonymi testami, zamiast czekać bezczynnie. | Plan |
| Model rotacji | Swobodna 0–359° | Skosy i orientacja rodzajów asymetrycznych; sam pion dałby się zrobić wymiarami. | Plan |
| Semantyka pozycji | `pos_x`/`pos_y` to **środek** obiektu, nie lewy górny róg | Przy lewym górnym rogu clamp obróconego obiektu produkuje ujemne współrzędne, których nie przepuści ani zod, ani `CHECK`. | Plan |
| Clampowanie obrotu | AABB obróconego prostokąta | Inwariant „nic nie wystaje" trzyma dla każdego kąta i jest dokładnie testowalny. | Plan |
| Refaktor geometrii | Rdzeń na footprincie + wrappery kluczowane kształtem | Zero zmian w ścieżkach stolików, 16 istniejących testów przechodzi bez modyfikacji. | Plan |
| Rozmiar i obrót w UI | Najpierw dialog, uchwyty jako opcjonalna faza 5 | Encja kompletna i dostępna z klawiatury najkrótszą drogą; uchwyty to praca rzędu całego kanwasu. | Plan |
| Kolumny ponad minimum | Tylko `label`; bez `is_active`, bez `z_index` | Obiekty są usuwalne, więc dezaktywacja jest zbędna; niepodłączona kolumna porządku to dług (F9). | Plan |
| Kształt API | `objects` w agregacie `GET /api/room` + `/api/room/objects/**` | Kanwas potrzebuje stolików i obiektów naraz, więc jeden fetch i jeden stan. | Plan |
| FK do sali | Composite `(company_id, room_id)` + `on delete cascade` | Finding F1: FK jest sprawdzany pod RLS, więc kontrola w kodzie nie jest inwariantem; kaskada, bo stoliki i tak blokują usunięcie sali, więc obiekty giną tylko z sali już opróżnionej. | Impl-review S-06 |
| Zapis pozycji | Punktowa łatka + szeregowanie per id (bez `abort()`) | Findingi F2/F3, naprawione dla stolików w `0f2685d`: snapshot gubi równoległe zapisy, a `abort()` nie zapobiega commitowi na serwerze. | Impl-review S-06 |
| Render rodzajów | Ikona lucide + kolor | Ściana szeroka na 20 px nie pomieści tekstu; ikona jest czytelna przy skali 0.5. | Plan |
| Usuwanie | Potwierdzenie w `AlertDialog` | Spójne z jedyną istniejącą ścieżką destrukcyjną w repo; undo byłoby zupełnie nowym wzorcem. | Plan |
| Wymiary | Domyślne per rodzaj, granice wspólne 10–1200 / 10–800 | „Dodaj ścianę" ma od razu dawać cienki prostokąt, a walidacja ma zostać w jednym miejscu. | Plan |

## Scope

**In scope:** tabela `room_objects` z enumem dziewięciu rodzajów, composite FK, `CHECK`i i cztery
polityki RLS **w tym DELETE** · asercje izolacji 14–16 · rdzeń geometrii na footprincie + AABB
obrotu · typy i schematy zod · `/api/room/objects/**` (POST/PUT/DELETE/PATCH position) · obiekty na
kanwasie pod stolikami · dialog rodzaj/opis/wymiary/obrót · lista a11y · usuwanie z potwierdzeniem ·
opcjonalnie uchwyty resize/rotate.

**Out of scope:** jakakolwiek zmiana w `tables` (w tym handler DELETE) · naprawa
`tables_anon_read_active` (dług S-07, finding F8) · `is_active` i `z_index` na obiektach · numer i
unikalność · blokowanie nachodzenia · zoom i panoramowanie · seedowanie domyślnych obiektów ·
refaktor `src/lib/api.ts` (konflikt z S-02) · sanacja findingów F2/F3/F4/F7/F9/F10 w kodzie
stolików · undo dla usunięcia.

## Architecture / Approach

Ta sama warstwowość co S-06, z jedną nową encją równoległą do `tables`:

```
room_objects (RLS: 4 polityki, w tym DELETE; composite FK → rooms)
      ↓
GET /api/room  →  { rooms, tables, objects }        ← jeden fetch, jeden stan
POST/PUT/DELETE /api/room/objects/**  ·  PATCH /objects/[id]/position
      ↓
useRoomLayout  →  RoomLayoutManager (stan + optymistyczny zapis pozycji)
      ↓
RoomCanvas  =  jeden DndContext
                 ├─ DraggableRoomObject  z-0 / z-10   ← pod stolikami
                 └─ DraggableTable       z-20 / z-30
      ↓
src/lib/room-geometry.ts  =  rdzeń na footprincie (obiekty, pozycja = środek)
                             + wrappery na kształcie (stoliki, pozycja = róg)
```

Rozdzielenie encji w `onDragEnd` idzie przez `data: { entity }` w `useDraggable`, nie przez
szukanie uuid w dwóch tablicach. Warstwy wynikają z kolejności w DOM plus jawnych klas `z-*` — bez
kontenerów `absolute inset-0` i bez żonglowania `pointer-events`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Geometria i kontrakty | Rdzeń footprintowy, AABB obrotu, typy, schematy zod, testy — bez bazy | AABB i clamp środka: pomyłka jest niewidoczna przy `rotation = 0` i `scale = 1` |
| 2. Migracja, RLS, test izolacji | Tabela z composite FK, cztery polityki (z DELETE), asercje 14–16 | Zablokowana do scalenia S-02; wymaga też zaaplikowania zaległej `20260728120000` |
| 3. API obiektów | `/api/room/objects/**` + `objects` w agregacie | Pierwszy handler DELETE w drzewie — musi być odróżnialny od świadomego braku przy stolikach |
| 4. UI | Obiekty na kanwasie, dialog, lista a11y, usuwanie | Kolejność składania transformów CSS: odwrotna sprawia, że obiekt ucieka po łuku |
| 5. Uchwyty (opcjonalna) | Resize i rotate bezpośrednio na kanwasie | Realnie tyle pracy, ile cały kanwas; `DraggableRoomObject` musi przestać być `<button>` |

**Prerequisites:** S-06 wdrożone (jest) · **S-02 scalone do `main` i gałąź zrebase'owana** —
inaczej `supabase db push` odmawia i faza 2 nie ruszy · `20260728120000_room_tables_composite_fk.sql`
zacommitowana i zaaplikowana (dostarcza `rooms_company_id_id_key` dla composite FK).

**Estimated effort:** ~4–5 sesji na fazy 1–4, plus ~1–2 sesje na opcjonalną fazę 5. Faza 1 idzie
od razu; fazy 2–4 czekają na S-02.

## Open Risks & Assumptions

- **Faza 2 jest zablokowana zewnętrznie.** Termin scalenia S-02 jest poza kontrolą tej zmiany;
  jeśli się przesunie, po fazie 1 nie ma czym kontynuować.
- **Zaległa migracja `20260728120000` musi wejść pierwsza.** Nie jest zacommitowana; gdyby została
  porzucona albo przepisana, composite FK obiektów traci swój unique constraint.
- **Wzorzec zapisu pozycji zmienił się pod tą zmianą.** Triage S-06 (`0f2685d`) zastąpił
  `AbortController` szeregowaniem promisów per id; faza 4 musi odwzorować nową wersję, bo powrót do
  przerywania żądań zreintrodukowałby finding F3.
- **`lucide-react@1.14.0` nie ma ikony `Stairs`** (zweryfikowane) — plan używa `ChevronsUp`, co
  jest kompromisem czytelności.
- Założenie: dziesiątki obiektów na salę, nie setki. Przy setkach zapis per-upuszczenie i render
  bez wirtualizacji trzeba by przemyśleć od nowa.
- Rola kelnera pozostaje niesprawdzalna manualnie do scalenia S-02 — tak samo jak w S-06
  (nieobserwowane rzędy 2.7 i 3.4). Odmowa na poziomie DB jest natomiast dowodzona asercją 15.

## Success Criteria (Summary)

- Właściciel projektuje rozpoznawalny plan sali: ściany, bar, toaleta i krzesła obok stolików —
  przeciągane myszą i palcem, obracane, wymiarowane, usuwalne.
- Cała ścieżka (dodaj / edytuj / usuń) jest wykonalna z klawiatury, nie tylko wskaźnikiem.
- `npm run test:rls` dowodzi, że właściciel obiekt usunąć **może**, kelner nie może nic, firmy się
  nie widzą, a obiekt nie może wskazać na salę innej firmy.
