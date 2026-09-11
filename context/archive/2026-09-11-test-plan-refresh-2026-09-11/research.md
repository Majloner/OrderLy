---
date: 2026-09-11T23:59:42+02:00
researcher: Claude Code (Fable 5) for milosz.swiatek@intebuco.pl
git_commit: 4d679a1cf7d1af6c79c63a3d2f94fdfbda5cc2d6
branch: main
repository: 10x (GitHub Majloner/OrderLy)
topic: "Refresh test-planu po wylądowaniu S-05 (menu-availability-toggle) — rekoncyliacja §4–§8"
tags: [research, test-plan, refresh, s-05, menu-availability, rls, authz, polling, e2e, playwright]
status: complete
last_updated: 2026-09-11
last_updated_by: Claude Code (Fable 5)
---

# Research: Refresh test-planu po S-05 (menu-availability-toggle)

**Date**: 2026-09-11T23:59:42+02:00
**Researcher**: Claude Code (Fable 5)
**Git Commit**: `4d679a1` (pushed; permalink base: `https://github.com/Majloner/OrderLy/blob/4d679a1cf7d1af6c79c63a3d2f94fdfbda5cc2d6/`)
**Branch**: main
**Repository**: 10x (OrderLY)

## Research Question

Refresh `context/foundation/test-plan.md` (last updated 2026-08-04) po wylądowaniu S-05
(archiwum: `context/archive/2026-09-07-menu-availability-toggle/`). Zakres rekoncyliacji —
**bez przepisywania §1/§2 bez decyzji właściciela**: (1) §7 negative space (brama dostępności
istnieje), (2) §6 cookbook (wzorce S-05), (3) §5/§6 e2e istnieje + faza AI-native visual
skreślona, (4) §4 stack + §8 ledger daty, (5) lekcja middleware/test:integration z lessons.md.
Wywiad pominięty decyzją właściciela — refresh mechaniczny.

## Summary

Wszystkie pięć obszarów rekoncyliacji potwierdzone w żywym kodzie, z dokładnymi kotwicami:

1. **§7 jest nieaktualny w 1/3**: z trójki „pętla zamówienia, brama dostępności, trwałość QR — kod
   nie istnieje" **brama dostępności istnieje od S-05** (PATCH `availability`, polityka kelnera
   w RLS, trigger niezmiennika kolumny, polling). Pętla zamówienia i trwałość QR (S-07/S-08)
   nadal nie istnieją — bullet trzeba rozszczepić, nie skasować.
2. **§6 ma pięć nowych wzorców do dopisania** (wszystkie już zaimplementowane i przetestowane):
   wiersz macierzy authz z `waiterAllowed` (pierwszy staff-write), asercje RLS 27/28/29 na trigger
   kolumnowy (w tym reorder-RPC-jako-kelner → P0001 i przebazowana asercja 4), wąski PATCH wg
   szablonu `activation`, polling `useMenu` (4 s, trzy pauzy, ciche ticki) z **ręczną** (nie
   automatyczną) weryfikacją dwusesyjną, oraz pinowanie happy-path na warstwie route
   (`tests/integration/menu/availability-toggle.test.ts`).
3. **§4/§5 e2e**: Playwright istnieje lokalnie w pełni (config + `auth.setup.ts` z **dwoma**
   ownerami + 3 specy w `tests/e2e/`), ale **nie biegnie w CI**. Trzy wiersze §4 „none yet — see
   §3 Phase N" są martwe (harness i mocking dowiezione w Fazie 1–2; e2e istnieje, a Faza 4 jest
   skreślona 2026-09-06). Suite integration urósł do 20 plików z nowymi grupami `contract/` i `menu/`.
4. **§8 ledger**: wszystkie trzy daty to 2026-08-04 — do przestemplowania; wersje narzędzi
   zweryfikowane (vitest 4.1.10, @playwright/test 1.62.1, Stryker 10.0.0, supabase CLI
   ^2.23.4 → **resolved 2.98.2**).
5. **Lekcja middleware/test:integration** (lessons.md, źródło: S-05 impl-review F2) nie jest
   odzwierciedlona w §6 — powinna trafić do §6.7 (i/lub §6.6) jako twarda reguła kryteriów fazy.

## Detailed Findings

### (1) §7 negative space — brama dostępności istnieje

Obecny bullet ([test-plan.md:247](context/foundation/test-plan.md)): „Pętla zamówienia, brama
dostępności i trwałość QR — kod nie istnieje (S-05/S-07/S-08)". S-05 dowiózł bramę dostępności:

- **PATCH endpoint**: [availability.ts:16-44](src/pages/api/menu/items/[id]/availability.ts) —
  jedyny eksport `PATCH`; `z.uuid()` na paramie; update **jednej kolumny** rekonstruowany z
  parsowanego inputu; `.is("archived_at", null)`; pusty wynik ⇒ 404 (tak ujawnia się cross-tenant
  i archived).
- **Polityka kelnera + guard**: [api.ts:41-43](src/lib/api.ts:41) — tryb guarda
  `write: "availability"` wpuszcza ownera i kelnera, kuchnia 403; pozostałe write'y zostają
  owner-only ([api.ts:44-46](src/lib/api.ts:44)).
- **Trigger niezmiennika kolumny**:
  [20260910080000_menu_availability_waiter_write.sql:36-53](supabase/migrations/20260910080000_menu_availability_waiter_write.sql) —
  `guard_menu_item_staff_columns()`: dla roli ≠ owner `(to_jsonb(old) - 'availability') is distinct
  from (to_jsonb(new) - 'availability')` ⇒ `raise exception` (P0001); odporny na przyszłe kolumny;
  NULL-owa rola (service_role/migracje) przechodzi. Polityka
  `menu_items_update_availability_waiter` (`:19-25`), kuchnia celowo **bez polityki** = odmowa.
- **Poprawka archived (F3)**:
  [20260911090000_menu_availability_waiter_policy_archived.sql:9-15](supabase/migrations/20260911090000_menu_availability_waiter_policy_archived.sql) —
  `and archived_at is null` w USING/WITH CHECK polityki kelnera (route filtrował, DB nie — kelner
  z własnym JWT przez PostgREST omijał route).
- **Polling**: [useMenu.ts:101-128](src/components/hooks/useMenu.ts:101) (szczegóły w (2)).

**Nadal NIE istnieją**: pętla zamówienia i trwałość QR (S-07/S-08) — brak tras publicznych, brak
konsumenta anon (potwierdza to też lekcja anon-RLS). Bullet w §7 wymaga rozszczepienia: część
S-05 wykreślić (pokrycie opisać w §6), część S-07/S-08 zostawić.

### (2) §6 cookbook — wzorce S-05 do dopisania

**(a) Pierwszy staff-write w macierzy authz — flaga `waiterAllowed`**

- Deklaracja: [route-matrix.ts:40](tests/integration/authz/route-matrix.ts:40)
  (`waiterAllowed?: boolean`, brak = klasyczny kontrakt owner-only — wiersze sprzed S-05
  nietknięte; oczekiwanie kuchni **nigdy** nie waha się: 403).
- Jedyny wiersz z `waiterAllowed: true`:
  [route-matrix.ts:84-91](tests/integration/authz/route-matrix.ts:84) (PATCH availability),
  na 22 trasy w rejestrze.
- Gałąź w teście: [write-routes.test.ts:37-50](tests/integration/authz/write-routes.test.ts:37) —
  `waiterAllowed` ⇒ „admits the waiter past the guard (not 401/403)", else ⇒ kelner 403;
  anon 401 i kuchnia 403 bezwarunkowo ([:32-35](tests/integration/authz/write-routes.test.ts:32),
  [:52-55](tests/integration/authz/write-routes.test.ts:52)).
- Wymuszenie wiersza: [registry-completeness.test.ts:36-41](tests/integration/authz/registry-completeness.test.ts:36)
  skanuje `export const POST|PUT|PATCH|DELETE` — nowa trasa bez wpisu = czerwone.
- Projekt wzorca w archiwum: „rozszerzyć kształt wpisu, nie klonować testu"
  (`archive/.../plan.md:85-87`), anon 401 / kuchnia 403 / kelner 200 / owner 200
  (`plan.md:193-197`).

**(b) Asercje RLS na trigger kolumnowy (27/28/29 + przebazowana 4)**

Plik: [rls_isolation.sql](supabase/tests/rls_isolation.sql) — uwaga: kolejność w pliku to
27 → 29 → 28 (29 dopisana przez `9e9d35a` między nimi).

- **Asercja 27** (`:1021-1062`) — cztery własności w jednym bloku: flip kelnera ląduje (1 wiersz);
  przemyt `availability+price` w jednym UPDATE odrzucony w całości z P0001, availability bez
  zmian; cross-tenant = 0 wierszy; archived = 0 wierszy (F3, `:1055-1059`).
- **Asercja 28** (`:1092-1110`) — kuchnia czyta menu, ale UPDATE availability = **0 wierszy**
  („brak polityki" — trigger nawet nie biegnie).
- **Asercja 29** (`:1064-1090`, „impl-review F4") — `reorder_menu_items` (SECURITY INVOKER,
  EXECUTE dla PUBLIC) wywołany **jako kelner** musi abortować z **P0001**: po S-05 kelner
  dopasowuje politykę UPDATE, więc `set sort_order` RPC-a dociera do triggera zamiast być
  cicho odfiltrowany. Pułapka fixture: zamieniane są dwa wiersze, które **na pewno** się
  zmienią — „no-op nigdy nie dociera do triggera" (`:1075-1077`).
- **Przebazowana asercja 4** (`:169-212`) — UPDATE `description` kelnera oczekuje teraz P0001
  (trigger), nie 0 wierszy. **Semantyka odmowy jest częścią kontraktu asercji**: „brak polityki"
  = 0 wierszy (kuchnia), trigger = P0001 (kelner); nowa polityka dopasowująca rolę wymaga
  przebazowania starych oczekiwań 0-wierszy (por. interlock z §6.5 przy Ryzyku #2).

**(c) Wąski PATCH wg szablonu `activation`**

- Wzorzec: guard → `z.uuid()` na `[id]` → `parseBody` ze schematem jednopolowym → update jednej
  kolumny → 404/500/`jsonData`; szablon: `src/pages/api/room/tables/[id]/activation.ts`,
  realizacja: [availability.ts](src/pages/api/menu/items/[id]/availability.ts).
- Schemat przez `.pick()`: [menu.ts:76](src/lib/schemas/menu.ts:76)
  (`menuItemInputSchema.pick({ availability: true })`) — enum i komunikat PL nie mogą dryfować;
  unity: [menu.test.ts:95-111](src/lib/schemas/menu.test.ts:95).
- Uzasadnienie wąskości w komentarzu route'a (`availability.ts:10-15`): pełny PUT z nieświeżej
  karty cofnąłby cudze edycje i dałby kelnerowi zakazane kolumny.
- Dopisane wiersze do istniejących rejestrów: parity
  ([input-parity.test.ts:126-133](tests/integration/validation/input-parity.test.ts:126) —
  `{availability:"hidden"}` ⇒ 400) i cross-tenant write
  ([cross-tenant-write.test.ts:79-101](tests/integration/isolation/cross-tenant-write.test.ts:79) —
  celowo jako **kelner**, żeby ćwiczyć predykat `company_id` nowej polityki; 404 + dowód
  service-role braku efektu).

**(d) Pierwszy polling (`useMenu`) i jego weryfikacja**

- Hook: [useMenu.ts:38-46](src/components/hooks/useMenu.ts:38) (`pollMs`, `pollPaused`),
  [useMenu.ts:101-128](src/components/hooks/useMenu.ts:101) — tick pomijany gdy
  `cancelled || inFlight || pollPaused || document.hidden` (sprawdzane **per tick**, bez
  listenera visibilitychange); porażka ticka **cicha** (`:118`) — tylko initial load ustawia
  `loadError`.
- Konsument: [MenuManager.tsx:55-56](src/components/menu/MenuManager.tsx:55) —
  `pollPaused = dialogi || confirm || busyMutations > 0`; `pollMs: 4000`; polling istnieje
  tylko na `/menu`.
- Busy-counter (F1): [MenuManager.tsx:169-183](src/components/menu/MenuManager.tsx:169) —
  `changeAvailability` inkrementuje/dekrementuje licznik `busyMutations` (wzorzec
  `persistReorder`); `availabilityBusyId` tylko do disabled per-wiersz.
- **Testy hooka: brak** (żaden plik nie testuje `useMenu`/`pollMs`/`pollPaused`).
- **Weryfikacja dwusesyjna była RĘCZNA**: `archive/.../plan.md:316` („Dwie sesje (kelner+owner):
  przełączenie widoczne ≤5 s bez odświeżania", odhaczona w Progress `plan.md:407` przy 2a1ea8c);
  kryteria automatyczne Fazy 4 = tylko lint+typecheck (`plan.md:309-313`). Najbliższy
  automatyczny dwu-kontekstowy test to [tenant-isolation.spec.ts](tests/e2e/tenant-isolation.spec.ts)
  (izolacja, nie polling). To udokumentowana luka — kandydat do §6.3/§7, decyzja w planie.
- Zaakceptowane ryzyko F6 (bez fixa): otwarty Select vs zdalna zmiana w oknie 4 s ticka
  (`archive/.../reviews/impl-review.md:114-128`).

**(e) Pinowanie happy-path warstwy route (F5)**

- [availability-toggle.test.ts:25-45](tests/integration/menu/availability-toggle.test.ts:25) —
  kelner A PATCHuje własną pozycję ⇒ 200 + payload + re-read service-role dowodzący trwałości.
  Pinuje „środek", którego macierz (guard) i SQL (DB) nie widzą. Reguła cookbook: **ręczny
  spot-check happy-path promuj do trwałego testu** (nagłówek pliku `:7-11` mówi wprost, że
  powstał z usuniętego spot-checka fazy 2).
- Reguła bliźniacza z F3: **każdy filtr wierszy na poziomie route'a wyrażający politykę musi
  mieć lustro w RLS i pin w SQL** („DB ma być warstwą egzekwowania").

### (3) §4/§5/§6.3 — e2e istnieje; Faza 4 skreślona

- **Config**: [playwright.config.ts](playwright.config.ts) — `testDir: "tests/e2e"`, `.env.e2e`,
  baseURL `E2E_BASE_URL ?? localhost:4321`, projekt `setup` + `chromium` ze
  `storageState: playwright/.auth/owner.json`, `webServer: npm run dev`; gałęzie CI
  (`forbidOnly`, `retries: 2`, reporter github) obecne, ale **martwe** — patrz niżej.
- **Auth setup**: [auth.setup.ts](tests/e2e/auth.setup.ts) — **dwa** testy setup (owner A `:91`
  i owner B `:97` → `owner.json`/`owner-b.json`), logowanie przez realne UI, hydratacja po
  `astro-island:not([ssr])`, opcjonalny idempotentny provisioning za `E2E_PROVISION=1`.
- **3 specy**: [seed.spec.ts](tests/e2e/seed.spec.ts) (owner tworzy/usuwa kategorię przez UI —
  wzorcowy spec, Ryzyko #3), [route-protection.spec.ts](tests/e2e/route-protection.spec.ts)
  (anon na `/menu` ⇒ redirect do signin — Ryzyko #3 połowa stron),
  [tenant-isolation.spec.ts](tests/e2e/tenant-isolation.spec.ts) (kategoria ownera A niewidoczna
  dla ownera B w drugim kontekście + kontrola pozytywna — Ryzyko #1).
- **Skrypt**: `test:e2e: playwright test` (package.json:16). **CI: zero dopasowań**
  `playwright|e2e|stryker` w `.github/` — e2e jest lokalne-only, bez instalacji przeglądarek
  w workflow.
- **Martwe wiersze §4** ([test-plan.md:118-121](context/foundation/test-plan.md)):
  - „API/route harness: none yet — see §3 Phase 1" — Faza 1 complete; harness =
    `buildContext` ([context.ts](tests/integration/helpers/context.ts)).
  - „API mocking: none yet — see §3 Phase 1" — istnieje: mock krawędzi Storage
    (`vi.mock("@/lib/storage")`, §6.2 już to opisuje).
  - „e2e: none yet — see §3 Phase 4 (opcjonalnie)" — e2e istnieje, a Faza 4 jest **skreślona
    2026-09-06** ([test-plan.md:87-95](context/foundation/test-plan.md)) — wskazywanie na nią
    jest podwójnie mylne. Analogicznie §6.3 „TBD — see §3 Phase 4" i wiersz bramki
    „multimodal visual review … after §3 Phase 4" w §5.
- **Suite integration urósł**: 20 plików testowych + 6 wspierających; nowe grupy poza
  authz/isolation/validation: `contract/` ([api-route-contract.test.ts](tests/integration/contract/api-route-contract.test.ts),
  wymusza `prerender=false`, commit 34b8b5b) i `menu/` (happy-path S-05). §6.6/§6.2 wyliczenia
  katalogów do odświeżenia.

### (4) §4 stack + §8 ledger — wersje i daty

- Wersje (declared → resolved): vitest ^4.1.10 → 4.1.10 (bez zmian); **@playwright/test
  ^1.62.1 → 1.62.1 (nowy wiersz do §4)**; @stryker-mutator/core+vitest-runner ^10.0.0 → 10.0.0;
  supabase CLI **^2.23.4 → resolved 2.98.2** (pin przez package-lock + `npx`, nie exact w
  package.json; CI celowo używa lockfile-pinned CLI, nie `setup-cli@latest` — ci.yml:46-52);
  astro 6.3.1, zod ^4.4.3.
- Skrypty: bez zmian poza istniejącym `test:e2e`; **brak skryptu stryker** (ad hoc `npx stryker
  run`); Stryker scope nadal `["src/middleware.ts"]`
  ([stryker.config.json](stryker.config.json):5, suite zawężony w
  [vitest.stryker.config.ts](vitest.stryker.config.ts):12) — wiersz §4 mutation aktualny
  (checked: 2026-08-26).
- Unit suite: nadal 6 plików (~180 case'ów) — twierdzenie §4 aktualne.
- CI ([ci.yml](.github/workflows/ci.yml)): kształt „fast + db" bez zmian; delta warta zapisu:
  krok `npx astro sync` w job `fast` (typy `astro:env`) i generowanie `.env.test` z
  `supabase status -o env` w job `db`.
- §8 ledger: wszystkie trzy daty 2026-08-04 → przestemplować na datę refreshu; wiersz
  AI-native visual w §4 (checked: 2026-08-04) dotyczy skreślonej Fazy 4 — do decyzji: usunąć
  czy oznaczyć jako wycofane (revert `aacc534`).
- Wiersz §4 „e2e: promować tylko dla ścieżek, których nie łapie integration" — filozofia
  aktualna, potwierdzona przez S-05 (plan dodał zero nowych spec'ów, tylko zaktualizował
  route-protection).

### (5) Lekcja middleware/test:integration (S-05 F2)

- Lekcja ([lessons.md:55-65](context/foundation/lessons.md:55)): faza dotykająca
  middleware/guardów/route-gatingu **musi** mieć `npm run test:integration` w kryteriach
  automatycznych; wyniki czytać z exit code, nigdy przez pipe do tail/grep.
- Geneza: e534101 wyjął `/menu` z `OWNER_ROUTES`, kontrakt macierzy middleware pękł po cichu —
  kryteria fazy 3 gnały tylko lint/typecheck/build/**e2e** (e2e zaktualizowano w tym samym
  commicie, więc e2e zostało zielone, a integration czerwone niezauważenie); zbiorczy re-run
  maskował exit code pipe'em do `tail`. Fix: 5be3d00
  ([middleware.test.ts:48,189-199,246-252](tests/integration/authz/middleware.test.ts:48)).
- W test-planie ta reguła nie występuje — naturalne miejsca: §6.7 (dopisek do pułapek) i/lub
  §6.6; ewentualnie wzmianka w §5 (bramki per-faza).

### Hot-spoty 30 dni (evidence, nie anchory)

Zliczone na HEAD `4d679a1` (`git log --oneline --since='30 days ago'`):

| Katalog | Commity/30d |
|---|---|
| `tests/integration` (całość) | 14 |
| `tests/integration/authz` | 11 |
| `src/pages` | 9 |
| `src/components/menu` | 7 |
| `src/middleware.ts` | 7 |
| `tests/e2e` | 6 |
| `src/components/room` | 4 |
| `supabase/migrations` | 4 |
| `supabase/tests` | 4 |
| Unia (pages+room+menu+authz) | **23 unikatowe** |

Uwaga: brief mówił „33 commity" dla unii czterech katalogów — faktyczna unia to 23 (suma
per-katalog z nakładaniem = 31). Do §2 (kolumna Źródło) tych liczb **nie** wpisujemy bez
decyzji — §1/§2 poza zakresem; zapisane tu jako świeży dowód dla przyszłego pełnego refreshu.

## Code References

- `src/pages/api/menu/items/[id]/availability.ts:16-44` — wąski PATCH (guard, z.uuid, jedna kolumna, 404)
- `src/lib/api.ts:32-58` — tryb guarda `write: "availability"` (owner+waiter, kuchnia 403)
- `src/lib/schemas/menu.ts:76` — `menuItemAvailabilitySchema` przez `.pick()`
- `supabase/migrations/20260910080000_menu_availability_waiter_write.sql:19-53` — polityka kelnera + trigger `guard_menu_item_staff_columns`
- `supabase/migrations/20260911090000_menu_availability_waiter_policy_archived.sql:9-15` — F3: `archived_at is null` w polityce
- `supabase/tests/rls_isolation.sql:1021-1110` — asercje 27/29/28 (kolejność pliku); `:169-212` przebazowana asercja 4
- `tests/integration/authz/route-matrix.ts:40,84-91` — `waiterAllowed` + jedyny wiersz z flagą
- `tests/integration/authz/write-routes.test.ts:37-50` — gałąź waiterAllowed w macierzy
- `tests/integration/menu/availability-toggle.test.ts:25-45` — pin happy-path route (F5)
- `tests/integration/validation/input-parity.test.ts:126-133` — parity availability
- `tests/integration/isolation/cross-tenant-write.test.ts:79-101` — cross-tenant PATCH jako kelner
- `src/components/hooks/useMenu.ts:38-46,101-128` — polling: opcje i pętla z trzema pauzami
- `src/components/menu/MenuManager.tsx:55-56,169-183` — pollPaused, busy-counter (F1)
- `tests/e2e/auth.setup.ts:91,97` — setup dwóch ownerów; `tests/e2e/*.spec.ts` — 3 specy
- `playwright.config.ts:15,24-39` — testDir, projekty, webServer
- `.github/workflows/ci.yml:17-65` — joby fast/db; brak e2e/stryker
- `stryker.config.json:5` + `vitest.stryker.config.ts:12` — scope mutacji bez zmian
- `context/foundation/test-plan.md:87-95,118-121,171,247,249-253` — miejsca do edycji
- `context/foundation/lessons.md:55-65` — lekcja middleware/test:integration

## Architecture Insights

- **Trzy warstwy egzekwowania poruszają się razem** (middleware `OWNER_ROUTES` / guard rodziny /
  RLS+trigger), każda z własnym poziomem testu (macierz middleware / macierz tras / suite SQL) —
  S-05 zmienił po jednej warstwie na fazę i każda zmiana miała swój pin. F2 pokazało koszt
  złamania tej symetrii w kryteriach fazy.
- **Semantyka odmowy jako kontrakt**: 0 wierszy („brak polityki") vs P0001 (trigger) vs 403
  (guard) vs 400 (schemat) — asercje muszą nazywać faktyczną warstwę łapiącą; nowa polityka
  dopasowująca rolę wymusza przebazowanie starych oczekiwań (asercja 4).
- **Trigger zamiast RLS dla niezmienników kolumnowych** — RLS nie umie ograniczyć zapisu do
  kolumny; wzorzec `to_jsonb(old) - '<kolumna>'` jest odporny na przyszłe kolumny i przepuszcza
  service_role (NULL-owa rola).
- **Filtr route'a ≠ polityka**: każdy warunek wierszowy wyrażający politykę (np. archived)
  musi mieć lustro w RLS — route to tylko przyjazne błędy.
- **E2E jako uzupełnienie, nie duplikacja**: S-05 nie dodał spec'ów, tylko zaktualizował
  kontrakt istniejącego; jedyna realna luka e2e to cross-session polling (dziś ręczna
  weryfikacja odhaczona w archiwum).

## Historical Context (from prior changes)

- `context/archive/2026-09-07-menu-availability-toggle/plan.md` — projekt waiterAllowed
  (`:85-87,193-197`), trigger (`:112-118`), polling i pauzy (`:284-306`), kryteria faz
  (`:267-271` — brak test:integration w fazie 3; `:309-313` — faza 4 tylko lint+typecheck),
  ręczna weryfikacja dwusesyjna (`:314-319`, Progress `:405-410`).
- `context/archive/2026-09-07-menu-availability-toggle/reviews/impl-review.md` — APPROVED,
  6 findingów: F1 busy-counter (fixed), F2 OWNER_PAGES/exit-code (fixed, → lekcja), F3 archived
  (fixed migracją), F4 reorder-RPC pin (→ asercja 29), F5 happy-path pin (→ test menu/),
  F6 otwarty Select vs tick (ACCEPTED).
- `context/archive/2026-09-07-menu-availability-toggle/plan-brief.md:73-75` — anon-klient
  odłożony do S-08 (SECURITY DEFINER RPC); refresh nie może liczyć klienta QR na konto S-05.
- `context/changes/middleware-route-protection/` — poprzednik wzorca §6.7; S-05 F2 to regres
  dokładnie tego kontraktu.
- `context/changes/anon-read-scoping/` — precedens „sprawdź przesłankę, zanim uznasz za
  zablokowane"; potwierdza, że S-07/S-08 nadal nie mają kodu (część §7 zostaje).

## Related Research

- `context/archive/2026-09-07-menu-availability-toggle/research.md` — mapa kodu przed S-05
  (macierz authz `:49-51,108-111`, szablon activation `:116-129`, trzy warstwy `:153-155`).
- `context/changes/testing-tenant-isolation-integration/KNOWN-GAPS.md` — znane luki harnessu
  (referencja §6.6).

## Open Questions

Decyzje dla `/10x-plan` (nie rozstrzygać w refreshu mechanicznym):

1. **Luka pollingu**: czy udokumentować ręczną weryfikację dwusesyjną jako świadome wykluczenie
   w §7, czy zapisać jako kandydata e2e w §6.3? (F6 zaakceptowane ryzyko sugeruje pierwsze;
   filozofia „promować tylko czego integration nie łapie" dopuszcza drugie — cross-session
   propagacja jest niełapalna niżej.)
2. **E2E w CI**: §5 nie ma bramki e2e, a suite istnieje lokalnie z martwymi gałęziami CI w
   configu. Dodać wiersz `planned`/`optional` do §5, czy zostawić poza bramkami? (Zmiana samego
   CI to osobny change, nie refresh planu.)
3. **Wiersz AI-native visual w §4**: usunąć czy zostawić z adnotacją o skreśleniu Fazy 4 i
   revercie `aacc534`?
4. **Liczby hot-spotów w §2**: brief podał 33, unia daje 23 — §2 poza zakresem refreshu, ale
   przyszły pełny refresh powinien przeliczyć kolumnę Źródło na świeżych liczbach.
