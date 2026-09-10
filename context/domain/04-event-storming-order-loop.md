---
title: "OrderLY — Event Storming pętli zamówienia (rachunek stolika)"
created: 2026-09-06
type: event-storming
---

# Event Storming: pętla zamówienia — od skanu QR do zamknięcia rachunku

> Warsztat, nie plan. Przeprowadzony na żywej tablicy (`event-storming-canvas`,
> `board.json`, fazy 1–3), z agentem w roli moderatora. Dokument porównuje wynik
> warsztatu z `context/domain/01-domain-distillation.md` (rozjazdy R-01…R-08)
> i konfrontuje go z `context/domain/02-invariant-aggregate-refactor.md`
> (niezmienniki N-01…N-11, projekt agregatu `Order`).

## KROK 0 — Dlaczego ten proces

`01-domain-distillation.md` (KROK 5) stawia **Zamówienie (otwarty rachunek stolika)**
na miejscu #1 rankingu refaktoru: wartość maksymalna (Kryterium sukcesu #1,
`prd.md:58-60`; cała sekcja Business Logic `prd.md:187-208`), ryzyko maksymalne —
5/5 niezmienników agregatu A1 w statusie *ignoruje*, bo bytu nie ma w kodzie.

Warsztat modeluje dokładnie tę pętlę: **skan QR → sesja stolika → dokładanie pozycji →
statusy przygotowania → rozliczenie w kasie → jawne zamknięcie → koniec sesji.**

## KROK 1 — Przebieg warsztatu

| Faza | Wynik |
| --- | --- |
| 1 · Chaotic Exploration | 20 zdarzeń domenowych, nieuporządkowanych, w czasie przeszłym |
| 2 · Timeline | 14 zdarzeń na osi głównej + 7 na ścieżkach alternatywnych; 2 scalenia, 3 zdarzenia dołożone jako luki |
| 3 · Hotspots | 14 czerwonych hotspotów nałożonych na oś czasu |

### Decyzje modelarskie w fazie 2

- **Scalenie:** „Pozycja dodana do zamówienia" + „Pozycja dołożona do otwartego
  rachunku" → jedno zdarzenie. W modelu otwartego rachunku (FR-015 `prd.md:166-167`)
  to ten sam akt; dwie karteczki sugerowałyby dwie różne operacje i dwa różne guardy.
- **Scalenie:** „Pozycja oznaczona jako wyprzedana" → przypadek szczególny „Dostępność
  pozycji zmieniona" (enum trójstanowy, `20260708124756:15`).
- **Luki dołożone przez oś czasu** (nie było ich w burzy): „Rachunek stolika zastany
  jako otwarty", „Pozycja wyprzedała się po dodaniu do rachunku", „Sesja stolika
  wygasła bez zamknięcia". Wszystkie trzy okazały się nośne — patrz KROK 4.

### Oś główna (14 zdarzeń, lewo → prawo)

Kod QR stolika zeskanowany → Sesja stolika otwarta → Menu lokalu wyświetlone →
Pozycja dodana do otwartego rachunku → Zamówienie złożone → Zamówienie pokazane
w panelu personelu → Pozycja pokazana na kitchen display → Pozycja przesunięta na
„w toku" → Pozycja oznaczona jako gotowa → Pozycja zrealizowana → Rachunek
podsumowany → Płatność rozliczona w kasie → Zamówienie zamknięte → Sesja stolika
zakończona

### Ścieżki alternatywne (7 zdarzeń)

Rachunek stolika zastany jako otwarty · Dostępność pozycji zmieniona · Próba
zamówienia niedostępnej pozycji odrzucona · Zamówienie utworzone przez kelnera ·
Pozycja wyprzedała się po dodaniu do rachunku · Pozycja skorygowana przez kelnera ·
Sesja stolika wygasła bez zamknięcia

## KROK 2 — Hotspoty (14)

| ID | Hotspot |
| --- | --- |
| hot-01 | Stały QR per stolik nie jest generowany — jest tylko `companies.code` |
| hot-02 | Anonimowa sesja: co wiąże ją ze stolikiem i **kiedy wygasa**? |
| hot-03 | Drugi gość skanuje ten sam QR — dołącza do rachunku czy otwiera nowy? |
| hot-04 | Anon nie odczyta dziś z bazy niczego — polityki anon usunięte, brak projekcji |
| hot-05 | Kto egzekwuje „tylko dostępne pozycje" — schemat czy route? |
| hot-06 | Kelner nie ma ścieżki zapisu — dostępność i zamówienia są owner-only |
| hot-07 | Panel i kuchnia: polling czy realtime? Po jakim czasie widać nową pozycję? |
| hot-08 | Kitchen display nie istnieje w kodzie — FR-017/018 bez implementacji |
| hot-09 | Pozycja wyprzedała się **po dodaniu** — kto zdejmuje ją z rachunku? |
| hot-10 | „Gotowa" (kuchnia) to ten sam status co „zrealizowane"? 3 statusy czy 4? |
| hot-11 | Kwota rachunku z cen bieżących czy z chwili dodania pozycji? |
| hot-12 | Płatność jest poza systemem — brak zdarzenia, na którym można oprzeć zamknięcie |
| hot-13 | Zamknięcie odcina edycję klienta — gdzie żyje ten niezmiennik? Brak agregatu `Order` |
| hot-14 | Brak zamknięcia = wieczna sesja stolika. Timeout? Kto sprząta? |

## KROK 3 — Hotspoty vs rozjazdy z destylacji (R-01…R-08)

### Trafienia — 6 z 8 rozjazdów wyszło na tablicy niezależnie

| Rozjazd (`01-domain-distillation.md`, KROK 4) | Hotspot | Charakter zgodności |
| --- | --- | --- |
| R-01 pętla zamówienia nie istnieje w kodzie | hot-13, hot-05, hot-10 | pełna — warsztat rozbił jeden duży brak na trzy pytania o konkretne niezmienniki |
| R-02 kelner bez ścieżki zapisu (owner-only na 3 warstwach) | hot-06 | pełna, ta sama treść |
| R-03 brak generowania stałego QR; istnieje tylko prekursor `companies.code` | hot-01 | pełna, ta sama treść |
| R-04 anon nie odczyta z bazy niczego (polityki usunięte `20260813010000:54-60`) | hot-04, hot-02 | pełna |
| R-05 rewizja statusów 4 → 3 (`OrderLY-MVP.md:30` vs `prd.md:164-165`) | hot-10 | **częściowa, ostrzejsza** — patrz niżej |
| „kitchen display BRAK w kodzie" (KROK 1, słownik) | hot-08 | trafienie w treść, która w destylacji nie awansowała do tabeli rozjazdów |

**O R-05.** Destylacja zapisała rewizję jako rozjazd *dokument↔dokument*: PRD zastąpił
4 statusy trzema. Warsztat pokazał, że rewizja zostawiła osad w **procesie**: FR-018
(`prd.md:177-178`) każe kuchni „oznaczać pozycje jako gotowe", a FR-014 zna wyłącznie
`nowe → w toku → zrealizowane`. Na osi czasu „gotowa" i „zrealizowana" to dwa różne
momenty (kuchnia kończy / kelner wydaje), a model daje na nie jeden stan.

### Pudła — 2 rozjazdy poza zasięgiem metody

| Rozjazd | Dlaczego warsztat nie mógł go znaleźć |
| --- | --- |
| R-06 `profiles.login` deklarowany jako niezmienny, nieegzekwowany w DB | Dotyczy tożsamości personelu, nie pętli zamówienia — poza zakresem tej tablicy |
| R-07 roadmapa `proposed` vs zrealizowany kod (S-02, S-04, S-06) | Rozjazd meta: dokument-procesu ↔ kod. Event Storming modeluje domenę, nie stan projektu |

To nie luki warsztatu, tylko granica metody — i ona sama jest informacją:

- **Destylacja** czyta dokumenty przeciw kodowi → znajduje rozjazdy typu
  *„jest / nie ma / deklaruje, ale nie egzekwuje"*.
- **Warsztat** czyta proces wzdłuż osi czasu → znajduje rozjazdy typu
  *„co się dzieje pomiędzy krokami"*: zmianę stanu w trakcie, współbieżność,
  brak terminacji.

Sześć hotspotów z czternastu (hot-03, hot-07, hot-09, hot-11, hot-12, hot-14) nie ma
odpowiednika w R-01…R-08 i **wszystkie dotyczą czasu** — bo oś X tablicy to czas.

## KROK 4 — Konfrontacja z projektem agregatu (`02-invariant-aggregate-refactor.md`)

Plan agregatu powstał po destylacji i część hotspotów zamknął, zanim je postawiono.
Rozliczenie wszystkich 14:

| Hotspot | Status wobec planu agregatu | Dowód w `02-invariant-aggregate-refactor.md` |
| --- | --- | --- |
| hot-05 kto egzekwuje dostępność | **zamknięty** | N-07 + trigger `guard_order_item_available` + błąd `ITEM_UNAVAILABLE` (`:43,175,212`) |
| hot-13 gdzie żyje niezmiennik zamknięcia | **zamknięty** | N-08 + `guard_order_transition` + `guard_order_items_parent_open` (`:44,435-437`) |
| hot-10 „gotowa" vs „zrealizowane" | **zamknięty** | N-09: 3 statusy per pozycja; kuchnia ma wyłącznie `advanceItem` (`:45,167`). Korekty wstecz świadomie odrzucone — Open Question #2 |
| hot-11 cena bieżąca czy z chwili dodania | **zamknięty jako założenie** | `name_snapshot` / `price_snapshot` (`:148-149,262-263,314-317`) — ale sam plan oznacza to jako Open Question #1: „PRD nie rozstrzyga wprost" |
| hot-03 drugi gość, ten sam QR | **zamknięty strukturalnie** | indeks `orders_one_open_per_table` (`:376`) — jeden otwarty rachunek na stolik, więc drugi gość **dołącza** |
| hot-04 anon nie odczyta z bazy | **zaadresowany** | funkcja-projekcja `public_menu(venue_code)` SECURITY DEFINER (`:330,373`) |
| hot-06 ścieżka kelnera | **zaadresowany** | RPC dostępne dla kelner+właściciel (`:328`); realizacja w S-10 |
| hot-01 generowanie QR · hot-02 wiązanie sesji | **odroczone jawnie** | „mechanizm tokenu anonimowej sesji należy do S-07/S-08" (`:401`) |
| hot-08 kitchen display | **odroczone jawnie** | S-11 (`:82,396`) |
| **hot-09 wyprzedanie po dodaniu** | **OTWARTY** | N-07 jest bramą **wejścia**; brak jakiejkolwiek reguły na zmianę dostępności po dodaniu pozycji do otwartego rachunku |
| **hot-14 terminacja bez zamknięcia** | **OTWARTY** | zero wystąpień `timeout` / `wygasa` / `expire` w całym planie |
| **hot-07 próg widoczności (polling)** | **OTWARTY** | polling wybrany jako symplifikacja MVP (`roadmap.md:154`), ale akceptowalne opóźnienie nie pada nigdzie |
| **hot-12 płatność poza systemem** | **OTWARTY (ryzyko rezydualne)** | `close` jest jawną akcją personelu (`:227-230`) — projekt poprawny, ale niezmiennik „rachunek zamknięty ⇒ zapłacono" opiera się na dyscyplinie człowieka, nie na stanie |

### Wniosek: cztery hotspoty przeżyły oba dokumenty

Najostrzejszy jest **hot-14 w połączeniu z hot-03**, i tylko warsztat mógł go
wyprodukować, bo wymaga zestawienia dwóch odległych punktów osi czasu:

> Plan wprowadza `orders_one_open_per_table` — **jeden otwarty rachunek na stolik**
> (`02-invariant-aggregate-refactor.md:376`). Jednocześnie jedynym sposobem zamknięcia
> rachunku jest jawna akcja personelu (N-08, FR-019 `prd.md:170-171`), a **nic nie
> wygasza rachunku porzuconego**. Zderzenie tych dwóch faktów: stolik z rachunkiem,
> którego personel zapomniał zamknąć, jest **trwale zablokowany** — kolejny gość
> skanuje QR i, zgodnie z hot-03, **dziedziczy cudzy otwarty rachunek** wraz z jego
> pozycjami i kwotą.

Żaden z dokumentów tego nie widzi, bo każdy patrzy na jeden koniec procesu: destylacja
na brak bytu, plan agregatu na poprawność przejścia `open → closed`. Rozjazd leży
w tym, czego **nie ma między nimi** — w braku ścieżki wyjścia innej niż szczęśliwa.

## KROK 5 — Rekomendacje

| # | Rekomendacja | Uzasadnienie | Umiejscowienie |
| --- | --- | --- | --- |
| 1 | **Rozstrzygnąć terminację rachunku przed migracją F1** (auto-zamknięcie po czasie / zamknięcie przy zamknięciu lokalu / jawne „porzuć rachunek" dla personelu) | `orders_one_open_per_table` czyni brak terminacji błędem blokującym stolik, nie kosmetyką. Niezmiennik schematu, nie logika route'a | `02-invariant-aggregate-refactor.md`, F1 |
| 2 | **Zdefiniować zachowanie pozycji, która wyprzedała się po dodaniu** (zostaje i kuchnia odmawia / kelner zdejmuje / auto-anulowanie z powiadomieniem) | Otwarty rachunek żyje godzinami; brama wejścia N-07 nie chroni tego okna | Open Question do PRD; potem trigger/RPC |
| 3 | **Dopisać do hot-03 pytanie o widoczność** — czy gość B, dołączając do otwartego rachunku, widzi pozycje gościa A? | `orders_one_open_per_table` rozstrzyga *strukturę*, nie *prywatność* i nie UX rachunku współdzielonego | `prd.md`, US-01 |
| 4 | **Podać próg opóźnienia dla pollingu** (np. „nowa pozycja widoczna na kitchen display < 10 s") | Bez progu „polling zamiast WebSocketów" nie jest testowalne; Kryterium sukcesu #1 mówi o pętli end-to-end | `prd.md`, Non-Functional |
| 5 | **Awansować Open Question #1 (snapshot ceny) do PRD** | Dziś to założenie planu refaktoru, nie decyzja produktowa — a dotyczy kwoty, którą personel inkasuje w kasie (FR-016) | `prd.md`, FR-016 |

Rekomendacje 1–2 są **blokujące dla projektu schematu** (oba to niezmienniki
międzywierszowe, czyli — zgodnie z idiomem repo — miejsce dla triggera-strażnika,
a nie dla dyscypliny route'ów). Rekomendacje 3–5 są decyzjami właściciela produktu
i nie blokują F0–F2.

## Artefakt

Tablica: `board.json` w repo `event-storming-canvas`, faza `hotspots`,
21 zdarzeń + 14 hotspotów. Odtworzenie: `node server.js`, `http://localhost:4000`.
