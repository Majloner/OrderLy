---
title: "OrderLY — destylacja domeny biznesowej"
created: 2026-09-05
type: domain-distillation
---

# OrderLY — destylacja domeny (dokumenty → model → kod)

> Mapa domeny, nie kod. Każde twierdzenie o kodzie jest poparte realnie
> zweryfikowaną ścieżką `plik:linia`. Stan repo: branch `main`, 2026-09-05.

## KROK 0 — Kontekst projektu

**Dokumenty źródłowe (wszystkie istnieją i zostały przeczytane):**

| Dokument | Rola | Uwagi |
| --- | --- | --- |
| `context/foundation/prd.md` | PRD v1 (2026-05-22) — kanoniczne wymagania | 18 FR, 3 US, guardraile, Access Control, Non-Goals |
| `OrderLY-MVP.md` | Pierwotna wizja MVP | Starsza niż PRD; częściowo **zrewidowana** przez PRD (patrz KROK 4, R-05) |
| `context/foundation/roadmap.md` | Roadmapa slice'ów F-01…S-11 | Statusy częściowo nieaktualne względem kodu (KROK 4, R-07) |
| `context/foundation/shape-notes.md`, `tech-stack.md`, `infrastructure.md` | Materiał pomocniczy | Nie cytowane niżej, spójne z PRD |
| `context/foundation/lessons.md` | Rejestr lekcji (anon RLS, Storage/service_role) | Traktowany jako narracja zmian |
| `AGENTS.md` | Reguły twarde repo | „Tenant isolation is non-negotiable" |

**Ograniczenie:** katalogi `context/archive/` i `context/changes/` (historia per-slice)
przejrzano tylko przez odwołania z roadmapy i komentarzy migracji, nie w całości.

**Stack i struktura:** Astro 6 SSR + React 19 + TypeScript strict + Supabase
(Postgres/RLS/Auth/Storage) na Cloudflare Workers (`AGENTS.md`). Logika biznesowa żyje w
trzech warstwach:

- **Persystencja + reguły twarde:** `supabase/migrations/*.sql` — RLS, triggery,
  indeksy unikalności. To tutaj egzekwowane są najważniejsze niezmienniki.
- **API + walidacja:** `src/pages/api/**` (route'y Astro) + `src/lib/api.ts`
  (guardy) + `src/lib/schemas/*.ts` (zod).
- **Typy domenowe / UI:** `src/types.ts` (lustro schematu DB), `src/components/**`,
  `src/middleware.ts` (rozwiązanie tenanta i roli do `context.locals`).

## KROK 1 — Ubiquitous Language

Legenda: **DOK** = cytat/miejsce w dokumencie źródłowym, **KOD** = gdzie termin żyje w kodzie.

| Pojęcie | Definicja | DOK | KOD |
| --- | --- | --- | --- |
| **Firma / Lokal (tenant)** | Konto lokalu; granica izolacji danych. „Aplikacja jest wielofirmowa (multi-tenant): dane każdego lokalu są izolowane" | `prd.md:212-213` | `public.companies` — `supabase/migrations/20260705212949_tenancy_core.sql:20-26`; resolver `current_company_id()` tamże `:44-54` |
| **Kod lokalu (venue code)** | 6-znakowy, publiczny, **niezmienny** identyfikator firmy; nośnik przyszłego QR i członu adresu logowania personelu | **BRAK w PRD** — pojęcie istnieje tylko w kodzie: „S-07 will encode companies.code in printed QR codes" | `20260728150833_venue_code_and_staff_login.sql:17-19,28-39`; trigger niezmienności `20260803134535_venue_code_immutable.sql:22-38` |
| **Właściciel** | Zakłada firmę, zarządza profilem, menu, salą, QR i kontami; nadzbiór uprawnień | `prd.md:217-219` | enum `staff_role` `tenancy_core.sql:15`; `STAFF_ROLES` `src/types.ts:88`; gating `src/middleware.ts:13,129-133` |
| **Kelner** | Obsługa zamówień + przełączanie dostępności pozycji | `prd.md:220-222` (FR-007 `prd.md:144`) | rola istnieje (`types.ts:88`), ale **ścieżka uprawnień kelnera nie istnieje** — patrz KROK 4, R-02 |
| **Kuchnia** | Wyłącznie kitchen display; oznaczanie pozycji jako gotowe | `prd.md:223-224` (FR-017/018 `prd.md:175-178`) | rola istnieje (`types.ts:88`); **widok kuchni BRAK w kodzie** |
| **Login personelu** | Poświadczenie unikalne w obrębie lokalu, niezmienne; adres auth **wyprowadzany** z (kod lokalu, login) | **BRAK w PRD** (PRD mówi tylko „tworzy/zaprasza konta", `prd.md:226-227`) | `profiles.login` `20260728150833:67-74`; `staffAuthEmail()` `src/lib/staff-identity.ts:58-60`; `StaffMember.login` `src/types.ts:108-110` |
| **Dezaktywacja konta personelu** | Miękkie wyłączenie: konto traci wszystko naraz (resolvery zwracają NULL) | implikowana przez FR-003 / model ról | `profiles.deactivated_at` `20260727220415_staff_accounts_roles.sql:27,52-76`; wylogowanie w `src/middleware.ts:98-121` |
| **Menu / Pozycja menu** | Aktywne menu: nazwa, opis, cena, kategoria (FR-004) | `prd.md:138-139` | `public.menu_items` `20260705215147_minimal_tables_menu.sql:26-33` + `20260708124756_menu_categories_items.sql:76-81`; `MenuItem` `src/types.ts:59-76` |
| **Kategoria menu** | Grupowanie pozycji; domyślne 4 kategorie przy rejestracji | `prd.md:138-139` | `public.menu_categories` `20260708124756:26-36`; seed w `handle_new_user()` tamże `:163-168` |
| **Dostępność pozycji** | Trójstanowa: dostępna / niedostępna / wyprzedana; brama „co wolno zamówić" | FR-007 `prd.md:144-145`; Business Logic `prd.md:193-196` | enum `menu_item_availability` `20260708124756:15`; `AVAILABILITY` `src/types.ts:4-12`; zod `src/lib/schemas/menu.ts:43` |
| **Alergeny (tagi)** | 14 alergenów UE jako tagi per pozycja, bez pełnych składników | FR-006 `prd.md:142-143`; Open Question #1 `prd.md:260-265` | enum `allergen` `20260708124756:18-21`; `ALLERGENS` `src/types.ts:15-30` |
| **Zdjęcie + miniatura** | Zdjęcie potrawy z automatyczną miniaturą na listę | FR-005 `prd.md:140-141` | `menu_items.photo_path` `src/types.ts:71-75`; `photoUploadRequestSchema` `src/lib/schemas/menu.ts:59-71`; endpoints `src/pages/api/menu/items/[id]/photo.ts`, `photo-url.ts` |
| **Archiwizacja pozycji** | Soft-delete pozycji menu (`archived_at`) | brak wprost w PRD (konsekwencja edycji menu) | `20260708124756:81,86-88`; `MenuItem.archived_at` `src/types.ts:69` |
| **Sala (strefa)** | Strefa lokalu (sala główna, taras…); kontener stolików | FR-008 `prd.md:149-150` | `public.rooms` `20260727120000_room_layout_tables.sql:35-44`; `Room` `src/types.ts:137-143` |
| **Stolik** | Identyfikowany **numerem** (pierwotny identyfikator w obrębie firmy), z nazwą lokalu jako kontekstem i opcjonalnym opisem | FR-010 `prd.md:153-154` | `public.tables` `20260705215147:15-22`; unikalność `tables_company_number_idx` `20260727120000:160`; `RoomTable` `src/types.ts:147-163` |
| **Aktywacja / dezaktywacja stolika** | Jedyna kontrola cyklu życia; stolik **nigdy nie jest usuwany** (trwałość QR) | FR-009 `prd.md:151-152` | `tables.is_active` `20260705215147:20`; celowy **brak** delete policy `20260727120000:14-18,189-190` |
| **Obiekt sali (wyposażenie)** | Ściana/krzesło/bar… — element planu, który **można** usunąć (kontrast ze stolikiem) | **BRAK w PRD** (implikowany przez „wizualny edytor", FR-008) | `RoomObject` + komentarz projektowy `src/types.ts:165-221`; migracja `20260804120000_room_objects.sql` |
| **Stały kod QR stolika** | Trwale przypisany do stolika; nie zmienia się przy edycji menu/cennika | FR-011 `prd.md:155-156`; guardrail `prd.md:75-76` | **BRAK w kodzie** (żadnego generowania QR); istnieje tylko prekursor `companies.code` (patrz wyżej) |
| **Anonimowa sesja stolika** | Klient bez konta; sesja ściśle przypisana do jednego stolika, nie wycieka między stolikami | `prd.md:229-232`; guardrail `prd.md:77-78` | **BRAK w kodzie** |
| **Zamówienie = otwarty rachunek stolika** | Klient dokłada pozycje do otwartego zamówienia, dopóki personel go nie zamknie | FR-015 `prd.md:166-167`; Business Logic `prd.md:189-208` | **BRAK w kodzie** (zero tabel/endpointów/typów zamówień; potwierdzone grep `orders|zamówien` po `src/` i `supabase/`) |
| **Statusy pozycji zamówienia** | `nowe → w toku → zrealizowane`, per pozycja, z grupowaniem | FR-014 `prd.md:164-165` | **BRAK w kodzie** |
| **Zamknięcie zamówienia (rozliczenie)** | Jawna akcja personelu po opłaceniu w kasie; odcina edycję klienta i kończy sesję stolika | FR-019 `prd.md:170-171`; FR-016 `prd.md:168-169` | **BRAK w kodzie** |
| **Kitchen display** | Dedykowany widok kuchni: lista pozycji do przygotowania sortowana wg statusu | FR-017 `prd.md:175-176`; US-03 `prd.md:112-123` | **BRAK w kodzie** |

## KROK 2 — Klasyfikacja subdomen (Core / Supporting / Generic)

Kryterium rdzenia: roadmapa nazywa wprost *wedge* produktu — „**stały kod QR per stolik
wiążący anonimową sesję klienta z konkretnym stolikiem**: zerowy nakład gościa,
automatyczne wiązanie zamówienia ze stolikiem" (`roadmap.md:23-25`); Kryterium sukcesu #1
to „pełna pętla zamówienia end-to-end" (`prd.md:58-60`).

| Obszar / pojęcie | Kategoria | Uzasadnienie (odwołanie do celów) |
| --- | --- | --- |
| Pętla zamówienia: otwarty rachunek stolika, statusy pozycji, zamknięcie/rozliczenie | **Core** | Kryterium sukcesu #1 (`prd.md:58-60`); cała sekcja Business Logic PRD (`prd.md:187-208`) opisuje wyłącznie tę regułę |
| Stały QR per stolik + anonimowa sesja przypisana do stolika | **Core** | Nazwany *wedge* (`roadmap.md:23-25`); FR-011 z rozstrzygnięciem „to rdzeń propozycji wartości" (`prd.md:155-156`); guardraile trwałości QR i izolacji sesji (`prd.md:75-78`) |
| Dostępność pozycji w czasie (bliskim) rzeczywistym | **Core** | Wejście reguły biznesowej: wyznacza „zbiór pozycji, które wolno dołożyć" (`prd.md:193-200`); bez niej klient zamawia niedostępne (FR-007, `prd.md:144-145`) |
| Menu (pozycje, kategorie, zdjęcia, alergeny) | **Supporting** | Konieczne (Kryterium sukcesu #2: 20 pozycji w <30 min, `prd.md:61-62`), ale bez wedge'a to „zwykłe cyfrowe menu" (`roadmap.md:23-24`) — nie stanowi przewagi |
| Schemat sali (strefy, stoliki, obiekty, wizualny edytor) | **Supporting** | Służy mapowaniu QR na fizyczne stoliki (rozstrzygnięcie FR-008, `prd.md:149-150`); wartość pośrednia |
| Kitchen display (widok) | **Supporting** | Dedykowany *widok* na rdzeniowe statusy pozycji (FR-017, `prd.md:175-176`); sama pętla statusów jest core, ekran — supporting |
| Konta personelu, role, provisioning, dezaktywacja | **Supporting** | Warunek Access Control (`prd.md:215-227`), ale standardowy problem; roadmapa wprost odkłada S-02 jako „niepilny dla gwiazdy" (`roadmap.md:116`) |
| Profil firmy (nazwa, adres, godziny) | **Supporting** | „nazwa lokalu zasila identyfikator stolika i nagłówek menu" (FR-002, `prd.md:131-132`) |
| Multi-tenancy / RLS / izolacja `company_id` | **Generic** (mechanizm) o randze guardraila | Technika (Supabase RLS, `AGENTS.md` Hard rules), nie przewaga rynkowa — ale niefunkcjonalny guardrail #1 (`prd.md:73-74,184-185`) |
| Uwierzytelnianie (Supabase Auth/GoTrue) | **Generic** | Kupione z półki; własny jest tylko pomysł adresu wyprowadzanego (kod lokalu + login) |
| Storage zdjęć + miniatury (Supabase Storage) | **Generic** | Infrastruktura; lekcja „operacje przez service_role" (`lessons.md:34-53`) |
| Polling dostępności/statusów (zamiast WebSockets) | **Generic** | Świadoma symplifikacja MVP (`AGENTS.md` Hard rules; `roadmap.md:154`) |

## KROK 3 — Kandydaci na agregaty i niezmienniki

Status egzekwowania: **egzekwuje** (schemat/trigger/RLS), **deklaruje** (walidacja
aplikacyjna / komentarz / dokument), **ignoruje** (nic nie chroni / byt nie istnieje).

### A1. Zamówienie (otwarty rachunek stolika) — root: Order, encje: OrderItem

| Niezmiennik | Źródło | Status |
| --- | --- | --- |
| Do zamówienia wolno dołożyć **wyłącznie pozycje dostępne** | „zbiór pozycji, które wolno dołożyć do zamówienia (tylko dostępne)" `prd.md:199-200`; AC US-01 `prd.md:92` | **ignoruje** — byt nie istnieje w kodzie |
| Klient dokłada pozycje **tylko do otwartego** zamówienia; po zamknięciu edycja niemożliwa | FR-015 `prd.md:166-167`; `prd.md:201-203` | **ignoruje** |
| **Zamknięcie** jest jawną akcją personelu, odcina edycję klienta i **kończy sesję stolika** | FR-019 `prd.md:170-171` | **ignoruje** |
| Status pozycji przechodzi tylko `nowe → w toku → zrealizowane` (per pozycja) | FR-014 `prd.md:164-165` | **ignoruje** |
| Sesja klienta jest przypisana do **jednego** stolika; zamówienia różnych stolików się nie mieszają | guardrail `prd.md:77-78` | **ignoruje** |

### A2. Firma (tenant) — root: Company

| Niezmiennik | Źródło | Status |
| --- | --- | --- |
| Żadne żądanie nie ujawnia danych innej firmy | `prd.md:184-185`; guardrail `prd.md:73-74` | **egzekwuje** — RLS default-deny + polityki `company_id = current_company_id()` na każdej tabeli (`20260705212949:71-99`, `20260708124756:38-141`, `20260727120000:46-190`); suita `supabase/tests/rls_isolation.sql` |
| Kod lokalu jest **niezmienny** po nadaniu (przyszła treść QR) | komentarz-konstytucja `20260728150833:17-19` (w PRD pośrednio przez FR-011) | **egzekwuje** — trigger `companies_guard_code_immutable` `20260803134535:22-38` |
| Firmę + właściciela tworzy wyłącznie zaufany przepływ rejestracji | Access Control `prd.md:226-227` | **egzekwuje** — brak INSERT policy na `companies`/`profiles` dla ról klienckich (`20260705212949:5-10`); tworzy `handle_new_user()` SECURITY DEFINER |

### A3. Stolik — root: RoomTable (w obrębie sali)

| Niezmiennik | Źródło | Status |
| --- | --- | --- |
| Numer stolika unikalny w obrębie firmy (pierwotny identyfikator) | FR-010 `prd.md:153-154` | **egzekwuje** — `tables_company_number_idx` `20260727120000:160` |
| Stolik **nigdy nie jest usuwany** — tylko dezaktywacja (trwałość wydrukowanego QR) | FR-009 `prd.md:151-152`; guardrail `prd.md:75-76` | **egzekwuje strukturalnie** — celowy brak jakiejkolwiek DELETE policy (`20260727120000:14-18,189-190`); dodatkowo `rooms.room_id` ON DELETE RESTRICT (`:81-88`) |
| Stolik zawsze należy do istniejącej sali tej samej firmy | implikowane przez FR-008 | **egzekwuje** — `room_id NOT NULL` (`20260727120000:125`) + composite FK `20260728120000_room_tables_composite_fk.sql` |

### A4. Pozycja menu — root: MenuItem

| Niezmiennik | Źródło | Status |
| --- | --- | --- |
| Dostępność zawsze w {dostępna, niedostępna, wyprzedana} | FR-007 `prd.md:144` | **egzekwuje** — enum DB `20260708124756:15` + zod `src/lib/schemas/menu.ts:43` |
| Cena dodatnia, maks. 2 miejsca po przecinku | US-02/FR-004 (pośrednio) | **egzekwuje** — `numeric(10,2)` `20260705215147:30` + zod `src/lib/schemas/menu.ts:34-38` |
| Nazwa unikalna per firma wśród niezarchiwizowanych | brak wprost w PRD | **egzekwuje** — `menu_items_company_name_idx` `20260708124756:86-88` |
| Klient (anon) widzi tylko pozycje niezarchiwizowane w stanie dostępna/wyprzedana; „wyprzedana" **musi być widoczna** | AC US-01 `prd.md:92`; FR-007 `prd.md:145` | **deklaruje** — reguła była w polityce `menu_items_anon_read_visible` (`20260708124756:103-109`), którą świadomie **usunięto** (`20260813010000:60`); dziś anon nie widzi nic, reguła czeka na re-implementację jako projekcja SECURITY DEFINER (`20260813010000:48-52`) |
| Edycja menu jest owner-only | Access Control `prd.md:217-222` | **egzekwuje** — RLS `menu_items_*_owner` `20260708124756:123-141` + `guardMenuRequest` `src/lib/api.ts:38-40` |

### A5. Profil personelu — root: StaffProfile

| Niezmiennik | Źródło | Status |
| --- | --- | --- |
| Rola `owner` nie jest nadawalna; należy tylko do konta, które zarejestrowało firmę | `prd.md:217-219,226-227` | **egzekwuje** — `profiles_insert_owner … role <> 'owner'` `20260727220415:81-86` + trigger `guard_profile_self_change` `:112-140`; `STAFF_ASSIGNABLE_ROLES` `src/types.ts:92-97` |
| Właściciel nie może zdegradować ani dezaktywować **samego siebie** (firma bez właściciela = nieodwracalna) | konsekwencja Access Control | **egzekwuje** — trigger `20260727220415:112-140` |
| Konto dezaktywowane traci dostęp wszędzie naraz | FR-003/S-02 | **egzekwuje** — resolvery zwracają NULL (`20260727220415:52-76`), default-deny obejmuje też przyszłe tabele; middleware kończy sesję `src/middleware.ts:98-121` |
| Login unikalny per firma (case-insensitive) | — (pojęcie spoza PRD) | **egzekwuje** — `profiles_company_login_idx` `20260728150833:72-74` |
| Login **niezmienny** po utworzeniu (adres auth jest z niego wyprowadzany — zmiana trwale odcina konto) | `src/lib/staff-identity.ts:14-17`; `20260803134535:12-16` | **deklaruje, nie egzekwuje w DB** — chroni tylko schemat API (`login` celowo nieobecny w `staffUpdateInputSchema`, `src/lib/schemas/staff.ts:65-67`); `profiles_update_owner` (`20260705212949:95-99`) pozwala na UPDATE dowolnej kolumny i **brak** triggera analogicznego do `companies_guard_code_immutable` |

## KROK 4 — Rozjazdy MODEL vs KOD

| # | Dokument mówi | Kod robi | Dowód |
| --- | --- | --- | --- |
| R-01 | Pełna pętla zamówienia: klient składa i dokłada, personel prowadzi statusy, zamyka rachunek (FR-012…FR-019; cała sekcja Business Logic `prd.md:187-208`; Kryterium sukcesu #1 `prd.md:58-60`) | **Rdzeń domeny w ogóle nie istnieje w kodzie** — zero tabel, endpointów i typów zamówień | grep `orders\|order_item\|zamówien` po `src/` i `supabase/` → 0 trafień domenowych; roadmapa: S-08…S-11 `proposed` (`roadmap.md:49-52`) |
| R-02 | **Kelner** przełącza dostępność pozycji w czasie rzeczywistym (FR-007 `prd.md:144`; Access Control `prd.md:220-222`) | Zapis dostępności jest **owner-only** na trzech warstwach: RLS, guard API, gating trasy — kelner nie ma dziś żadnej ścieżki | RLS `menu_items_update_owner` `20260708124756:129-135`; `guardMenuRequest` write→owner `src/lib/api.ts:38-40`; `/menu` w `OWNER_ROUTES` `src/middleware.ts:13,129-133`; S-05 `proposed` (`roadmap.md:145-155`) |
| R-03 | Właściciel generuje **stały kod QR** przypisany do stolika (FR-011 `prd.md:155-156`) | Generowania QR brak; istnieje wyłącznie prekursor — niezmienny `companies.code` przygotowany „pod QR" | `20260728150833:17-19` („S-07 will encode companies.code in printed QR codes"); brak trafień `qr` w `src/` poza komentarzami |
| R-04 | Klient anonimowy **przegląda menu** po zeskanowaniu QR (FR-012 `prd.md:160`; AC US-01 `prd.md:91-92`) | Anon nie przeczyta z bazy **niczego**: wszystkie 4 polityki anon usunięto (świadomie — powierzchnia nie miała konsumenta i wyciekała dane wszystkich najemców) | `20260813010000_drop_unscoped_anon_read_policies.sql:54-60` + uzasadnienie `:1-52`; lekcja `lessons.md:5-32`. Przyszły kształt zapisany w migracji: funkcja SECURITY DEFINER z projekcją kolumn (`:48-52`) |
| R-05 | `OrderLY-MVP.md` mówi: 4 statusy zamówienia (`OrderLY-MVP.md:30`), reguła edycji od „w realizacji" (`:31`), składniki i tłumaczenie AI (`:23-24`) | PRD **zrewidował** model: 3 statusy per pozycja (`prd.md:164-165`), otwarty rachunek zamiast blokady edycji (`prd.md:166-167`), składniki i tłumaczenia w Non-Goals (`prd.md:248-249`). Kod (słusznie) nie zawiera nic z wersji MVP-doc | rozjazd **dokument↔dokument**; PRD jest nowszy i kanoniczny — `OrderLY-MVP.md` czytać wyłącznie historycznie |
| R-06 | Login personelu jest niezmienny po utworzeniu — zmiana trwale odcina konto (deklaracje: `src/lib/staff-identity.ts:14-17`, `src/types.ts:108-109`, `20260803134535:12-16`) | DB tego **nie egzekwuje**: `profiles_update_owner` to FOR UPDATE bez ograniczenia kolumn, a trigger `guard_profile_self_change` chroni tylko `role`/`deactivated_at`. Jedyna bariera to pominięcie pola w zod (`staff.ts:65-67`) — dyscyplina aplikacyjna, dokładnie ta sama luka, którą dla `companies.code` już raz załatano triggerem | `20260705212949:95-99`; `20260727220415:112-140`; kontrast: `20260803134535:22-38` |
| R-07 | Roadmapa: S-02 (personel), S-04 (zdjęcia), S-06 (sala) mają status `proposed` (`roadmap.md:43-48`) | Kod je w znacznym stopniu **realizuje**: staff API + migracja ról (`src/pages/api/staff/*`, `20260727220415`), zdjęcia (`src/pages/api/menu/items/[id]/photo.ts`, `20260721120000`), sala i obiekty (`src/pages/api/room/*`, `20260727120000`, `20260804120000`) | rozjazd meta (dokument procesu ↔ kod); mylące dla każdego, kto planuje po samej roadmapie |
| R-08 | — (PRD nie zna tych pojęć) | Kod niesie wiedzę domenową **nieobecną w dokumentach**: kod lokalu i wyprowadzany adres personelu (`staff-identity.ts:1-27`), obiekty sali z regułą „obiekt WOLNO usunąć, stolika nie" (`src/types.ts:165-171`), archiwizacja pozycji (`20260708124756:81-88`) | odwrotny kierunek rozjazdu: model żyje w komentarzach migracji, nie w PRD — wiedza nie przetrwa przepisania dokumentów |

## KROK 5 — Ranking refaktoru

Kryteria: wartość = jak rdzeniowy jest niezmiennik (KROK 2), ryzyko = jak słabo jest
dziś egzekwowany (KROK 3/4).

| # | Kandydat | Wartość | Ryzyko | Werdykt |
| --- | --- | --- | --- | --- |
| 1 | **Zamówienie (otwarty rachunek stolika)** | maksymalna — Kryterium sukcesu #1, cała sekcja Business Logic PRD | maksymalne — 5/5 niezmienników w statusie „ignoruje" (byt nie istnieje) | **#1** |
| 2 | **Anonimowa ścieżka klienta (sesja stolika + odczyt menu)** | rdzeń (wedge) | wysokie — poprzednia implementacja wycofana jako dziura (R-04); nowy kształt jest tylko zapisany w komentarzu migracji | zaprojektować razem z #1 |
| 3 | **Dostępność pozycji — ścieżka kelnera (FR-007)** | rdzeń (brama zamawialności) | średnie — model istnieje i jest spójny, brakuje całej ścieżki uprawnień kelnera (R-02) | S-05 wg roadmapy |
| 4 | **Niezmienność `profiles.login` w DB** | supporting, ale skutek złamania nieodwracalny (trwałe odcięcie kont personelu) | średnie — deklarowane, egzekwowane tylko w API (R-06); koszt naprawy minimalny (trigger-bliźniak `companies_guard_code_immutable`) | quick win |
| 5 | **Stolik / trwałość QR, Firma / izolacja, Personel / role** | rdzeniowe guardraile | niskie — egzekwowane strukturalnie (brak delete policy, RLS, triggery) | utrzymać wzorce, nie ruszać |

**#1 do refaktoru: Zamówienie.** To jedyny obszar, w którym najcenniejszy niezmiennik
produktu („klient dokłada tylko do otwartego rachunku; zamknięcie odcina edycję i kończy
sesję stolika") ma status *ignoruje* — nie dlatego, że kod go łamie, lecz dlatego, że
kodu nie ma. Ściśle: to nie refaktor, to implementacja (slice S-08/S-09) — ale ranking
wartość×ryzyko i tak wskazuje tutaj. Rekomendacja destylacyjna: budować od razu jako
**jawny agregat** z korzeniem `Order` pilnującym stanu otwarte/zamknięte i bramy
dostępności przy dodawaniu pozycji (wzorem strukturalnego egzekwowania z `tables`:
niezmiennik w schemacie/triggerze, nie w dyscyplinie route'ów). Wśród **istniejącego**
kodu najlepszym stosunkiem koszt/ryzyko jest #4 — trigger niezmienności loginu,
lustrzany do już istniejącego `companies_guard_code_immutable`.
