# Menu Availability Toggle (S-05) Implementation Plan

## Overview

Kelner (i właściciel) przełącza dostępność pozycji menu (dostępna / niedostępna / wyprzedana)
kompaktowym selectem bezpośrednio w wierszu wspólnej strony `/menu`; kuchnia widzi tę stronę
read-only. To pierwszy w aplikacji zapis dozwolony dla roli innej niż owner, więc zmiana musi
przejść spójnie przez trzy niezależne warstwy egzekwowania ról (RLS, guard API, middleware/UI)
oraz wprowadza pierwszą w repo pętlę pollingu (FR-007 w świadomej degradacji do 3–5 s).
Widoczność dla anonimowego klienta pozostaje w S-08.

## Current State Analysis

- Model 3 stanów kompletny od S-03: enum `public.menu_item_availability` (default `available`)
  — `supabase/migrations/20260708124756_menu_categories_items.sql:15,93-94`; typy i etykiety PL
  `src/types.ts:4-12`; walidacja tylko w pełnym `menuItemInputSchema` (`src/lib/schemas/menu.ts:43`).
- RLS: UPDATE na `menu_items` owner-only (`menu_items_update_owner`, `20260708124756:129-135`);
  kelner/kuchnia mają wyłącznie SELECT w obrębie firmy. Migracja S-03 zapowiada wprost
  (`:114`): "S-05 will add the waiter availability-toggle write path".
- API: availability zmienia dziś wyłącznie pełny PUT `/api/menu/items/[id]`
  (`src/pages/api/menu/items/[id].ts:44-56`, przepisuje 6 kolumn — hazard "stale tab",
  impl-review F5). `guardMenuRequest` (`src/lib/api.ts:29-52`) hard-koduje write→owner 403.
- Middleware: `/menu` w `OWNER_ROUTES` (`src/middleware.ts:13`) — kelner/kuchnia odbici 302 na
  `/dashboard` (`:129-133`). Po zalogowaniu KAŻDY ląduje na `/` (marketing)
  (`src/pages/api/auth/signin.ts:39`).
- UI: badge w `MenuItemRow.tsx:84-86`; edycja przez Select w `MenuItemDialog.tsx:246-263`;
  `MenuManager` nie zna roli. Kafle dashboardu role-aware poza nieguardowanym kaflem ustawień
  (`src/pages/dashboard.astro:48-53`).
- Polling: zero `setInterval` w `src/` — hooki (`src/components/hooks/useMenu.ts:38-82`) to
  fetch-on-mount + refetch-after-mutation z guardem `cancelled`.
- Testy: rejestr `tests/integration/authz/registry-completeness.test.ts:14-31` wymusi wpis
  nowej trasy w `tests/integration/authz/route-matrix.ts`; macierz zakłada dziś uniformly
  "write → kelner/kuchnia 403" — S-05 łamie to założenie pierwszym wierszem "waiter allowed".

## Desired End State

Kelner loguje się kodem lokalu, ląduje na `/dashboard`, wchodzi kaflem w `/menu`, przełącza
pozycję na "Wyprzedane" selectem w wierszu; owner z otwartym `/menu` w drugiej sesji widzi
zmianę w ≤5 s bez odświeżania. Kelner nie widzi i nie może wykonać żadnej innej mutacji menu
(guard 403 + RLS/trigger w DB); kuchnia widzi listę bez żadnych akcji. Suita RLS dowodzi
niezmiennika na poziomie DB, macierz authz — na poziomie tras.

### Key Discoveries:

- Kompletny szablon wąskiego PATCH: endpoint `src/pages/api/room/tables/[id]/activation.ts`
  (komentarz :11-14 uzasadnia PATCH vs PUT), schemat jednopolowy `src/lib/schemas/room.ts:64-69`,
  klient `RoomLayoutManager.tsx:300-316` (PATCH + refetch + busy-flag), UI `TableList.tsx:35-61`.
- Wzorce triggerów-niezmienników już istnieją: `menu_items_set_sort_order`
  (`20260717093000:76-86`), `profiles_guard_self_change` — precedens dla triggera
  "nie-owner zmienia wyłącznie availability".
- `GET /api/menu` był projektowany jako przyszły cel pollingu S-05
  (`src/pages/api/menu/index.ts:6`, `src/lib/api.ts:27-28`).
- Konwencje phase2-ownership-input: 403 z guarda (rola), 404 dla cudzego own-path `[id]`,
  400 = pierwszy zod issue, koperta `{data}/{error}`, dowód braku efektu w DB przy odmowie.
- Rola nie jest claimem JWT — RLS rozwiązuje ją przez `current_staff_role()`
  (`20260727220415:52-76`, filtr `deactivated_at is null`).

## What We're NOT Doing

- Żadnego widoku ani odczytu dla anonimowego klienta (polling klienta, SECURITY DEFINER RPC,
  QR) — to kontrakt S-07/S-08. Kontrakt widoczności (anon widzi `available`+`sold_out`) zostaje
  spec-iem S-08.
- Żadnych innych uprawnień kelnera/kuchni (edycja pozycji, kategorie, zdjęcia, archiwizacja,
  reorder — wszystko zostaje owner-only).
- Bez WebSocketów/realtime — polling zgodnie z tech-stack.md.
- Bez zmian w `PUT /api/menu/items/[id]` (owner dalej może zmienić availability pełnym PUT-em).
- Bez aktualizacji test-plan.md — po wylądowaniu S-05 osobne `/10x-test-plan --refresh` (§7).
- Bez naprawy pozostałych długów dashboardu poza kaflem ustawień i kaflem Menu.

## Implementation Approach

Od dołu do góry, warstwa po warstwie, każda faza weryfikowalna osobno: (1) DB otwiera ścieżkę
zapisu kelnera i betonuje niezmiennik kolumny; (2) API wystawia wąski PATCH wg szablonu
activation i rozszerza macierz authz o pierwszy wiersz "waiter allowed"; (3) UI wpuszcza
kelnera i kuchnię na `/menu`, różnicuje akcje po roli i naprawia redirect logowania;
(4) polling domyka pętlę FR-007 po stronie staff.

## Critical Implementation Details

- **Niezmiennik kolumny w DB, nie w trasie**: polityka UPDATE dla kelnera musi być
  sparowana z triggerem `before update`, który dla `current_staff_role() <> 'owner'`
  odrzuca każdą zmianę poza `availability`. Porównanie odporne na przyszłe kolumny:
  `(to_jsonb(old) - 'availability') is distinct from (to_jsonb(new) - 'availability')`
  → `raise exception`. Sam RLS nie umie ograniczyć zapisu do kolumny.
- **Macierz authz zmienia kształt**: dziś parametrycznie zakłada write→kelner 403. Wiersz
  PATCH availability musi wyrażać "owner 200, waiter 200, kitchen 403, anon 401" — rozszerzyć
  kształt wpisu (np. pole dozwolonych ról), nie klonować całego testu.
- **Polling nie może klobberować edycji**: refetch podmienia `menu` w stanie hooka; pauza
  wymagana gdy otwarty dialog (dialog trzyma lokalny stan, ale reorder optymistyczny by się
  cofał), gdy mutacja w locie oraz gdy `document.hidden`. Guard `cancelled` z hooka zostaje.
- **E2E auth.setup jest odporny na zmianę redirectu** (asercja stanu "Sign out", nie URL —
  `tests/e2e/auth.setup.ts:85-89`), ale test `route-protection.spec.ts` może zakładać
  odbicie kelnera z `/menu` — sprawdzić i zaktualizować oczekiwania przy fazie 3.

## Phase 1: DB — ścieżka zapisu kelnera + niezmiennik kolumny

### Overview

Migracja otwierająca kelnerowi UPDATE na `menu_items` i betonująca w triggerze, że nie-owner
zmienia wyłącznie `availability`. Dowody w suicie SQL RLS.

### Changes Required:

#### 1. Migracja: polityka + trigger

**File**: `supabase/migrations/<timestamp>_menu_availability_waiter_write.sql`

**Intent**: Dodać politykę UPDATE dla kelnera (kuchnia świadomie pominięta — brak polityki =
odmowa) oraz trigger egzekwujący niezmiennik kolumny dla nie-ownerów. Zaktualizować komentarz
z `20260708124756:112-114` (obietnica S-05 spełniona).

**Contract**: Polityka `menu_items_update_availability_waiter` for update to authenticated,
using/with check: `company_id = public.current_company_id() and public.current_staff_role() = 'waiter'`
(OR-uje się z istniejącą owner-ową). Trigger `menu_items_guard_waiter_columns`
(before update, funkcja SECURITY DEFINER-free, `set search_path = ''`): dla
`public.current_staff_role() <> 'owner'` porównanie
`(to_jsonb(old) - 'availability') is distinct from (to_jsonb(new) - 'availability')`
→ `raise exception 'Personel może zmieniać wyłącznie dostępność pozycji'`.

#### 2. Asercje RLS

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: Dowieść na poziomie DB: kelner firmy A zmienia availability własnej pozycji (OK);
kelner nie zmieni `price` (trigger raise); kuchnia nie zmieni availability (RLS 0 rows);
kelner firmy A nie zmieni pozycji firmy B (RLS 0 rows). Wzorzec claimów jak w istniejących
asercjach (`set local request.jwt.claims`).

**Contract**: Nowe asercje w konwencji istniejącej suity; bez `SKIP`.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npm run db:push` (lokalnie po `npx supabase start`)
- Suita RLS przechodzi z nowymi asercjami: `npm run test:rls:local`
- Regresja: istniejące asercje menu_items bez zmian statusu

#### Manual Verification:

- (brak — warstwa DB w całości dowodzona automatycznie)

---

## Phase 2: API — PATCH /api/menu/items/[id]/availability

### Overview

Wąski PATCH wg szablonu activation + rozszerzenie guarda o wariant "availability write"
(owner+kelner) + komplet testów integracyjnych z pierwszym wierszem "waiter allowed" w macierzy.

### Changes Required:

#### 1. Schemat jednopolowy

**File**: `src/lib/schemas/menu.ts` (+ `src/lib/schemas/menu.test.ts`)

**Intent**: Wąski schemat availability zbudowany `.pick()` z `menuItemInputSchema`, żeby enum
nie dryfował (wzorzec `roomObjectTransformSchema`). Testy jednostkowe: odrzucenie złej
wartości i braku pola.

**Contract**: `export const menuItemAvailabilitySchema = menuItemInputSchema.pick({ availability: true });`
+ typ `MenuItemAvailabilityInput`.

#### 2. Guard: wariant dostępności

**File**: `src/lib/api.ts`

**Intent**: `guardMenuRequest` dostaje trzeci tryb obok read/write — zapis availability
dozwolony dla ownera i kelnera, 403 dla kuchni (komunikat PL w konwencji istniejących),
401 anon, 403 bez firmy — bez zmiany zachowania dotychczasowych wywołań.

**Contract**: rozszerzenie `options` (np. `write: true | "availability"` albo osobna flaga —
decyzja implementera, byle istniejące wywołania się nie zmieniły); komentarz przy guardzie
aktualizuje zdanie "writes are owner-only".

#### 3. Endpoint

**File**: `src/pages/api/menu/items/[id]/availability.ts`

**Intent**: PATCH wg szablonu `activation.ts`: guard (availability-write) → `z.uuid()` na id
(400 PL) → `parseBody(context, menuItemAvailabilitySchema)` → update jednego pola z
`.eq("id", …).is("archived_at", null).select("*")` → 500/404/`jsonData(data[0])`.
`export const prerender = false`.

**Contract**: Trasa `PATCH /api/menu/items/[id]/availability`; body `{ availability }`;
odpowiedzi w kopercie `{data}/{error}`; cudzy/archiwalny id → 404 (konwencja own-path).

#### 4. Testy integracyjne

**File**: `tests/integration/authz/route-matrix.ts`, `tests/integration/validation/input-parity.test.ts`, `tests/integration/isolation/cross-tenant-write.test.ts`

**Intent**: (a) wpis trasy do macierzy z NOWYM kształtem oczekiwań per rola: anon 401,
kitchen 403, waiter 200, owner 200 — rozszerzyć kształt wiersza minimalnie (rejestr
completeness sam wykryje brak wpisu); (b) parity: zła wartość availability → 400;
(c) cross-tenant: firma A PATCH-uje pozycję firmy B → 404 + dowód service-role, że
availability w B nietknięte.

**Contract**: Konwencje §6.4 test-planu; realne własne id w ścieżce testu parity, żeby 400
pochodziło z body.

### Success Criteria:

#### Automated Verification:

- Lint + typecheck: `npm run lint`, `npm run typecheck`
- Testy jednostkowe schematu: `npm run test`
- Testy integracyjne (macierz + parity + cross-tenant): `npm run test:integration`
- Rejestr completeness zielony (wpis trasy obecny)

#### Manual Verification:

- Kelner (curl/sesja): PATCH availability własnej pozycji → 200 i zmiana w DB; PATCH
  `price` przez PostgREST-owy PUT niedostępny (guard 403), a bezpośredni update jako kelner
  odrzucony triggerem (pokryte suitą RLS — spot-check wystarczy)

**Implementation Note**: Po fazie 2 pauza na potwierdzenie manualne przed fazą 3.

---

## Phase 3: UI — role-aware /menu, kafle, redirect

### Overview

Kelner i kuchnia wchodzą na `/menu`; akcje różnicowane po roli (owner: pełny CRUD + toggle;
kelner: tylko toggle; kuchnia: bez akcji). Redirect po zalogowaniu na `/dashboard` dla
wszystkich. Kafle dashboardu uporządkowane.

### Changes Required:

#### 1. Middleware

**File**: `src/middleware.ts`

**Intent**: `/menu` wychodzi z `OWNER_ROUTES` (zostaje w `PROTECTED_ROUTES`); komentarz
wyjaśnia, że różnicowanie po roli robi strona/API (S-05).

**Contract**: `OWNER_ROUTES = ["/staff", "/room", "/settings"]`.

#### 2. Strona i island z rolą

**File**: `src/pages/menu.astro`, `src/components/menu/MenuManager.tsx`, `src/components/menu/MenuItemRow.tsx`, `src/components/menu/CategorySection.tsx` (wg potrzeb)

**Intent**: `menu.astro` przekazuje `role` z `Astro.locals` do `MenuManager`. Owner widzi
wszystko jak dziś + select-toggle; kelner: nagłówek, lista, select-toggle — bez przycisków
dodawania/edycji/archiwizacji/reorderu/zdjęć; kuchnia: lista z badge (jak dziś), zero akcji.
Select-toggle w wierszu: shadcn Select nad `AVAILABILITY`/`AVAILABILITY_LABELS`, busy-flag
per pozycja na czas PATCH (wzorzec `TableList.tsx:35-61` + `toggleActive`), po sukcesie
`refetch()`; błąd → istniejący kanał `actionError`.

**Contract**: Toggle woła `PATCH /api/menu/items/${id}/availability`; dla kuchni toggle w
ogóle się nie renderuje (nie disabled — nieobecny); aria-label PL zależny od stanu.

#### 3. Dashboard i redirect

**File**: `src/pages/dashboard.astro`, `src/pages/api/auth/signin.ts`

**Intent**: Kafel "Menu" widoczny dla wszystkich ról (opis dla staff: podgląd/dostępność);
kafel "Ustawienia lokalu" objęty `isOwner` (naprawa martwego kafla). Redirect po zalogowaniu:
`/` → `/dashboard` dla wszystkich.

**Contract**: `signin.ts:39` → `context.redirect("/dashboard")`; e2e `route-protection.spec.ts`
sprawdzić/zaktualizować oczekiwania wobec `/menu` dla nie-ownera (już nie 302).

### Success Criteria:

#### Automated Verification:

- Lint + typecheck + build SSR: `npm run lint`, `npm run typecheck`, `npm run build`
- Testy e2e przechodzą (w tym zaktualizowany route-protection): `npm run test:e2e`

#### Manual Verification:

- Kelner: login → ląduje na /dashboard → kafel Menu → /menu → przełącza pozycję selectem;
  nie widzi żadnych owner-akcji (dodaj/edytuj/archiwizuj/zdjęcia/reorder)
- Kuchnia: /menu renderuje listę bez żadnych akcji; PATCH z konsoli jako kuchnia → 403
- Owner: pełny CRUD bez regresji + działający select-toggle w wierszu
- Kafel ustawień niewidoczny dla kelnera/kuchni

**Implementation Note**: Po fazie 3 pauza na potwierdzenie manualne przed fazą 4.

---

## Phase 4: Polling — pierwsza pętla odświeżania

### Overview

`useMenu` odświeża listę co ~4 s, z pauzami chroniącymi edycję; FR-007 domknięte po stronie
staff (dwie sesje widzą nawzajem swoje przełączenia ≤5 s).

### Changes Required:

#### 1. Hook z interwałem

**File**: `src/components/hooks/useMenu.ts`, `src/components/menu/MenuManager.tsx`

**Intent**: Interwał `setInterval(refetch, 4000)` w hooku z trzema pauzami: `document.hidden`
(nasłuch `visibilitychange`), otwarty dialog (pozycji/kategorii), mutacja w locie. MenuManager
komunikuje stan pauzy do hooka (parametr/settery — kształt wybiera implementer). Guard
`cancelled` i czyszczenie interwału przy unmount. Cichy błąd pojedynczego ticku nie może
nadpisać `loadError` widocznego użytkownikowi (odróżnić initial load od tła — decyzja
implementera, byle UI nie migotał błędem przy chwilowej utracie sieci).

**Contract**: Interwał 4000 ms (mieści się w dokumentowych 3–5 s); brak pollingu na innych
stronach (tylko /menu).

### Success Criteria:

#### Automated Verification:

- Lint + typecheck: `npm run lint`, `npm run typecheck`
- `npm run test` (jeśli hook zyska testowalne czyste funkcje — wg uznania implementera)

#### Manual Verification:

- Dwie sesje (kelner + owner): przełączenie u kelnera widoczne u ownera ≤5 s bez odświeżania
- Otwarty dialog edycji ownera nie jest przerywany/resetowany przez tick pollingu
- Ukryta karta nie generuje żądań (network tab); powrót na kartę wznawia
- Chwilowe zabicie dev-servera nie wyświetla trwałego błędu po powrocie (tick cichy)

---

## Testing Strategy

### Unit Tests:

- `menuItemAvailabilitySchema`: zła wartość → błąd PL; brak pola → błąd; poprawne 3 stany.

### Integration Tests:

- Macierz authz: pierwszy wiersz "waiter allowed" (anon 401 / kitchen 403 / waiter 200 / owner 200).
- Cross-tenant PATCH → 404 + service-role dowód braku efektu.
- Input parity: reprezentatywny zły input → 400.
- Suita SQL RLS: 4 nowe asercje (kelner-availability OK, kelner-price trigger raise,
  kuchnia deny, cross-tenant deny).

### Manual Testing Steps:

1. Pełny przepływ kelnera: login kodem lokalu → /dashboard → /menu → toggle → weryfikacja w DB.
2. Dwu-sesyjny test pollingu (kelner zmienia, owner obserwuje).
3. Negatywy: kuchnia bez akcji + 403 na PATCH; kelner bez owner-akcji w UI.

## Performance Considerations

Polling co 4 s na /menu = 1 lekki GET (payload menu już zoptymalizowany pojedynczym zapytaniem);
pauza przy ukrytej karcie eliminuje koszt tła. Bez wpływu na inne strony.

## Migration Notes

Migracja czysto addytywna (nowa polityka + trigger) — bez zmian danych, bez downtime'u.
Rollback = drop polityki i triggera.

## References

- Research: `context/changes/menu-availability-toggle/research.md` (w tym sekcja Decisions)
- Szablon PATCH: `src/pages/api/room/tables/[id]/activation.ts`
- Szablon UI toggle: `src/components/room/TableList.tsx:35-61`
- Obietnica S-05 w migracji: `supabase/migrations/20260708124756_menu_categories_items.sql:112-114`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: DB — ścieżka zapisu kelnera + niezmiennik kolumny

#### Automated

- [x] 1.1 Migracja aplikuje się czysto (`npm run db:push`)
- [x] 1.2 Suita RLS przechodzi z nowymi asercjami (`npm run test:rls:local`)
- [x] 1.3 Istniejące asercje menu_items bez regresji

### Phase 2: API — PATCH availability

#### Automated

- [ ] 2.1 Lint + typecheck przechodzą
- [ ] 2.2 Testy jednostkowe schematu przechodzą (`npm run test`)
- [ ] 2.3 Testy integracyjne przechodzą: macierz (waiter allowed), parity, cross-tenant (`npm run test:integration`)
- [ ] 2.4 Rejestr completeness zielony (wpis trasy)

#### Manual

- [ ] 2.5 Spot-check: kelner PATCH availability → 200; inne mutacje kelnera odrzucane

### Phase 3: UI — role-aware /menu, kafle, redirect

#### Automated

- [ ] 3.1 Lint + typecheck + build SSR przechodzą
- [ ] 3.2 Testy e2e przechodzą (w tym zaktualizowany route-protection)

#### Manual

- [ ] 3.3 Kelner: login → /dashboard → /menu → toggle działa; zero owner-akcji w UI
- [ ] 3.4 Kuchnia: /menu read-only; PATCH jako kuchnia → 403
- [ ] 3.5 Owner: pełny CRUD bez regresji + select-toggle działa
- [ ] 3.6 Kafel ustawień niewidoczny dla staff; kafel Menu widoczny dla wszystkich

### Phase 4: Polling

#### Automated

- [ ] 4.1 Lint + typecheck przechodzą

#### Manual

- [ ] 4.2 Dwie sesje: zmiana kelnera widoczna u ownera ≤5 s bez odświeżania
- [ ] 4.3 Otwarty dialog nie jest resetowany przez tick
- [ ] 4.4 Ukryta karta nie polluje; powrót wznawia
- [ ] 4.5 Cichy błąd ticku nie miga błędem w UI
