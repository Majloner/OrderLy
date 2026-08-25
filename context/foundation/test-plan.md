# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-04

## 1. Strategy

Testy w tym projekcie podlegają trzem nienegocjowalnym zasadom:

1. **Koszt × sygnał.** Wygrywa najtańszy test dający realny sygnał dla danego
   ryzyka. Nie promuj do e2e dlatego, że e2e „wydaje się bezpieczniejsze". Nie
   nakładaj modelu wizyjnego na deterministyczny diff, który już łapie regresję.
2. **Obawy użytkownika to dowód pierwszej kategorii.** Ryzyka zakotwiczone w
   „zespół boi się X, a porażka wyszłaby gdzieś w obszarze `<area>`" ważą tyle
   samo co linie PRD czy dane o churnie.
3. **Ryzyka to scenariusze, nie lokalizacje w kodzie.** Ten plan opisuje *co
   może się zepsuć* i *dlaczego uważamy to za prawdopodobne* — na podstawie
   dokumentów, wywiadu oraz *sygnału* z kodu (churn, struktura, baza testów).
   NIE twierdzi, że wie, która linia jest właścicielem porażki. Tę wiedzę
   wytwarza `/10x-research` w każdej fazie rolloutu. Jeśli plan i research nie
   zgadzają się co do tego, gdzie żyje porażka — prawdą jest research.

Zakres hot-spotów użyty do ważenia likelihood: `src/`, `supabase/`.

## 2. Risk Map

Najważniejsze scenariusze porażki, które projekt musi chronić, uporządkowane
wg ryzyka = impact × likelihood. Ryzyka to scenariusze porażki w kategoriach
użytkownika / biznesu, nie nazwy testów. Kolumna Źródło cytuje *dowód, który
wypromował to ryzyko* — nigdy konkretnego pliku jako „gdzie żyje porażka" (to
zadanie research, patrz §1 zasada #3).

| # | Ryzyko (scenariusz porażki) | Impact | Likelihood | Źródło (dowód — nie anchor) |
|---|------------------------------|--------|------------|------------------------------|
| 1 | Zalogowany użytkownik firmy A czyta lub modyfikuje wiersze firmy B (menu, personel, stoliki) — RLS albo rozwiązanie `company_id` zawodzi | High | High | wywiad Q1; PRD Access Control + NFR („żadne żądanie nie ujawnia danych innej firmy"); hot-spot dir `supabase/tests/` (11 zmian/30d) + `src/` `middleware.ts` (7/30d); lekcja „anon RLS reads must be scoped by company_id" |
| 2 | Anonimowy klucz czyta cudze wiersze (pozycje menu, stoliki wraz z geometrią sali), bo polityka anon-read nie ma predykatu `company_id` | High | Medium | PRD Access Control (anon dostęp tylko do ścieżki stolika) + guardrail sesji; lekcja anon-RLS. **CHRONIONE od 2026-08-13**: powierzchnia anon usunięta (nie miała konsumenta), asercje na dwóch warstwach — patrz `context/changes/anon-read-scoping/` |
| 3 | Nie-właściciel (kelner/kuchnia) wykonuje write owner-only (edycja menu, provisioning personelu, układ sali), albo niezalogowany dosięga trasy chronionej | High | High | wywiad Q3; PRD Access Control (role właściciel/kelner/kuchnia); hot-spot dir `src/pages/api` (38/30d) + `src/lib/` (`api.ts` 6/30d, `middleware.ts` 7/30d). **CHRONIONE (obie połowy) od 2026-08-25**: API — macierz authz (Fazy 1–2); trasy stron (middleware, w tym signOut zdezaktywowanych) — patrz `context/changes/middleware-route-protection/` i §6.7. Przy okazji naprawiono dwa rozjazdy oracle↔kod: `/settings` nie było w `OWNER_ROUTES`, a check dezaktywacji nie obejmował publicznego `/` |
| 4 | IDOR: właściciel mintuje URL uploadu / podpina zdjęcie / wskazuje kategorię dla zasobu innej firmy (id z klienta, ścieżka z serwera) → osierocone obiekty lub cudzy zasób | High | Medium | wywiad Q2; lekcja „Supabase Storage nie honoruje tokenu użytkownika → service_role"; PRD FR-005; hot-spot dir `src/pages/api` (38/30d) |
| 5 | Serwer przyjmuje wejście, które UI odrzuciłoby (ujemna/olbrzymia cena, pusty `name`, zły enum roli/dostępności/kształtu, obcy MIME lub rozmiar zdjęcia) — brak walidacji zod lub jej rozjazd z kontraktem | Medium | Medium | wywiad Q3; hot-spot dir `src/lib/schemas` (21/30d); PRD FR-004/FR-005; AGENTS.md („validate input with zod") |
| 6 | Właściciel blokuje sam siebie lub następuje eskalacja: self-demote, self-deactivate albo awans personelu do `owner` omija trigger ochronny | High | Low | roadmap S-02 (dowiezione); PRD Access Control (rola `owner` niegrantowalna); hot-spot dir `src/pages/api` (staff, 38/30d) + `src/lib/schemas` (`staff` 4/30d) |

**Rubryka Impact × Likelihood.** Obie osie w skali High / Medium / Low, żeby
dwóch czytelników zgodziło się na ten sam wiersz. Bez fałszywej precyzji —
celem jest kolejność.

| Ocena | Impact | Likelihood |
|-------|--------|------------|
| High   | użytkownik traci dostęp, dane lub pieniądze; porażka publicznie widoczna | obszar zmienia się co tydzień lub już się tu sparzyliśmy |
| Medium | funkcja degraduje, istnieje obejście, dotyka tylko część użytkowników | dotykane sporadycznie, bywało źródłem błędów |
| Low    | kosmetyka, łatwe do cofnięcia, brak wpływu na dane | kod stabilny, rzadko ruszany |

Chroń High × High najpierw. Scenariusze High-impact × Low-likelihood (np.
awaria dostawcy chmury) należą zwykle do observability/alertingu, nie do
testów — dlatego R6 (Low likelihood) jest ostatni w kolejce, nie pominięty:
niezmiennik istnieje w kodzie (trigger), więc test że „bezpiecznik trzyma" ma
sens, ale nie wyprzedza ryzyk High × High.

### Risk Response Guidance

| Ryzyko | Co dowodzi ochrony | Musi zakwestionować | Kontekst do ugruntowania przez `/10x-research` | Najtańsza warstwa | Anti-pattern |
|--------|--------------------|---------------------|-----------------------------------------------|-------------------|--------------|
| #1 | Żądanie uwierzytelnione jako firma A nigdy nie zwraca ani nie zmienia wiersza firmy B — na każdej encji domenowej | „owner = może wszędzie" (rola nie znosi granicy tenanta) | jak rozwiązywane są `company_id` i rola; komplet polityk RLS per tabela; punkt wejścia żądania | integration (route API pod lokalnym Supabase, 2 firmy × role) | asercja skopiowana z definicji RLS; happy-path pojedynczego tenanta |
| #2 | Posiadacz klucza publicznego, bez sesji i kontekstu firmy, czyta **zero** wierszy najemcy i nie pisze | „anon read jest nieszkodliwy" ORAZ „naprawa musi czekać na S-07/S-08" — to drugie okazało się fałszywe: przesłanka trzyma tylko wtedy, gdy coś tę powierzchnię konsumuje, a nic jej nie konsumowało | czy istnieje JAKIKOLWIEK konsument anon (klient przeglądarkowy, trasa publiczna, QR); bez niego to nie „zawęź predykat", lecz „usuń nieużywaną powierzchnię" | SQL RLS (predykat polityki) **plus** integration na realnym kluczu anon (brama → PostgREST → GRANT-y → RLS) — dwie różne rzeczy | test zerowych wierszy bez kontroli service-role (przeszedłby też na pustej bazie); asercja z warstwy tras (guard łapie przed zapytaniem, więc nie mówi nic o DB) |
| #3 | Write owner-only zwraca 403 dla kelnera/kuchni; trasa chroniona przekierowuje anonimowego | „200 na happy-path oznacza, że autoryzacja działa" | gdzie żyje guard vs middleware vs RLS; mapa tras owner-only | integration (te same route’y jako 3 role) | mock guarda; test wyłącznie ścieżki właściciela |
| #4 | Mint/attach/kategoria dla `itemId`/`categoryId` z innej firmy kończy się odmową, bez zapisu i bez obiektu w Storage | „istnieje FK, więc zasób jest mój" | jak endpoint buduje ścieżkę i sprawdza własność (SELECT RLS-scoped przed operacją service-role) | integration (owner A celuje w zasób firmy B) | over-mock klienta service-role; sprawdzanie tylko formatu ścieżki |
| #5 | Serwer odrzuca wejście spoza kontraktu niezależnie od tego, co robi UI | „klient już waliduje, więc serwer może ufać" | źródło prawdy kontraktu (schema) vs to, co route faktycznie parsuje i egzekwuje | unit (schema) + integration (route zwraca 400) | oracle wzięty z implementacji; test odbijający zod zamiast kontraktu PRD |
| #6 | Owner nie może zdegradować ani zdezaktywować siebie, ani awansować kogoś do `owner`; próba kończy się odmową, a role pozostają bez zmian | „skoro to owner, wszystko mu wolno" | co dokładnie blokuje trigger ochronny i jak route tłumaczy błąd uprawnień na odpowiedź | integration (owner próbuje self-change) | asercja na treść komunikatu triggera zamiast na efekt (rola niezmieniona) |

## 3. Phased Rollout

Każdy wiersz to odrębna faza rolloutu, która otworzy własny folder zmiany
przez `/10x-new`. Status przesuwa się od lewej do prawej wg wartości poniżej;
orkiestrator aktualizuje Status w miarę pojawiania się artefaktów na dysku.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|---------------|------------|--------|---------------|
| 1 | Integration harness + tenant isolation | Postawić warstwę integration (lokalne Supabase, route API jako 2 firmy × role) i przejść cały łańcuch middleware → guard → RLS → odpowiedź | #1, #2, #3 | integration, SQL RLS | complete | context/changes/testing-tenant-isolation-integration/ |
| 2 | Ownership + input boundaries | Obronić IDOR na zasobach, parytet walidacji serwera i niezmiennik uprawnień personelu | #4, #5, #6 | integration, unit/contract | complete | context/changes/phase2-ownership-input/ |
| 3 | Quality gates wiring | Zabetonować podłogę: lint + typecheck + unit+integration w CI; lokalny post-edit hook | cross-cutting | gates, hook | complete | context/changes/quality-gates-ci/ |
| 4 | AI-native selective visual | Multimodalny przegląd wizualny 1–3 krytycznych ekranów właściciela po redesignie „Karta/bistro" | cross-cutting | multimodal visual review | not started | — |

**Faza 4 jest zablokowana — nie zaczynaj jej „bo została".** Dwa niezależne powody,
oba sprawdzalne: (1) jej cel to przegląd ekranów **po** redesignie „Karta/bistro", a
ta zmiana ma status `planned` i 0/55 pozycji Progress (`context/changes/ui-redesign/`)
— nie ma czego przeglądać, co potwierdza też §4 („When NOT to use: ekrany bez zmiany
wizualnej"); (2) `CLAUDE.md` przypisuje multimodal scenario code do Lekcji 4, poza
zakresem bieżącej. Status zostaje `not started`, bo słownik poniżej nie ma wartości
„blocked", a wpisanie `complete` fazie, która się nie odbyła, byłoby nieprawdą w
artefakcie. Odblokowanie: dowieźć redesign, potem `/10x-test-plan`.

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|-------|---------|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

## 4. Stack

Klasyczna baza testów projektu. Narzędzia AI-native (jeśli są) noszą datę
`checked:`, żeby przyszły czytelnik widział, które linie wymagają ponownej
weryfikacji.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | Vitest | ^4.1.10 | skonfigurowany; dziś 6 plików unit (`src/lib/schemas/*`, `room-geometry`, `staff-identity`) |
| integration DB | Supabase CLI (local Postgres/Auth) | ^2.23.4 | `npx supabase start` (wymaga Dockera) — realny RLS dla łańcucha żądań; brak jeszcze harnessu route’ów |
| API/route harness | none yet — see §3 Phase 1 | — | integration route’ów API pod SSR (Astro) do postawienia w Fazie 1 |
| API mocking | none yet — see §3 Phase 1 | — | mock tylko na krawędzi sieci (Storage/service-role); nigdy modułów wewnętrznych |
| e2e | none yet — see §3 Phase 4 (opcjonalnie) | — | promować tylko dla ścieżek, których nie łapie integration |
| accessibility | none yet | — | poza zakresem MVP (patrz §7) |
| (optional) AI-native | multimodal visual review — checked: 2026-08-04 | n/a | **When NOT to use:** każdy ekran, ekrany bez zmiany wizualnej, cokolwiek co łapie deterministyczny diff lub test integration |

Jeśli wiersz brzmi „none yet — see §3 Phase N", tę lukę domyka wskazana faza.

**Stack grounding tools (current session):**
- Docs: Context7 ✓ — dostępny do bieżących API test-setupu (Astro SSR, Supabase, Vitest 4); checked: 2026-08-04
- Search: Exa.ai ✓ — dostępny do sprawdzania aktualnego statusu narzędzi (np. wsparcie Astro w test-runnerach); checked: 2026-08-04
- Runtime/browser: Claude Browser (preview) ✓ — możliwe źródło warstwy weryfikacji wizualnej (Faza 4); nie użyty jako główna warstwa; checked: 2026-08-04
- Provider/platform: Cloudflare / Linear — **wymagają autoryzacji, niedostępne w tej sesji**; Supabase bez MCP (lokalne CLI); GitHub przez `gh` CLI; checked: 2026-08-04

## 5. Quality Gates

Pełen zestaw bramek, które muszą przejść, zanim zmiana trafi na produkcję.
„Required after §3 Phase N" oznacza, że bramka jest egzekwowana po wylądowaniu
tej fazy; wcześniej jest `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint + typecheck | local + CI | required — wired (`.github/workflows/ci.yml`, job `fast`) | dryf składni / typów |
| unit + integration | local + CI | required — wired (ci.yml: `fast` unit + `db` integration, Phase 3) | regresje logiki i łańcucha żądań |
| RLS isolation (SQL) | CI | required — wired (ci.yml job `db`, Phase 3) | rozjazd polityk RLS / wyciek między najemcami |
| post-edit hook | local (agent loop) | recommended after §3 Phase 3 | regresje w momencie edycji |
| multimodal visual review | CI on PR | optional after §3 Phase 4 | problemy wizualne, których nie łapie diff — 1–3 ekrany |
| pre-prod smoke | między merge a prod | optional | błędy specyficzne dla środowiska (Cloudflare Workers) |

## 6. Cookbook Patterns

Jak dodawać nowe testy w tym projekcie. Każda podsekcja wypełnia się, gdy
wyląduje odpowiednia faza rolloutu; wcześniej brzmi „TBD — see §3 Phase N".

### 6.1 Adding a unit test

- **Location**: obok jednostki, w `src/lib/**` jako `<name>.test.ts`.
- **Naming**: `<module>.test.ts` (konwencja obecna: `schemas/menu.test.ts`, `room-geometry.test.ts`).
- **Reference test**: `src/lib/schemas/menu.test.ts`.
- **Run locally**: `npm run test` (Vitest).

### 6.2 Adding an integration test

- **Location**: `tests/integration/**` (poza glob unitów `src/**/*.test.ts`, więc `npm run test` zostaje bez bazy).
- **Naming**: `<obszar>/<co>.test.ts` (np. `authz/write-routes.test.ts`, `isolation/cross-tenant-read.test.ts`).
- **Reference test**: `tests/integration/authz/write-routes.test.ts`.
- **Fixtures**: `seedTwoCompanies()` z `tests/integration/helpers/fixtures.ts` daje 2 firmy × owner/waiter/kitchen + anon + `resources` (kategoria/pozycja/sala/stolik/obiekt). Sprzątaj w `afterAll` przez `seed.cleanup()`.
- **Mockowanie**: tylko krawędź zewnętrzna. Wzorzec dla Storage: `vi.mock("@/lib/storage")` ze szpiegami na `mintPhotoUploadUrls`/`removePhotoObjects` (referencja: `tests/integration/isolation/photo-idor.test.ts`). Nigdy nie mockuj guardów ani modułów wewnętrznych — to one są przedmiotem testu.
- **Run locally**: `npm run test:integration` (wymaga `npx supabase start` + skopiowanego `.env.test`).

### 6.3 Adding an e2e test

- TBD — see §3 Phase 4 (promować tylko gdy integration nie wystarcza).

### 6.4 Adding a test for a new API endpoint

- **Autoryzacja (Ryzyko #3)**: dodaj wiersz do `WRITE_ROUTES` (lub `READ_ROUTES`) w `tests/integration/authz/route-matrix.ts`. Parametryczna macierz automatycznie sprawdza anon→401, kelner/kuchnia→403, owner dopuszczony. `registry-completeness.test.ts` wymusza obecność wiersza (nowa trasa bez wpisu = czerwone).
- **Izolacja (Ryzyko #1)**: jeśli endpoint dotyka nowej encji, dodaj test w `tests/integration/isolation/` — odczyt: zbiór odpowiedzi nie zawiera id firmy B; zapis: firma A celuje w zasób B → 404 **plus weryfikacja w DB** klientem `service-role`, że wiersz B się nie zmienił.
- **Własność / IDOR (Ryzyko #4)**: jeśli endpoint przyjmuje id zasobu od klienta (wskaźnik `category_id`/`room_id`, `[id]` zdjęcia), dodaj przypadek „firma A celuje w zasób firmy B" → oczekiwane 400 (wskaźnik) lub 404 (własny `[id]` innego tenanta), plus dowód braku efektu w DB. Referencje: `isolation/cross-entity-pointer.test.ts`, `isolation/photo-idor.test.ts`. Ścieżkę do Storage **buduje serwer** z `company_id` — asertuj argument mocka, nie sam status.
- **Walidacja (Ryzyko #5)**: dodaj wiersz do rejestru w `tests/integration/validation/input-parity.test.ts` — jeden reprezentatywny zły input → 400. Pola per-constraint pokrywają unity schem (`src/lib/schemas/*.test.ts`), więc ich nie powielaj. `badBody` jest funkcją seeda, bo `parseBody` zwraca **tylko pierwszy** błąd zod — pozostałe pola muszą być poprawne, inaczej 400 przyjdzie z innego constraintu. W `params` używaj **realnych, posiadanych id**, bo zły uuid daje 400 ze sprawdzenia ścieżki i test przechodzi z niewłaściwego powodu.
- **Uwaga: klamp ≠ odrzucenie.** Pozycja/transform stolika i obiektu **klampują** współrzędne w kanwie (→200), a odrzucają dopiero poza `[0,1200]×[0,800]`. Schematy nie są `.strict()`, więc nieznane klucze są ucinane (→200), nie odrzucane. Te celowe nie-400 pilnuje `validation/clamp-and-partial.test.ts`.
- **Jak wywoływać**: `buildContext(principal, { method, params, body })` (`tests/integration/helpers/context.ts`) buduje syntetyczny `APIContext` — ćwiczy prawdziwy guard + RLS bez serwera HTTP (middleware NIE jest na ścieżce `/api/*`). Mockuj tylko krawędź service-role/Storage, nigdy modułów wewnętrznych.

### 6.5 Adding an RLS isolation assertion

- **Gdzie**: rozszerz `supabase/tests/rls_isolation.sql` (plain SQL, transakcja `begin;…rollback;`, brak pgTAP). Dosiej encję dla obu firm w sekcji fixtures.
- **Jak**: symuluj tożsamość przez `set local role authenticated` + `set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'`, potem `reset role`. Dla ścieżki publicznej: `set local role anon`. Asertuj przez `raise exception` (porażka aborcuje transakcję → `supabase db query` kończy się kodem ≠ 0). Skaluj liczby do UUID-ów fixture’ów, nie do wartości absolutnych (baza może mieć realne wiersze).
- **Run**: `npm run test:rls:local` (lokalne Supabase) lub `npm run test:rls` (hostowane `--linked`).
- **Ryzyko #2 — ZAMKNIĘTE** (2026-08-13, migracja `20260813010000_drop_unscoped_anon_read_policies.sql`): blok `KNOWN GAP (Risk #2)` jest teraz Asercją 5c. Uwaga na **interlock**, który przy tym wyszedł: Asercja 5 asertowała wcześniej, że anon *widzi* 2/2/3/2 wiersze — czyli sam przeciek jako oczekiwanie. Flip bloku bez jednoczesnego przebazowania tamtych liczb czyni suite wewnętrznie sprzecznym. **Domykając lukę, szukaj asercji, które utrwaliły stan sprzed naprawy, i edytuj je jako jedną całość.**
- **Wzorzec zamknięcia luki (Ryzyko #4)**: `menu_items.category_id` był drugim takim `notice` — luka została domknięta migracją `20260812220000_menu_item_category_composite_fk.sql`, a blok zamieniony w twardą asercję („Assertion 5b"). Domykając kolejną lukę: dodaj składowy FK, przełącz `notice`→`exception` i **udowodnij, że asercja nie jest tautologiczna** (usuń ograniczenie → suite ma sczerwienieć). Asertuj też to, co łatwo zepsuć przy okazji: przy nullowalnym wskaźniku zostaw legalny `NULL` i zachowaj `on delete set null` (forma z listą kolumn, gdy druga kolumna jest `NOT NULL`).

### 6.6 Per-rollout-phase notes

(Opcjonalne. Po wylądowaniu fazy `/10x-implement` dopisuje tu 2–3 linie o tym,
co faza nauczyła — np. gdzie mieszkają fixture’y firm/ról.)

**Faza 1–3 (harness + izolacja).** Fixture’y i helpery żyją w `tests/integration/helpers/`:
`fixtures.ts` (2 firmy × owner/waiter/kitchen + anon + `resources`), `clients.ts`
(anon / per-rola / service-role, budowane z `process.env`), `context.ts` (syntetyczny `APIContext`).
- **Pułapka `locals.role` vs JWT**: guard czyta `context.locals.role`, a RLS czyta JWT z
  `context.locals.supabase`. Oba muszą pochodzić z tego samego zasianego usera, inaczej test
  przechodzi guard, a RLS widzi inny tenant → fałszywa zieleń.
- **`astro:env/server` stub** (`tests/integration/stubs/`, alias w `vitest.integration.config.ts`)
  pozwala importować route’y, które sięgają po sekrety (np. `staff` przez `staff-admin.ts`) pod Vitest.
- **Znane luki** z fazy izolacji: `context/changes/testing-tenant-isolation-integration/KNOWN-GAPS.md`.

**Faza 2 rolloutu (#4/#5/#6 — własność i wejście).** Testy tras w `tests/integration/{isolation,validation}/`.
- **Mock tylko krawędzi Storage** (`vi.mock("@/lib/storage")`). Nie osłabia dowodu IDOR, bo bramka
  własności działa **przed** wywołaniem service-role — dlatego asercje brzmią „mock NIE wołany na
  403/404" i „wołany raz ze ścieżką `{companyId}/{itemId}`". Prefiks RLS jest już dowiedziony w SQL.
- **Status zależy od warstwy, która łapie.** To samo „zrób mnie właścicielem" daje 400 (enum schematu),
  403 (self-guard trasy) albo 42501 (surowy SQL). Asertuj faktyczny status danego przypadku, nie ogólne
  „odmowa" — i zawsze dokładaj dowód efektu w DB.
- **Trigger `42501→403` jest nieosiągalny przez trasę** (schemat i self-guard łapią wcześniej) — zostaje
  dowiedziony w SQL, nie forsujemy go na warstwie HTTP.

**Middleware stron (2026-08-25, `middleware-route-protection`).** Połowa „trasy stron" Ryzyka #3 była
zamknięta na papierze bez testu — Faza 1 odłożyła ją „do e2e" na fałszywej przesłance technicznej
(wystarczył jeden alias Vite; wzorzec identyczny jak lekcja anon-RLS: sprawdź przesłankę, zanim uznasz
za zablokowane). Wzorzec testowania: §6.7. Pułapka: globalny `signOut()` middleware'u unieważnia
w GoTrue **wszystkie** sesje usera — testy używają świeżego `signInWithPassword` per test, nigdy
recyklingu sesji z seeda.

### 6.7 Adding a middleware page-gating test

- **Gdzie**: `tests/integration/authz/middleware.test.ts`; helper `tests/integration/helpers/middleware.ts`
  (`runMiddleware` = `createContext` z `astro/middleware` + bezpośrednie wywołanie `onRequest` — bez
  serwera HTTP; `sessionCookieFor`/`sessionCookieFromClient` serializują sesję do cookie
  `sb-<pierwszy człon hosta>-auth-token` jako `"base64-" + base64url(JSON(session))`).
- **Nowa trasa strony**: dopisz ją do `PROTECTED_ROUTES`/`OWNER_ROUTES` w `src/middleware.ts` (trasa
  owner-only MUSI być w obu — tylko w drugiej wysłałaby anonima na `/dashboard` zamiast na signin)
  **oraz** do tablic `PROTECTED_PAGES`/`OWNER_PAGES` w macierzy testowej. Macierz asertuje dokładny
  `Location`, więc łapie też złamanie niezmiennika `OWNER ⊆ PROTECTED`.
- **Pułapki**: (1) świeże logowanie per test — `signOut()` middleware'u unieważnia wszystkie sesje
  usera w GoTrue; (2) nie asertuj brzmienia polskiego komunikatu (istnieje tylko w implementacji) —
  asertuj obecność parametru `error` w `Location`; (3) `Response` z bezpośredniego `onRequest` nie
  niesie `Set-Cookie` — czyszczenie sesji asertuj przez `ctx.cookies` (pole `cookies` w wyniku
  `runMiddleware`); (4) wariant `supabase === null` wymaga `vi.resetModules()` + `vi.stubEnv` +
  dynamicznego importu, bo stub `astro:env/server` czyta `process.env` w momencie importu modułu.
- **Run**: `npm run test:integration` (wymaga `npx supabase start` + `.env.test`).

## 7. What We Deliberately Don't Test

Wykluczenia uzgodnione podczas rolloutu (wywiad Phase 2, Q5). Przyszli
kontrybutorzy respektują je, dopóki założenie się nie zmieni.

- **Edytor sali per-piksel** — logika geometrii pokryta unit (`src/lib/room-geometry.test.ts`); pozycjonowanie/render to ręczny rzut oka. Re-evaluate, jeśli edytor zacznie wyliczać kolizje lub snapping serwerowo. (Source: Phase 2 interview Q5.)
- **Snapshoty pikselowe UI i wygenerowane typy / trywialne mapowania** — pękają bez sensu albo generator jest testem. Re-evaluate, jeśli mapowanie zacznie nieść logikę. (Source: Phase 2 interview Q5.)
- **Pętla zamówienia, brama dostępności i trwałość QR** — kod nie istnieje (S-05/S-07/S-08). Dopisać przez `--refresh`, gdy te slice’y wylądują. (Source: Challenger pass — odrzucone jako spekulatywne.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-04
- Stack versions last verified: 2026-08-04
- AI-native tool references last verified: 2026-08-04

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
