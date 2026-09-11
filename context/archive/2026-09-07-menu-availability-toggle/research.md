---
date: 2026-09-10T07:15:37+02:00
researcher: Claude (Fable 5) + Miłosz Świątek
git_commit: 3a65e802984bc5e3785cfab03307348ec7fc7de1
branch: main
repository: OrderLy
topic: "S-05 menu-availability-toggle: kelner przełącza dostępność pozycji menu; widoczność zmiany przez polling (FR-007)"
tags: [research, codebase, menu, availability, rls, roles, polling, s-05]
status: complete
last_updated: 2026-09-10
last_updated_by: Claude (Fable 5)
---

# Research: S-05 — kelner przełącza dostępność pozycji menu (FR-007)

**Date**: 2026-09-10T07:15+02:00
**Git Commit**: 3a65e80 · **Branch**: main · **Repository**: OrderLy

## Research Question

Co istnieje dziś, a czego brakuje, żeby kelner mógł przełączać dostępność pozycji menu
(dostępna/niedostępna/wyprzedana), a zmiana była widoczna przez polling (roadmap S-05, PRD FR-007)?
Trzy osie: (1) ścieżka danych availability, (2) role/middleware/RLS i powierzchnia kelnera,
(3) polling, wymagania PRD/test-planu i decyzje historyczne.

## Summary

1. **Model 3 stanów istnieje i jest kompletny** — enum `menu_item_availability` w DB (default
   `available`), `AVAILABILITY`/labels w `src/types.ts:4-12`, walidacja tylko w pełnym
   `menuItemInputSchema` (`src/lib/schemas/menu.ts:43`). Brak schematu availability-only.
2. **Kelner nie ma dziś ŻADNEJ ścieżki zapisu w całej aplikacji.** RLS: UPDATE na `menu_items`
   owner-only (`menu_items_update_owner`); guard `guardMenuRequest({write:true})` hard-koduje
   403 dla nie-ownera; `/menu` jest w `OWNER_ROUTES`, więc kelner nie wejdzie nawet na stronę.
   Migracja S-03 wprost zapowiada: *"S-05 will add the waiter availability-toggle write path"*
   (`supabase/migrations/20260708124756_menu_categories_items.sql:114`).
3. **Availability zmienia się dziś wyłącznie pełnym PUT-em** (`/api/menu/items/[id]`,
   przepisuje 6 kolumn ze stanu klienta — hazard "stale tab", impl-review F5). Wzorzec dla
   wąskiego PATCH-a jest gotowy: `/api/room/tables/[id]/activation` + `tableActivationSchema`
   + quick-toggle w `TableList.tsx`.
4. **"Klient widzi zmianę przez polling" nie ma dziś żadnego konsumenta** — brak strony
   klienta, polityki anon SELECT usunięte w całości (migracja 20260813010000; lekcja:
   przyszły publiczny odczyt = SECURITY DEFINER RPC z projekcją kolumn, nigdy `using (true)`).
   Kod już antycypuje kompromis: `GET /api/menu` jest opisany jako "the future S-05 polling"
   (`src/pages/api/menu/index.ts:6`). Demonstrowalny zakres S-05 = toggle kelnera + polling
   STAFF-owy; polling klienta anonimowego domyka się w S-08 na RPC.
5. **W repo nie ma żadnego pollingu** (zero `setInterval` w `src/`) — S-05 wprowadza pierwszą
   pętlę. Wzorzec do rozszerzenia: hooki `useMenu`/`useRoomLayout` (fetch-on-mount +
   refetch-after-mutation, guard `cancelled`). Interwał 3–5 s: `tech-stack.md:33-35`, AGENTS.md.
6. **Macierz testów autoryzacji wymaga rozszerzenia kształtu wiersza**: S-05 to pierwszy
   write dozwolony dla kelnera — parametryczna macierz zakłada dziś uniformly kelner→403.
   Rejestr `registry-completeness.test.ts` wymusi wpis nowej trasy (CI padnie bez niego).

## Detailed Findings

### 1. Ścieżka danych availability (stan dzisiejszy)

- Typy: `src/types.ts:4` (`AVAILABILITY = ["available","unavailable","sold_out"]`),
  `:8-12` labels PL, `:66` pole na `MenuItem`, `:79-82` `MenuPayload`.
- Zod: jedyny walidator w `menuItemInputSchema` (`src/lib/schemas/menu.ts:17-47`, pole `:43`);
  test odrzucenia złej wartości `src/lib/schemas/menu.test.ts:88-89`.
- DB: enum + kolumna `supabase/migrations/20260708124756_menu_categories_items.sql:15,93-94`
  (default `'available'`; backfill z dawnego `is_available` `:96-101`).
- Polityki `menu_items` (wszystkie `to authenticated`): `menu_items_select_staff` `:118-121`
  (`company_id = current_company_id()`), `insert/update/delete_owner` `:123-141`
  (`+ current_staff_role() = 'owner'` w using i with check). Anon SELECT (`:106-109`)
  **usunięty** przez `20260813010000_drop_unscoped_anon_read_policies.sql:54-60`.
- API `/api/menu/**`: pełny inwentarz w raporcie — jedyny odczyt kelnera to
  `GET /api/menu` (`src/pages/api/menu/index.ts:7-23`, `{write:false}`); availability
  zmienia wyłącznie PUT `src/pages/api/menu/items/[id].ts:44-56` (pełne 6 kolumn).
- UI: badge w `MenuItemRow.tsx:17-21,84-86`; edycja tylko przez Select w
  `MenuItemDialog.tsx:95,246-263`; jedyna mutacja optymistyczna to reorder
  (`MenuManager.tsx:148-159`, rollback na błędzie).

### 2. Role, middleware, powierzchnia kelnera

- `src/middleware.ts:7,13`: `PROTECTED_ROUTES = [/dashboard,/settings,/menu,/staff,/room]`,
  `OWNER_ROUTES = [/menu,/staff,/room,/settings]`; nie-owner na owner-route → ciche 302 na
  `/dashboard` (`:129-133`). Rola NIE jest claimem JWT — middleware robi SELECT z `profiles`
  (`:58-63`), RLS rozwiązuje ją osobno przez `current_staff_role()`.
- Kill-switch dezaktywacji: zalogowany bez roli → signOut + 401/redirect (`:98-121`).
- Brak generycznego `requireRole` — trzy ręczne guardy: `guardMenuRequest`
  (`src/lib/api.ts:29-52`, write→`role !== "owner"` 403 "Tylko właściciel może modyfikować
  menu"), `guardStaffRequest` (`:68-95`, nawet READ owner-only), `guardTablesRequest`
  (`src/lib/room-api.ts:18-45`). Duplikacja celowa (komentarz `room-api.ts:12-17`).
- Logowanie kelnera: kod lokalu + login → syntetyczny e-mail `login@kod.staff.orderly.invalid`
  (`src/lib/staff-identity.ts:58-60`); po zalogowaniu redirect na `/` (marketing!)
  (`src/pages/api/auth/signin.ts:39`) — do panelu prowadzi tylko link "Panel" w Topbarze.
- Powierzchnia kelnera dziś: strona `/dashboard` (praktycznie pusta: powitanie + KAFEL
  USTAWIEŃ RENDEROWANY BEZ GUARDA `dashboard.astro:48-53`, który odbija do /dashboard),
  `GET /api/menu`, `GET /api/room`, signout. Zero zapisów. Topbar nie jest role-aware.
- SQL: `current_company_id()` / `current_staff_role()` (SECURITY DEFINER, filtr
  `deactivated_at is null`) — `20260727220415_staff_accounts_roles.sql:52-76`. Kelner/kuchnia
  nigdy nie są nazwane w politykach — są tylko "nie-ownerem".

### 3. Polling, PRD, test-plan

- **FR-007 (prd.md:144)**: "Kelner can przełączać dostępność pozycji menu (dostępna /
  niedostępna / wyprzedana) w czasie rzeczywistym" + notka (:145): klient musi zobaczyć
  "wyprzedane", inaczej zamówi niedostępne. Znany dryf: `tech-stack.md:37-39` — "czas
  rzeczywisty" zdegradowany świadomie do pollingu 3–5 s (roadmap.md:147,154 już to stosuje).
- **Access Control (prd.md:220-222)**: kelner — "przełączanie dostępności pozycji menu …
  **Nie zmienia konfiguracji firmy, menu, sali ani kont**"; kuchnia — "Nie edytuje menu"
  wcale. To jest niezmiennik uprawnień dla S-05: **kelner może flipnąć availability i nic
  poza tym** (nie name/price/category/allergens/photo/archive); kuchnia nie może nic.
- **Brak pollingu w repo**: zero `setInterval`; wzorzec danych to hooki
  (`src/components/hooks/useMenu.ts:38-82`) fetch-on-mount + refetch-after-mutation
  z guardem `cancelled`. S-05 wprowadza pierwszy timer.
- **Test-plan §6.4**: nowa trasa MUSI trafić do `tests/integration/authz/route-matrix.ts`
  (rejestr `registry-completeness.test.ts:14-31` skanuje `export const POST|PUT|PATCH|DELETE`
  i wywala CI bez wpisu). Macierz zakłada kelner/kuchnia→403 na write — S-05 jako pierwszy
  waiter-allowed write wymaga nowego kształtu wiersza ("waiter allowed, kitchen 403").
  IDOR (#4): cudzy `[id]` → 404 + dowód braku efektu w DB (service-role). Walidacja (#5):
  reprezentatywny zły input → 400 w `input-parity.test.ts`; przypadki per-constraint w
  testach jednostkowych schematu. §7: po wylądowaniu S-05 odświeżyć test-plan (`--refresh`).

### 4. Precedens: wąski PATCH pojedynczego pola (szablon dla S-05)

- Endpoint: `src/pages/api/room/tables/[id]/activation.ts` (45 linii) — komentarz `:11-14`
  uzasadnia PATCH zamiast PUT (stale tab / impl-review F5); guard `:15-19`; `z.uuid()` na id;
  `parseBody(context, tableActivationSchema)`; update jednego pola → 500/404/`jsonData`.
- Schemat: `src/lib/schemas/room.ts:64-69` (jedno pole, komunikat PL); siostrzane wąskie
  schematy budowane `.pick()` żeby bounds nie dryfowały (`:113-123`).
- Klient: `RoomLayoutManager.tsx:300-316` `toggleActive` (PATCH + refetch, busy-flag);
  UI quick-toggle: `TableList.tsx:35-61` (ikona + `disabled={busy}` + aria-label zależny
  od stanu).
- Konwencje phase2-ownership-input obowiązujące każdy nowy endpoint: 403 z guarda dla złej
  roli, 404 dla cudzego own-path `[id]`, 400 dla złego body (pierwszy zod issue), koperta
  `{data}/{error}`, lookup własności zwraca `{error:500}` zamiast fałszywego 4xx
  (`src/lib/api.ts:97-152`).

## Code References

- `src/types.ts:4-12` — enum AVAILABILITY + labels PL
- `src/lib/schemas/menu.ts:43` — jedyna walidacja availability (pełny schemat)
- `supabase/migrations/20260708124756_menu_categories_items.sql:15,93-94,118-141` — enum, kolumna, polityki RLS
- `supabase/migrations/20260708124756_menu_categories_items.sql:114` — "S-05 will add the waiter availability-toggle write path"
- `supabase/migrations/20260813010000_drop_unscoped_anon_read_policies.sql:48-60` — drop anon + dyrektywa SD-RPC
- `supabase/migrations/20260727220415_staff_accounts_roles.sql:52-76` — current_company_id / current_staff_role
- `src/lib/api.ts:29-52` — guardMenuRequest (write → owner-only 403)
- `src/middleware.ts:7,13,129-133` — PROTECTED/OWNER_ROUTES; kelner odbity z /menu
- `src/pages/api/menu/index.ts:6-23` — GET /api/menu ("the future S-05 polling")
- `src/pages/api/menu/items/[id].ts:44-56` — pełny PUT (jedyna dzisiejsza zmiana availability)
- `src/pages/api/room/tables/[id]/activation.ts` — szablon wąskiego PATCH
- `src/lib/schemas/room.ts:64-69` — szablon schematu jednopolowego
- `src/components/room/TableList.tsx:35-61` — szablon UI quick-toggle
- `src/components/hooks/useMenu.ts:38-82` — hook do rozszerzenia o polling
- `src/pages/dashboard.astro:19-53` — kafle role-aware (i nieguardowany kafel ustawień)
- `src/pages/api/auth/signin.ts:39` — redirect po zalogowaniu na `/`
- `tests/integration/authz/route-matrix.ts:42-` + `registry-completeness.test.ts:14-31` — obowiązkowy wpis trasy

## Architecture Insights

- Rola egzekwowana w 3 niezależnych warstwach (middleware OWNER_ROUTES, guard per rodzina
  tras, RLS `current_staff_role()`) — S-05 musi zmienić wszystkie trzy spójnie, inaczej
  jedna z warstw zablokuje kelnera mimo pozostałych.
- Niezmiennik "kelner zmienia TYLKO availability" nie może żyć wyłącznie w kodzie trasy —
  po lekcji composite-FK egzekwowanie należy do DB. Naturalne opcje: (a) polityka UPDATE
  dla kelnera + trigger pilnujący, że zmienia się wyłącznie kolumna availability,
  (b) SECURITY DEFINER RPC `set_menu_item_availability(id, value)` z guardem roli w SQL.
  Wybór należy do planu; trigger-owe precedensy już istnieją (menu_ordering_hardening,
  profiles_guard_self_change).
- Wąski PATCH zamiast pełnego PUT jest ustaloną konwencją (impl-review F5), z kompletnym
  szablonem endpoint+schemat+UI w rodzinie room.
- Polling: pierwszy w repo; wzorzec hooków daje `refetch()` — pętla to `setInterval(refetch,
  3000-5000)` z pauzą podczas otwartego dialogu/mutacji i guardem `cancelled`; dokumentowa
  liczba 3–5 s pochodzi z tech-stack.md (świadoma degradacja realtime).

## Historical Context (from prior changes)

- `context/archive/2026-07-08-menu-items-management/plan.md` — enum 3 stanów zaprojektowany
  w S-03, toggle kelnera + polling jawnie odroczone do S-05 (linie 16-17, 54-55); kontrakt
  widoczności dla przyszłego klienta: anon widzi `available` + `sold_out`, nie widzi
  `unavailable`/archived (74-75, 143) — polityka usunięta, kontrakt zostaje jako spec S-08.
- `context/changes/staff-accounts-roles/plan.md` — non-goal: żadnych zmian w uprawnieniach
  ról; "the waiter availability toggle is S-05" (145-146). S-05 = pierwszy write kelnera.
- `context/changes/anon-read-scoping/plan.md` — anon polling architektonicznie niemożliwy
  do S-08; przyszły publiczny odczyt tylko przez SECURITY DEFINER RPC z projekcją kolumn.
- `context/changes/phase2-ownership-input/plan.md` — konwencje 403/404/400, koperta
  `{data}/{error}`, dowód braku efektu w DB przy odmowie.
- `context/foundation/lessons.md` — (1) polityka anon bez `company_id` nie ma prawa istnieć;
  (2) Storage przez service_role (nie dotyczy S-05 wprost).

## Related Research

- `context/changes/room-objects/plan.md` — źródło wzorca wąskich PATCH-y i optimistic/rollback.
- `context/foundation/test-plan.md` §6 — cookbook testów integracyjnych dla nowej trasy.

## Decisions (2026-09-10, właściciel)

- **Open Question 2 rozstrzygnięte**: wspólny `/menu` z UI różnicowanym po roli — `/menu`
  wychodzi z `OWNER_ROUTES`; kelner dostaje na tej samej liście wyłącznie szybki przełącznik
  dostępności (owner-akcje: edycja/archiwizacja/reorder/dodawanie ukryte po roli). Kuchnia
  bez zmian (dalej odbijana albo read-only — do rozstrzygnięcia w planie zgodnie z PRD).
- **Open Question 4 rozstrzygnięte**: redirect po zalogowaniu personelu wchodzi w zakres S-05
  (staff nie ląduje na "/", tylko na docelowym widoku).
- **Open Question 1**: plan przyjmuje redukcję — polling staff-owy w S-05, polling klienta
  domyka S-08 (wynika twardo z architektury; do odnotowania w roadmapie przy archiwizacji).

## Open Questions

1. **Zakres "klienta" w S-05** (decyzja do planu): roadmapowy outcome "widoczne dla klienta"
   jest niespełnialny bez S-08 — proponowana redukcja: toggle kelnera + polling na stronie
   staff-owej; klientowy polling = S-08 na SD-RPC. Wymaga jawnego zapisu w planie i (po
   wylądowaniu) w roadmapie.
2. **Gdzie kelner przełącza**: rozszerzyć `/menu` (zdjąć z OWNER_ROUTES i różnicować UI po
   roli) czy zbudować osobny lekki widok kelnerski? `/menu` niesie cały owner-CRUD; PRD mówi
   "kelner nie zmienia menu" — różnicowanie po roli w jednym widoku vs czystość osobnej strony.
3. **Mechanizm DB dla niezmiennika kolumny**: polityka+trigger vs SECURITY DEFINER RPC.
4. **Redirect po zalogowaniu kelnera** na `/` (marketing) — czy S-05 powinien przy okazji
   kierować staff na docelowy widok (mały UX-owy dług, dotyka tej samej ścieżki)?
5. **Kuchnia a odczyt availability**: PRD nie daje kuchni nic przy menu; polling widoku
   kelnerskiego nie może przypadkiem otworzyć zapisu kuchni (macierz: kitchen→403).
