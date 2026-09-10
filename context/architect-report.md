# Raport architektoniczny — moduł 4 (ścieżka 10xArchitect)

> Two-pager oparty wyłącznie na artefaktach modułu 4. Stan: 2026-09-06.
> Artefakty pochodzą z DWÓCH projektów: L2/L3/L4 z repo **itols (iTOOLS)**,
> L5 z repo **10x (OrderLY)**.

## 1. Opisane projekty

| Repo | Stack | Skala (wg artefaktów) | Artefakty |
| --- | --- | --- | --- |
| **itols / iTOOLS** (`C:\Projekty\itols`, `intebuco-polska/itools`) | C++Builder (VCL) + DevExpress VCL + UniDAC (SQL Server) + FastReport; desktopowy MDI z wstążką, gospodarka narzędziowa (przyjęcia PZ, wydania RW/RWZ, przeniesienia MM/PM, likwidacje LK, inwentaryzacje, wydruki kodów) | v3.185; 167 plików źródłowych; 65 tabel + 191 procedur w zrzucie schematu; ~170 szablonów wydruków `.fr3`; bus factor = 1; zero testów automatycznych, zero CI | **L2** `context/map/repo-map.md` (+3 artefakty robocze: territory, structure, contributors) · **L3** `context/changes/doc-item-flow-analysis/research.md` · **L4** `context/changes/refactor-opportunities/{research,plan}.md` |
| **10x / OrderLY** (`C:\Projekty\Repozytoria\10x`) | Astro 6 SSR + React 19 + TypeScript + Tailwind 4 + Supabase (Postgres/RLS/Auth/Storage) na Cloudflare Workers; multi-tenant SaaS dla gastronomii | MVP w budowie: 17 migracji SQL, ~24 route'y API | **L5** `context/domain/01…04` (destylacja domeny, agregat, ACL, event storming) |

## 2. Mapa projektu (L2 — `context/map/repo-map.md`)

1. **Rdzeń to service locator.** `magazyn` / `TForm_narzedziownia` (fan-in 71):
   jedyne połączenie DB (`UniConnection`), współdzielone słowniki, utile
   (`FilterDBGrid`, `CheckOpenWindow`) i stan globalny (`User`, `spid`, `Firma` →
   branding REMAK/EZW); prawie każda forma sprzęga się z nim dwustronnie — w kodzie
   i w DFM.
2. **Lokalne centrum dokumentów po scaleniu (2026-09):** `popup_popup_rw` z polem
   `tryb_dok` (0=RW, 1=RWZ, 2=LK, 3=PM) jest kanonicznym miejscem semantyki czterech
   dokumentów magazynowych; `popup_popup_pz` (przyjęcia, najbardziej rozbudowany)
   celowo pozostał osobno.
3. **Entry point i weryfikacja:** produkt = `iTOOLS.cbproj` (`iTools.cpp`);
   `Narzedziownia.cbproj` to wtórny podzbiór, który „nie buduje się headless".
   Testów automatycznych brak — weryfikacja to build + ręczne przeklikanie
   przepływów dokumentów.
4. **Miny operacyjne:** kodowania (CP1250 w `.cpp/.h`, UTF-8 z BOM lub CP1250
   w `.dfm` — edycje wyłącznie skryptem świadomym kodowania; sesja IDE zdejmuje BOM),
   formy MDI zarządzane po `Name`, duplikaty symboli linkera jako „zastany szum",
   **bus factor = 1** (mapa + pamięć projektu to mitygacja).
5. **Najważniejsze unknowns:** decyzja o scaleniu `popup_popup_pz`, integracja
   Simple.ERP (warunkowe gałęzie w liczeniu stanów) oraz `docs/schema-obecny.sql` —
   zrzut z 2026-07, może dryfować od produkcji, a jest w UTF-16LE, więc zwykły grep
   daje fałszywe zera.

## 3. Analiza ficzera (L3 — `doc-item-flow-analysis/research.md`)

**Badany przepływ:** zapis pozycji dokumentu magazynowego przez `popup_popup_rw`
z gałęziami `tryb_dok` — wybrany, bo mapa wskazuje rodzinę dokumentów jako główny
front prac, a to okno jako kanoniczne (i świeżo scalone: commit `1c5c03e`,
−13 930 linii) miejsce semantyki czterech dokumentów; przepływ przecina też strefę
ryzyka #1 (service locator — `GetSQL` 233 żywe wywołania w 15 plikach, `NewSQL`
181 w 36).

**Feature overview.** Input pochodzi z gridu katalogu narzędzi
(`exec sp_pobierz_narzedzia`) w modalnym oknie otwieranym przez cztery formy
dokumentów, z których każda po `new` nadpisuje `tryb_dok` i **wstrzykuje własny
DataSource pozycji**. Stan zmienia się bezpośrednio w bazie przy `Post()`: tryby
LK/PM piszą wprost do tabel pozycji, RW/RWZ do bufora `cmms_mag_wydanie_temp`,
który dopiero wywołujący przekłada na dokument (`sp_wydaj_rw_uzytk`). Do
wywołującego wraca tylko sterowanie (`delete` formy, `change_state`); nie ma warstw,
a na całej ścieżce gromadzenia pozycji nie ma ani jednej transakcji.

**Technical debt (top 3 z 46 pozycji D1–D46):**

1. **Ciche łykanie wyjątków zapisu — wzorzec, nie incydent** (D1): ast-grep
   potwierdził **8 no-opowych `catch` z samym `exception.Message;`** (w trzech
   `MessageDlg` świadomie zakomentowany) plus 14 pustych `catch` w repo. Nieudany
   `Post()` = brak pozycji i brak komunikatu dla użytkownika.
2. **Stan globalny zdublowany między formatkami** (D6): `bool edycja` zdefiniowane
   w **dokładnie 19 jednostkach kompilacji** (ast-grep, wzorzec `bool edycja = $V;`);
   linker zwija je do jednego symbolu, więc edycja w oknie Narzędzia blokuje
   zamknięcie popupu LK, a zamknięcie popupu PZ wyłącza walidację ilości w RW.
   Pokrewne, też ast-grep: literówka `==` zamiast `=` wyłączająca blokadę nawigatora
   występuje **dokładnie 2 razy** — została sklonowana przy scaleniu popupów.
3. **Blast radius przez szwy stringowe i boczne wejścia:** ~2495 węzłów
   `FieldValues[...]` (kontrakty pól niewidoczne dla kompilatora; o zapisie decyduje
   `SQLInsert` w DFM — stąd ciche gubienie `XKEY_MAGAZYNU` na PM, D4), dwa surowe
   `INSERT INTO cmms_mag_pm_pozycje` omijające wszystkie walidacje
   (`wyszukiwanie.cpp:357`, `PrzeniesienieZawartosci.cpp:182`) oraz **zero
   transakcji w 167 plikach kodu aplikacji** (potwierdzone niezależnie ast-grepem
   i grepem; ruch magazynowy jest transakcyjny dopiero w procedurach — 32 z
   `BEGIN TRAN`).

## 4. Plan refaktoryzacji (L4 — `refactor-opportunities/plan.md`)

**Co refaktoryzujemy:** wykonanie rankingu kandydatów guard-first na kodzie bez
testów i bez CI: K2 (przeciekający stan globalny: `static` → pola klasy), K8
(wycięcie ~210 linii martwego bloku edycji kartoteki wraz z pozornymi
zabezpieczeniami), K9 (8 połkniętych wyjątków → dziennik zdarzeń + jeden zbiorczy
komunikat). Kształt docelowy: `build.bat` buduje produkt, projekt wtórny
`Narzedziownia.*` usunięty, `tdump -oiPUBDEF` bez `_edycja`, stan formatek
w prywatnych polach klas, liczniki ast-grep spadają 2→1 i 8→0.

**Czego świadomie NIE robimy:** K1 (szew do `Form_narzedziownia`), K3 (`tryb_dok`),
K11 (warstwa dostępu do danych), K12 (transakcje w fazie gromadzenia pozycji);
naprawy edytorów niezapisywanych pól D32/D33 (decyzja produktowa: „usunąć, nie
naprawić"); brandingu REMAK i `cxGroupBox1` (11 z 14 kontrolek bloku REMAK to jego
dzieci, a REMAK jest nieweryfikowalny bez instancji); 14 pustych `catch` (inna
kategoria — kontrola przepływu); odświeżenia zrzutu schematu.

**Fazy (każda odwracalna osobno, jeden commit na plik/krok):**

1. **Osłona i baseline** — build produktu zamiast wtórnego, usunięcie
   `Narzedziownia.*`, mirror UTF-8 + reguły ast-grep, scenariusze S1–S7 ze zrzutem
   SQL „przed" · auto (build, grep, liczniki baseline 2 i 8) + ręcznie (S1–S7).
2. **K2-`static` w 19 jednostkach** · auto (`tdump` PUBDEF bez `_edycja`) + ręcznie
   (S6 musi się **odwrócić** — jedyny obserwowalny efekt; build jest tu ślepy).
3. **K8 — cięcie martwego bloku** (`:234–444`, osierocona straż `FormClose`, no-opy
   w `FormShow`, ukrycie przycisków nawigatora bez handlerów) · auto (ast-grep 2→1,
   plik krótszy o ≥210 linii) + ręcznie (otwarcie popupu w 4 trybach — rozjazd
   DFM↔kod to błąd runtime, nie kompilacji).
4. **K2 — pola klasy w obu popupach** + inicjalizacja `czy_pm` · auto (`tdump`,
   ast-grep 19→17) + ręcznie (S1–S7, poprawny klucz nagłówka LK/PM).
5. **K9 — 8 wyjątków do dziennika** (`GlobalLogThread->DodajLog`) + jeden komunikat
   po pętli · auto (ast-grep 8→0, zero potwierdzone grepem) + ręcznie (S8: wymuszony
   błąd zapisu → wpis w „Log"; 20 nieudanych → jedno okno i 20 wpisów).

## 5. Domena wg DDD (L5 — OrderLY, `context/domain/01…04`)

Blok DDD powstał na innym repo niż L2–L4 (w itols nie ma `context/domain/`).

**Ubiquitous language (5 z 23 pojęć):** otwarty rachunek stolika (zamówienie, do
którego klient dokłada aż do jawnego zamknięcia) · stały kod QR stolika (wedge
produktu) · dostępność pozycji (trójstan — brama zamawialności) · anonimowa sesja
stolika · kod lokalu (niezmienny identyfikator istniejący TYLKO w kodzie, nieobecny
w PRD).

**Najważniejsze rozjazdy model-vs-kod** (8 w destylacji): R-01 — cała pętla
zamówienia (rdzeń, Kryterium sukcesu #1) istnieje wyłącznie w dokumentach, zero
kodu; R-02 — PRD każe kelnerowi przełączać dostępność, kod na 3 warstwach dopuszcza
tylko właściciela; R-04 — klient anonimowy ma czytać menu, a wszystkie polityki anon
świadomie usunięto; R-06 — niezmienność loginu personelu deklarowana, nieegzekwowana
w DB. Event storming (doc 04) niezależnie odtworzył 6 z 8 rozjazdów i dołożył 4
hotspoty „czasowe"; najostrzejszy przeżył wszystkie dokumenty: brak terminacji
porzuconego rachunku + „jeden otwarty rachunek per stolik" = trwale zablokowany
stolik dziedziczony przez następnego gościa.

**Niezmiennik #1 i agregat:** „pozycja trafia do zamówienia wyłącznie, gdy rachunek
jej stolika jest OTWARTY i pozycja DOSTĘPNA; statusy tylko `nowe → w toku →
zrealizowane`; zamknięcie to jawna akcja personelu, nieodwracalnie odcinająca edycję
klienta" — należy do agregatu **`TableOrder` (rachunek stolika)**, zaprojektowanego
w doc 02 jako moduł domenowy + atomowe RPC + triggery-zapory.

**Anti-Corruption Layer (doc 03):** przecieka **kontrakt Supabase Storage dla zdjęć
menu** — jedyna zależność z żywą deklaracją wymienialności w 3 dokumentach. Przecieka
przez **4 warstwy plus kontrakt wire i bundle przeglądarki, w 10 plikach** (schemat
URL vendora i multipart signed-upload w kodzie klienckim, `supabaseUrl` prop-drillowany
przez 4 komponenty React, surowe `photo_path` w DTO). Projekt: `src/lib/photo-storage/`
— VO `MenuPhoto` + wąski port + 2 adaptery; wymiana dostawcy dotyka tylko adapterów.

## 6. Decyzje, które należą do mnie

AI dostarczyło mapę, 46-pozycyjny inwentarz długu i ranking kandydatów, ale
rozstrzygnięcia kierunkowe były moje. Po pierwsze, decyzja produktowa o martwym
bloku edycji kartoteki: „usunąć, nie naprawić" — mimo że research pokazał dokładnie,
co należałoby naprawiać (D32/D33: edytory pól, których `SQLInsert` nie zapisuje).
Po drugie, odroczenie scalenia `popup_popup_pz`, choć wydaje się naturalnym
domknięciem zeszłego scalenia — research dostarczył argument, że przeszkodą jest
inny kontrakt metody `DodajNarzedzia`, nie rozmiar formatki, więc scalenie bez
uprzątnięcia D3/D4/D6/D8 dodałoby piątą gałąź na obcych parametrach. Po trzecie,
zerwanie z dotychczasową konwencją dużych paczek commitów na rzecz „jeden commit na
plik/krok", bez którego `git revert` nie działa na poziomie pojedynczej formatki —
a transakcje i szew do service locatora świadomie zostają poza planem: na kodzie bez
osłony najpierw buduje się siatkę bezpieczeństwa, potem sięga po zmiany o dużym
promieniu rażenia. W OrderLY analogiczna decyzja o zakresie: NIE owijam
PostgREST/RLS — liczbowo największego „przecieku" — bo RLS jest architekturą
egzekwowania izolacji najemców; ACL dostał magazyn zdjęć, gdzie dokumenty realnie
deklarują wymienialność, a pytania produktowe (terminacja rachunku, snapshot ceny)
zostają jawnie po mojej stronie i blokują projekt schematu.
