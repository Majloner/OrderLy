---
project: "OrderLY"
version: 1
status: draft
created: 2026-05-22
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 7
  hard_deadline: null
  after_hours_only: true
---

# OrderLY — Product Requirements Document

> *Keep your orders orderly.*

## Vision & Problem Statement

Małe i średnie lokale gastronomiczne zarządzają menu, cennikiem i dostępnością
produktów w sposób rozproszony — kartki, pliki, telefon do dostawcy — a obsługa
zamówień przy stoliku angażuje kelnera na każdym etapie. Skutkiem jest rozjazd
informacji między nośnikami, błędy w cenach i dostępności oraz kelner jako wąskie
gardło każdego zamówienia. Ból ma trzy wymiary: tarcie w codziennym przepływie
pracy, koszt koordynacji wokół personelu i dane uwięzione w rozproszonych nośnikach.

Rynek małych i średnich lokali gastronomicznych jest niedoobsługiwany. Dostępne
systemy zarządzania sprzedażą i menu cyfrowym celują w sieci i większych graczy —
są za drogie i za ciężkie konfiguracyjnie dla pojedynczego lokalu. OrderLY stawia
na jedno, tanie, spójne narzędzie all-in-one: aktywne menu ze zdjęciami, stały kod
QR przy stoliku oraz składanie i obsługa zamówień zarówno przez klienta, jak i
personel.

## User & Persona

**Persona pierwszoplanowa — Właściciel lokalu.** Prowadzi małą lub średnią
restaurację / kawiarnię / bar. Sięga po OrderLY, gdy chce uporządkować menu i
dostępność w jednym miejscu oraz odciążyć personel w obsłudze zamówień. To on
zakłada konto firmy, konfiguruje profil lokalu, buduje menu ze zdjęciami,
projektuje schemat sali i generuje kody QR dla stolików. Sukces wdrożenia zależy
od tego, czy właściciel samodzielnie i szybko doprowadzi lokal do działania.

### Secondary persona

Personel sali (kelner) i kuchnia obsługują zamówienia w codziennej pracy; klient
przy stoliku składa zamówienia anonimowo po zeskanowaniu kodu QR. MVP służy przede
wszystkim właścicielowi, ale ścieżka klienta z QR jest kluczowym momentem wartości
produktu.

## Success Criteria

### Primary

- Klient po zeskanowaniu stałego kodu QR składa zamówienie ze stolika bez udziału
  personelu, a personel i kuchnia prowadzą je przez statusy aż do zrealizowania —
  pełna pętla zamówienia działa end-to-end.
- Właściciel samodzielnie konfiguruje pełne menu (min. 20 pozycji ze zdjęciami)
  w mniej niż 30 minut.

### Secondary

- Co najmniej 80% pozycji w aktywnym menu ma przypisane zdjęcie.
- Co najmniej 70% aktywnych stolików ma wygenerowany i przypisany stały kod QR.
- Personel obsługuje zamówienie w panelu szybciej niż w dotychczasowym procesie
  papierowym.

### Guardrails

- Izolacja danych między firmami — użytkownik jednej firmy nigdy nie widzi danych
  innej.
- Stały kod QR nie zmienia się przy edycji menu ani cennika — wydrukowane kody
  pozostają ważne.
- Anonimowa sesja klienta jest ściśle przypisana do jednego stolika i nie wycieka
  między stolikami; zamówienia różnych stolików się nie mieszają.

## User Stories

### US-01: Klient składa zamówienie ze stolika przez kod QR

- **Given** klient przy stoliku z naklejonym stałym kodem QR
- **When** skanuje kod, przegląda aktywne menu lokalu i dodaje pozycje do zamówienia
- **Then** składa zamówienie anonimowo, bez rejestracji, a zamówienie trafia do
  panelu personelu i na kitchen display

#### Acceptance Criteria

- Zeskanowanie kodu otwiera menu właściwego lokalu i wiąże sesję z konkretnym stolikiem
- Pozycje oznaczone jako niedostępna / wyprzedana nie są możliwe do zamówienia
- Pusta sesja (brak pozycji) nie pozwala złożyć zamówienia — pokazuje stan pusty
- Po złożeniu zamówienia klient widzi jego status i podsumowanie kwoty
- Klient może dokładać kolejne pozycje do otwartego zamówienia, dopóki personel
  nie zamknie go po rozliczeniu w kasie
- Klient nie widzi zamówień innych stolików ani danych innych firm

### US-02: Właściciel konfiguruje aktywne menu lokalu

- **Given** zalogowany właściciel ze świeżo założonym kontem firmy
- **When** tworzy pozycje menu z opisem, ceną i kategorią oraz dodaje im zdjęcia
- **Then** powstaje aktywne menu gotowe do udostępnienia klientom przez kody QR

#### Acceptance Criteria

- Właściciel konfiguruje pełne menu (min. 20 pozycji ze zdjęciami) w mniej niż 30 minut
- Dodane zdjęcie generuje miniaturę używaną na liście pozycji
- Pozycja może mieć przypisane tagi alergenów
- Zmiana menu lub cennika nie unieważnia istniejących kodów QR stolików

### US-03: Kuchnia prowadzi pozycje przez kitchen display

- **Given** zalogowany użytkownik roli „kuchnia" z aktywnymi zamówieniami
- **When** otwiera dedykowany widok kuchni
- **Then** widzi listę pozycji do przygotowania posortowaną wg statusu i oznacza je
  jako gotowe

#### Acceptance Criteria

- Kitchen display pokazuje wyłącznie pozycje wymagające przygotowania
- Oznaczenie pozycji jako gotowej aktualizuje status widoczny dla personelu
- Rola „kuchnia" nie ma dostępu do edycji menu ani konfiguracji firmy

## Functional Requirements

### Konto i firma

- FR-001: Właściciel can zarejestrować konto firmy (lokalu) i zalogować się. Priority: must-have
  > Socrates: Kontrargument rozważony: „wystarczy jedno wstępnie seedowane konto firmy zamiast flow rejestracji". Rozstrzygnięcie: zostaje — self-service rejestracja firmy to fundament onboardingu wielu lokali i multi-tenancy.
- FR-002: Właściciel can edytować profil lokalu — nazwa, adres, godziny otwarcia. Priority: must-have
  > Socrates: Kontrargument rozważony: „profil nie wpływa na pętlę zamawiania — zbędny w MVP". Rozstrzygnięcie: zostaje — nazwa lokalu zasila identyfikator stolika i nagłówek menu.
- FR-003: Właściciel can tworzyć konta personelu i przypisywać im role (kelner, kuchnia). Priority: must-have
  > Socrates: Kontrargument rozważony: „wystarczą 3 predefiniowane konta-role na firmę". Rozstrzygnięcie: zostaje — realny lokal ma kilku kelnerów; provisioning jest potrzebny dla sensownego modelu zespołu.

### Menu

- FR-004: Właściciel can tworzyć i edytować pozycje aktywnego menu — nazwa, opis, cena, kategoria. Priority: must-have
  > Socrates: Kontrargument rozważony: „kategorie to nadmiar — płaska lista wystarczy". Rozstrzygnięcie: zostaje — menu min. 20 pozycji bez kategorii jest nieczytelne dla klienta.
- FR-005: Właściciel can dodawać zdjęcia potraw do pozycji menu z automatycznym generowaniem miniatur. Priority: must-have
  > Socrates: Kontrargument rozważony: „miniatury to koszt — serwować oryginał". Rozstrzygnięcie: zostaje — menu 20+ pozycji ze zdjęciami bez miniatur ładuje się wolno na telefonie klienta.
- FR-006: Właściciel can oznaczać alergeny przy pozycji menu jako tagi. Priority: must-have
  > Socrates: Kontrargument rozważony: „alergeny bez pełnych składników mogą wprowadzać w błąd — ryzyko prawne/zdrowotne". Rozstrzygnięcie: zostaje jako minimum MVP, ale ryzyko uznane — patrz Open Questions (kompletność informacji o alergenach).
- FR-007: Kelner can przełączać dostępność pozycji menu (dostępna / niedostępna / wyprzedana) w czasie rzeczywistym. Priority: must-have
  > Socrates: Kontrargument rozważony: „real-time jest nadmiarowy — stan przy wejściu wystarczy". Rozstrzygnięcie: zostaje — klient przeglądający menu musi zobaczyć zmianę na „wyprzedane", inaczej zamówi niedostępne.

### Sala i kody QR

- FR-008: Właściciel can projektować schemat sali w wizualnym edytorze i dodawać do niego stoliki. Priority: must-have
  > Socrates: Kontrargument rozważony: „wizualny edytor to duży UI — lista stolików wystarczy". Rozstrzygnięcie: zostaje — wizualny plan sali ułatwia mapowanie kodów QR na fizyczne stoliki; świadomie utrzymany w pełnej formie.
- FR-009: Właściciel can aktywować i dezaktywować stoliki — np. sezonowe. Priority: must-have
  > Socrates: Kontrargument rozważony: „sezonowe stoliki to edge case — dodanie/usunięcie wystarczy". Rozstrzygnięcie: zostaje — usunięcie stolika niszczy jego stały kod QR; dezaktywacja pozwala go wyłączyć bez utraty kodu.
- FR-010: Właściciel can identyfikować stolik numerem (pierwotny identyfikator w obrębie firmy), z nazwą lokalu jako kontekstem wyświetlania i opcjonalnym opisem. Priority: must-have
  > Socrates: Kontrargument rozważony: „nazwa lokalu w identyfikatorze stolika jest redundantna". Rozstrzygnięcie: zrewidowano — numer jest pierwotnym identyfikatorem stolika w obrębie firmy; nazwa lokalu pozostaje jako kontekst wyświetlania, nie część klucza.
- FR-011: Właściciel can wygenerować stały kod QR przypisany na trwałe do stolika. Priority: must-have
  > Socrates: Kontrargument rozważony: „jeden QR na lokal + wybór stolika zamiast kodu per stolik". Rozstrzygnięcie: zostaje — stały kod per stolik daje zerowy nakład klienta i automatyczne wiązanie sesji ze stolikiem; to rdzeń propozycji wartości.

### Zamówienia

- FR-012: Klient can po zeskanowaniu kodu QR przeglądać menu stolika i złożyć zamówienie anonimowo, bez rejestracji. Priority: must-have
  > Socrates: Kontrargument rozważony: „anonimowość utrudnia spory i ułatwia złośliwe zamówienia". Rozstrzygnięcie: zostaje — wymóg rejestracji zabiłby konwersję klienta przy stoliku; spory obsługuje personel w lokalu.
- FR-013: Kelner can tworzyć i edytować zamówienia w panelu personelu. Priority: must-have
  > Socrates: Kontrargument rozważony: „skoro klient zamawia sam przez QR, tworzenie przez kelnera duplikuje ścieżkę". Rozstrzygnięcie: zostaje — część gości nie zeskanuje QR; kelner musi móc przyjąć i poprawić zamówienie.
- FR-014: Personel can zmieniać status poszczególnych pozycji zamówienia: nowe → w toku → zrealizowane; pozycje można grupować. Priority: must-have
  > Socrates: Kontrargument rozważony: „cztery statusy (przyjęte → w przygotowaniu → w realizacji → zrealizowane) to zbyt duża granularność". Rozstrzygnięcie: zrewidowano — MVP używa 3 statusów (nowe → w toku → zrealizowane), stosowanych per pozycja, z możliwością grupowania pozycji.
- FR-015: Klient can dokładać kolejne pozycje do otwartego zamówienia (rachunku stolika), dopóki personel nie zamknie zamówienia po rozliczeniu w kasie; po zamknięciu edycja jest niemożliwa. Priority: must-have
  > Socrates: Kontrargument rozważony: „klient powinien móc dozamawiać — nie wszystko leci za jednym razem". Rozstrzygnięcie: zrewidowano — zamówienie działa jak otwarty rachunek stolika; klient dokłada pozycje aż do jawnego zamknięcia zamówienia przez personel po opłaceniu w kasie. Statusy kuchenne (FR-014) dotyczą pojedynczych pozycji i nie blokują dokładania kolejnych.
- FR-016: Personel can zobaczyć rozliczenie i podsumowanie zamówienia — kwota i pozycje. Priority: must-have
  > Socrates: Kontrargument rozważony: „skoro płatność jest poza systemem, podsumowanie kwoty jest zbędne". Rozstrzygnięcie: zostaje — personel potrzebuje kwoty i pozycji, by rozliczyć gościa w kasie.
- FR-019: Personel can jawnie zamknąć zamówienie po rozliczeniu płatności w kasie; zamknięcie odcina możliwość edycji przez klienta i kończy sesję stolika. Priority: must-have
  > Socrates: FR wyłoniony podczas rewizji FR-015 (model otwartego rachunku), poza pierwotną rundą. Kontrargument rozważony: „zamknięcie mogłoby być dorozumiane po zrealizowaniu wszystkich pozycji". Rozstrzygnięcie: zostaje jako jawna akcja personelu — wiąże się z rozliczeniem w kasie i kończy sesję stolika.

### Widok kuchni

- FR-017: Kuchnia can zobaczyć dedykowany kitchen display — listę pozycji do przygotowania sortowaną wg statusu. Priority: must-have
  > Socrates: Kontrargument rozważony: „w małym lokalu panel kelnera wystarcza zamiast osobnego widoku kuchni". Rozstrzygnięcie: zostaje — kuchnia ma inne potrzeby (lista do przygotowania, sortowanie wg statusu, brak rozpraszaczy).
- FR-018: Kuchnia can oznaczać poszczególne pozycje zamówienia jako gotowe. Priority: must-have
  > Socrates: Kontrargument rozważony: „lepiej oznaczać całe zamówienie niż pojedyncze pozycje". Rozstrzygnięcie: zostaje — dania są gotowe w różnym czasie; oznaczanie per pozycja odwzorowuje realną pracę kuchni.

## Non-Functional Requirements

- Cała ścieżka klienta — od zeskanowania kodu QR po złożenie i podgląd zamówienia
  — działa w przeglądarce mobilnej, bez instalowania natywnej aplikacji.
- Żadne żądanie nie ujawnia danych firmy innej niż ta, do której należy zalogowany
  użytkownik personelu lub anonimowa sesja stolika.

## Business Logic

OrderLY prowadzi zamówienie stolika przez cały cykl życia — od dodawania pozycji,
przez przygotowanie, po rozliczenie — egzekwując na każdym etapie, kto może je
zmieniać i które pozycje wolno w ogóle zamówić.

Reguła konsumuje trzy rodzaje wejść: pozycje wybierane do zamówienia (przez klienta
lub przez personel), oznaczenia dostępności pozycji menu (dostępna / niedostępna /
wyprzedana) oraz statusy poszczególnych pozycji zamówienia (nowe → w toku →
zrealizowane). Czwartym wejściem jest akt rozliczenia: zamknięcie zamówienia po
opłaceniu w kasie.

Wyjściem reguły jest, w każdym momencie: zbiór pozycji, które wolno dołożyć do
zamówienia (tylko dostępne), stan otwarte / zamknięte całego rachunku stolika,
status każdej pozycji oraz zestaw akcji dozwolonych dla danego aktora — klient może
dokładać pozycje wyłącznie do otwartego zamówienia, personel prowadzi statusy i
zamyka rachunek.

Użytkownik spotyka regułę w naturalnym przebiegu: klient widzi w menu wyłącznie
pozycje dostępne i dokłada je do otwartego rachunku stolika; personel i kuchnia
przesuwają pozycje przez statusy przygotowania; po rozliczeniu w kasie personel
jawnie zamyka zamówienie, co odcina edycję klienta i kończy sesję stolika.

## Access Control

Aplikacja jest wielofirmowa (multi-tenant): dane każdego lokalu są izolowane, a
użytkownik widzi wyłącznie zasoby swojej firmy.

**Role personelu (konta z logowaniem):**

- **Właściciel** — zakłada konto firmy, zarządza profilem lokalu, menu, schematem
  sali i kodami QR oraz tworzy konta personelu i nadaje role. Jest nadzbiorem
  uprawnień: może wykonać wszystko, co kelner i kuchnia.
- **Kelner** — pełna obsługa zamówień (tworzenie, edycja, zmiana statusów) oraz
  przełączanie dostępności pozycji menu (dostępna / niedostępna / wyprzedana) w
  czasie rzeczywistym. Nie zmienia konfiguracji firmy, menu, sali ani kont.
- **Kuchnia** — wyłącznie dedykowany widok kuchni (kitchen display): lista pozycji
  do przygotowania i oznaczanie ich jako gotowe. Nie edytuje menu ani zamówień.

**Provisioning:** konta kelnera i kuchni tworzy/zaprasza właściciel i przypisuje im
role. Brak samodzielnej rejestracji personelu.

**Klient** — bez rejestracji i bez konta. Po zeskanowaniu stałego kodu QR otrzymuje
anonimową sesję przypisaną do konkretnego stolika; składa zamówienia w obrębie tej
sesji. Nieuwierzytelniony dostęp jest możliwy wyłącznie do ścieżki zamawiania
z poziomu stolika — panele personelu pozostają za logowaniem.

## Non-Goals

**Funkcjonalne non-goals — czego MVP nie buduje:**

- **Płatności online i bramki/terminale płatnicze** — płatność realizowana w kasie,
  poza systemem; integracje płatnicze przeniesione do fazy 2.
- **Fiskalizacja i integracja z urządzeniami sprzedaży** — brak integracji z
  urządzeniami fiskalnymi; poza zakresem MVP.
- **Zarządzanie magazynem** — brak stanów magazynowych i automatycznego odejmowania
  składników ze stanu.
- **Moduł rezerwacji stolików** — MVP obsługuje składanie i obsługę zamówień, nie
  rezerwację miejsc.
- **Sieć wielu lokalizacji w ramach jednego konta** — konto odpowiada jednemu
  lokalowi; obsługa sieci lokalizacji poza zakresem.
- **Wielojęzyczne menu z tłumaczeniem AI oraz pełne definiowanie składników** —
  przeniesione do fazy 2; MVP jest jednojęzyczny i oznacza wyłącznie tagi alergenów.

**Niefunkcjonalne non-goals — wymiary jakości, których MVP nie obejmuje:**

- **Natywne aplikacje mobilne** — wyłącznie responsywny web; brak aplikacji
  natywnych iOS/Android.
- **Zaawansowana analityka i raporty sprzedaży** — brak dashboardów i raportowania
  sprzedażowego w MVP.

## Open Questions

1. **Kompletność informacji o alergenach (FR-006)** — MVP oznacza alergeny jako
   tagi per pozycja, bez pełnej listy składników. Runda Sokratejska wskazała ryzyko
   wprowadzenia w błąd (prawne/zdrowotne). Do rozstrzygnięcia: czy tagi alergenów
   bez składników są wystarczające w kontekście wymogów informacyjnych gastronomii,
   czy potrzebny jest disclaimer albo przyspieszenie pełnych składników z fazy 2.
   Owner: użytkownik.
2. **Dokładna data twardego terminu (hard deadline)** — istnieje twardy termin
   dostarczenia MVP, ale konkretna data nie została jeszcze podana. Do uzupełnienia
   w `timeline_budget.hard_deadline`. Owner: użytkownik.
