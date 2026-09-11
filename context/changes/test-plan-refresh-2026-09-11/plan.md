# Test-plan refresh po S-05 (menu-availability-toggle) — Implementation Plan

## Overview

Mechaniczna rekoncyliacja `context/foundation/test-plan.md` (last updated 2026-08-04) ze stanem
repo po wylądowaniu S-05 i skreśleniu Fazy 4 (2026-09-06). Edytujemy wyłącznie §4–§8; **§1–§3
zostają bajt-w-bajt bez zmian** (poza nagłówkiem „Last updated") — decyzja właściciela: wywiad
pominięty, żadnych nowych decyzji strategicznych. Wszystkie fakty pochodzą z
`research.md` tej zmiany (kotwice file:line zweryfikowane na HEAD `4d679a1`).

## Current State Analysis

Z `research.md` (pełna mapa tam; tu delta):

- **§7** twierdzi „brama dostępności … kod nie istnieje (S-05/S-07/S-08)" — fałsz w 1/3: S-05
  dowiózł PATCH availability, politykę kelnera, trigger kolumnowy i polling. Pętla zamówienia
  i trwałość QR (S-07/S-08) nadal nie istnieją.
- **§6** nie zna pięciu wzorców S-05: `waiterAllowed` w macierzy authz, asercje RLS 27/29/28
  (+ przebazowana 4), wąski PATCH wg szablonu `activation`, polling `useMenu` z ręczną
  weryfikacją dwusesyjną, pin happy-path na warstwie route.
- **§6.3** to „TBD — see §3 Phase 4", a Faza 4 jest skreślona; tymczasem e2e istnieje:
  `playwright.config.ts` + `tests/e2e/` (auth.setup z dwoma ownerami + 3 specy), lokalne-only,
  brak jobu w CI.
- **§4** ma trzy martwe wiersze „none yet — see §3 Phase N" (harness, mocking, e2e), wiersz
  AI-native wskazujący skreśloną fazę i stare stemple `checked: 2026-08-04`.
- **§5** nie ma wiersza e2e.
- **§8** — wszystkie daty 2026-08-04.
- **lessons.md:55-65** — lekcja „middleware/guardy zawsze z test:integration w kryteriach fazy;
  exit code, nie pipe do tail" (źródło: S-05 F2) nie jest odzwierciedlona w §6.7.

## Desired End State

`test-plan.md` zgodny ze stanem repo: §6 uczy wzorców S-05 z realnymi referencjami, §6.3 opisuje
istniejący harness Playwright, §4/§5 odzwierciedlają narzędzia i bramki które istnieją (i
uczciwie mówią, co jest lokalne-only), §7 wyklucza tylko to, co naprawdę nie istnieje lub jest
świadomie ręczne, §8 nosi świeże daty z zastrzeżeniem, że §1–§2 nie były przeglądane.

Weryfikacja: brak łańcuchów „none yet — see §3 Phase", diff nie dotyka §1–§3 (poza nagłówkiem),
prettier czysty, każda nowa referencja plikowa istnieje w repo.

### Key Discoveries (z research.md):

- `tests/integration/authz/route-matrix.ts:40,84-91` — flaga `waiterAllowed`, jedyny wiersz z nią
- `supabase/tests/rls_isolation.sql:1021-1110` — asercje w kolejności pliku 27 → 29 → 28; `:169-212` przebazowana asercja 4
- `supabase/migrations/20260910080000_…waiter_write.sql:36-53` — trigger `guard_menu_item_staff_columns` (P0001)
- `src/pages/api/menu/items/[id]/availability.ts` + `src/lib/api.ts:41-43` — wąski PATCH + tryb guarda `"availability"`
- `src/components/hooks/useMenu.ts:101-128` — pętla 4 s, pauzy per-tick; weryfikacja dwusesyjna była RĘCZNA (archiwum plan.md:316,407)
- `tests/integration/menu/availability-toggle.test.ts` — pin happy-path (F5); nowe katalogi `contract/`, `menu/`
- `tests/e2e/` + `playwright.config.ts` — 3 specy, setup 2 ownerów, zero dopasowań `playwright|e2e` w `.github/`

## What We're NOT Doing

- **Żadnych zmian w §1 (Strategy), §2 (Risk Map) i §3 (Phased Rollout)** — pełny przegląd ryzyk
  wymaga wywiadu; świeże liczby hot-spotów (unia 23, nie 33) zostają w research.md dla
  przyszłego pełnego refreshu.
- **Nie wznawiamy Fazy 4** ani nie dodajemy fazy e2e do §3.
- **Nie wpinamy e2e/Stryker do CI** — §5 tylko zapisuje stan faktyczny; zmiana CI to osobny change.
- **Nie dodajemy nowych testów ani kodu** — zmiana dotyka wyłącznie `context/foundation/test-plan.md`.
- **Nie decydujemy o automatyzacji weryfikacji dwusesyjnej** — zapisujemy ją w §7 jako świadome
  wykluczenie z warunkiem ponownej oceny (S-07 ordering); promocja do e2e to przyszła decyzja.
- Nie edytujemy `lessons.md` (lekcja już zapisana) ani archiwum S-05.

## Implementation Approach

Jedna edytowana ściana tekstu, dwie fazy dla czytelnego review: najpierw substancja (§6 cookbook
+ §7 negative space), potem księgowość (§4 stack, §5 gates, §6.3, §8 ledger, nagłówek). Każdy
dopisany wiersz cytuje realny plik z repo (kotwice z research.md) — zero twierdzeń bez dowodu.
Konwencja językowa i ton sekcji bez zmian (polski, zwięzłe bullety, referencje ścieżkowe).

## Critical Implementation Details

- **Granica §3/§4 jest twarda**: akapit o skreśleniu Fazy 4 (`test-plan.md:87-95`) zostaje
  nietknięty — §4 wiersz AI-native ma do niego tylko odsyłać, nie powielać uzasadnienia.
- **Semantyka „Strategy last reviewed"**: §8 dostaje datę refreshu z jawnym dopiskiem, że
  przegląd objął §4–§8, a §1–§2 czekają na pełny refresh z wywiadem — inaczej data skłamie,
  że risk map jest świeża.
- **Wiersz accessibility w §4 zostaje** („none yet … poza zakresem MVP") — kryterium
  automatyczne sprawdza brak wzorca „none yet — see §3 Phase", nie brak „none yet" w ogóle.

## Phase 1: §6 cookbook + §7 negative space (substancja)

### Overview

Dopisanie pięciu wzorców S-05 do cookbooka, lekcji F2 do §6.7 i rozszczepienie nieaktualnego
bulletu §7.

### Changes Required:

#### 1. §6.4 — pierwszy staff-write i wąski PATCH

**File**: `context/foundation/test-plan.md`

**Intent**: Rozszerzyć przepis „nowy endpoint API" o dwa przypadki, których §6.4 nie zna:
trasę write dopuszczającą rolę staff oraz szablon jednopolowego PATCH.

**Contract**: Dwa nowe bullety w §6.4: (a) staff-write — flaga `waiterAllowed` na wierszu
macierzy (`route-matrix.ts:40`; default brak = owner-only, kuchnia **zawsze** 403, gałąź testu
`write-routes.test.ts:37-50`), z regułą „dopisuj do istniejących rejestrów parity i
cross-tenant, jedź cross-tenant jako dopuszczona rola staff, żeby ćwiczyć predykat `company_id`
nowej polityki" (`cross-tenant-write.test.ts:79-101`) oraz „pin happy-path 200+payload+re-read
service-role na warstwie route, bo macierz dowodzi tylko wpuszczenia za guard"
(`tests/integration/menu/availability-toggle.test.ts` — promocja ręcznego spot-checku do
trwałego testu, F5); (b) wąski PATCH — szablon `activation`/`availability` (guard → `z.uuid()`
→ `parseBody` ze schematem `.pick()` z bazowego inputu, żeby enum nie dryfował → update jednej
kolumny → 404 na pusty wynik).

#### 2. §6.5 — asercje na trigger kolumnowy i semantyka odmowy

**File**: `context/foundation/test-plan.md`

**Intent**: Zapisać wzorzec RLS-owy, który S-05 ustanowił: polityka wierszowa + trigger
kolumnowy testują się inaczej i mają różne sygnatury odmowy.

**Contract**: Nowe bullety w §6.5: (a) niezmiennik kolumnowy żyje w triggerze, nie w RLS
(`to_jsonb(old) - '<kolumna>'`, P0001; wzorzec `guard_menu_item_staff_columns`, migracja
`20260910080000`), asertuj cztery własności jak asercja 27 (`rls_isolation.sql:1021-1062`):
flip ląduje / przemyt kolumny → P0001 i odrzucenie w całości / cross-tenant 0 wierszy /
archived 0 wierszy; (b) **semantyka odmowy jest kontraktem**: brak polityki = 0 wierszy
(asercja 28), trigger = P0001, a nowa polityka dopasowująca rolę wymusza przebazowanie starych
oczekiwań 0-wierszy (asercja 4, `rls_isolation.sql:169-212`) — przypadek szczególny interlocku
z bulletu o Ryzyku #2; (c) pin ścieżek pośrednich: RPC piszący zablokowaną kolumnę wywołany
jako rola staff musi abortować P0001 (asercja 29, reorder-RPC-jako-kelner,
`rls_isolation.sql:1064-1090`) — pułapka: zamieniaj wiersze, które **na pewno** się zmienią,
bo no-op nigdy nie dociera do triggera; (d) reguła F3: każdy filtr wierszy w route wyrażający
politykę (np. `archived_at is null`) musi mieć lustro w polityce RLS i asercję w SQL
(migracja `20260911090000`).

#### 3. Nowa §6.8 — powierzchnia pollingu i jej weryfikacja

**File**: `context/foundation/test-plan.md`

**Intent**: Udokumentować pierwszy polling projektu (useMenu) i to, jak się go weryfikuje —
łącznie z faktem, że propagacja międzysesyjna jest sprawdzana ręcznie.

**Contract**: Nowa podsekcja `### 6.8 Verifying a polling surface`: kształt hooka
(`useMenu.ts:101-128` — `pollMs`/`pollPaused`, pauzy per-tick: `inFlight`, `pollPaused`,
`document.hidden`; ciche ticki — tylko initial load ustawia `loadError`), konsument spina
`pollPaused` z dialogami i **licznikiem** `busyMutations` (nie pojedynczym id — F1,
`MenuManager.tsx:55-56,169-183`), oraz procedura ręcznej weryfikacji dwusesyjnej z archiwum
S-05 (dwie sesje kelner+owner, zmiana widoczna ≤5 s; ukryta karta = zero żądań w network tab;
błąd ticka bez bannera). Jawna notka: brak testów hooka i brak automatycznej weryfikacji
międzysesyjnej — świadome wykluczenie, patrz §7; zaakceptowane ryzyko F6 (otwarty Select vs
tick) z referencją do archiwum.

#### 4. §6.6 — nota per-fazowa S-05 + §6.7 — lekcja F2

**File**: `context/foundation/test-plan.md`

**Intent**: Krótka nota historyczna S-05 w §6.6 (konwencja sekcji: 2–3 linie) i twarda reguła
z lessons.md w pułapkach §6.7.

**Contract**: §6.6 — akapit „S-05 (availability, pierwszy staff-write)": trzy warstwy
egzekwowania (middleware / guard rodziny / RLS+trigger) poruszają się razem i każda ma swój
poziom testu; suite integration ma nowe katalogi `contract/` (pin `prerender=false`) i `menu/`;
tryb guarda `write: "availability"` w `src/lib/api.ts:41-43`. §6.7 — nowa pułapka (5): faza
dotykająca middleware/guardów/route-gatingu MUSI mieć `npm run test:integration` w kryteriach
automatycznych, a wynik czyta się z exit code, nigdy przez pipe do tail/grep (S-05 F2: e534101
wyjął `/menu` z `OWNER_ROUTES`, e2e zaktualizowane w tym samym commicie zostało zielone, a
kontrakt macierzy middleware pękł po cichu; fix 5be3d00; lessons.md:55-65).

#### 5. §7 — rozszczepienie bulletu i nowe świadome wykluczenie

**File**: `context/foundation/test-plan.md`

**Intent**: §7 ma wykluczać tylko to, co naprawdę nie istnieje; część S-05 zastąpić wpisem o
ręcznej weryfikacji pollingu.

**Contract**: Bullet „Pętla zamówienia, brama dostępności i trwałość QR…" rozszczepiony:
(a) „Pętla zamówienia i trwałość QR — kod nie istnieje (S-07/S-08)…" (reszta zdania bez zmian);
(b) nowy bullet: „Propagacja międzysesyjna pollingu availability — weryfikowana ręcznie
(procedura w §6.8); automatycznego testu dwusesyjnego celowo brak (kryterium fazy 4 S-05 +
zaakceptowane F6). Re-evaluate, gdy wyląduje pętla zamówienia (S-07) i nieświeży stan zacznie
kosztować zamówienia. (Source: archiwum S-05, plan.md:314-319 + impl-review F6.)". Brama
dostępności znika z §7 — jej pokrycie opisują §6.4/§6.5/§6.8.

### Success Criteria:

#### Automated Verification:

- `grep -n "brama dostępności" context/foundation/test-plan.md` — zero trafień w §7 (fraza
  zostaje tylko, jeśli w kontekście „pokryta")
- `grep -n "6.8" context/foundation/test-plan.md` — sekcja istnieje
- Każda nowa referencja plikowa istnieje: `route-matrix.ts`, `write-routes.test.ts`,
  `availability-toggle.test.ts`, `cross-tenant-write.test.ts`, migracje `20260910080000*` i
  `20260911090000*`, `useMenu.ts`, `MenuManager.tsx` (skrypt/ręczny `ls` wg listy)
- `git diff` dotyka wyłącznie `context/foundation/test-plan.md` (+ folder change'a)

#### Manual Verification:

- Read-through §6–§7: nowe bullety trzymają ton i długość sąsiadów; żaden nie powiela treści
  research.md ponad to, co potrzebne przyszłemu autorowi testu
- §1–§3 wizualnie nietknięte w diffie

**Implementation Note**: Po fazie 1 pauza na potwierdzenie ręcznego read-through przed fazą 2.

---

## Phase 2: §4 stack, §5 gates, §6.3 e2e, §8 ledger (księgowość)

### Overview

Wymiana martwych wierszy stacku, zapis stanu e2e, realny cookbook §6.3 i świeże stemple dat.

### Changes Required:

#### 1. §4 — tabela stacku

**File**: `context/foundation/test-plan.md`

**Intent**: Wiersze mają opisywać narzędzia, które istnieją, z aktualnymi wersjami i stemplami.

**Contract**: (a) „API/route harness: none yet — see §3 Phase 1" → dowiezione w Fazie 1:
syntetyczny `APIContext` przez `buildContext` (`tests/integration/helpers/context.ts`);
(b) „API mocking: none yet…" → dowiezione: mock wyłącznie krawędzi Storage
(`vi.mock("@/lib/storage")`, patrz §6.2); (c) „e2e: none yet — see §3 Phase 4" → Playwright
`^1.62.1` (resolved 1.62.1), `tests/e2e/`: setup 2 ownerów + 3 specy, **lokalne-only — brak
jobu CI**; filozofia „promować tylko czego integration nie łapie" zostaje w Notes;
(d) wiersz AI-native: adnotacja „wycofane — Faza 4 skreślona 2026-09-06 (patrz §3), harness
zrevertowany (`aacc534`)", wiersz zostaje dla historii; (e) wiersz integration DB: dopisek
„resolved 2.98.2 przez package-lock (`npx`), CI celowo używa pinu z lockfile"; (f) wiersz unit:
aktualizacja „dziś 6 plików unit (~180 case'ów)"; (g) stemple `checked:` bloku „Stack grounding
tools" → 2026-09-12 po ponownym sprawdzeniu dostępności w tej sesji (Cloudflare/Linear nadal
wymagają autoryzacji — zostaje); (h) zdanie pod tabelą „Jeśli wiersz brzmi «none yet — see §3
Phase N»…" — skorygować, bo po (a)–(c) dotyczy już tylko accessibility.

#### 2. §5 — bramka e2e (stan faktyczny)

**File**: `context/foundation/test-plan.md`

**Intent**: §5 ma mówić prawdę o tym, co jest egzekwowane; e2e istnieje, ale nic go nie wymusza.

**Contract**: Nowy wiersz tabeli: „e2e (Playwright) | local | optional — istnieje
(`npm run test:e2e`), **bez jobu w CI**; wpięcie do CI = osobna zmiana | regresje przepływów
przeglądarkowych (auth, redirecty, izolacja między kontekstami)". Wiersz „multimodal visual
review … after §3 Phase 4" → adnotacja „wycofane (Faza 4 skreślona 2026-09-06)".

#### 3. §6.3 — realny cookbook e2e

**File**: `context/foundation/test-plan.md`

**Intent**: Zastąpić „TBD — see §3 Phase 4" przepisem opartym na istniejącym harnessie.

**Contract**: Bullety w konwencji §6.1/§6.2: Location `tests/e2e/*.spec.ts`
(`testDir` w `playwright.config.ts:15`); Reference test `tests/e2e/seed.spec.ts`; Fixtures —
`auth.setup.ts` loguje przez realne UI i zapisuje `playwright/.auth/owner.json` +
`owner-b.json` (dwóch ownerów; drugi kontekst przez `browser.newContext({storageState})`,
wzorzec `tenant-isolation.spec.ts:27`); Env — `.env.e2e` z `.env.e2e.example`, opcjonalny
provisioning `E2E_PROVISION=1`; Run — `npm run test:e2e` (webServer wstaje sam,
`reuseExistingServer` lokalnie); Kiedy promować — tylko ścieżki niełapalne niżej (middleware
redirecty w realnej przeglądarce, wielokontekstowość), zgodnie z §4 Notes; hard rules
CLAUDE.md (gettery ról/labeli, zakaz `waitForTimeout`, niezależność testów) obowiązują.

#### 4. §8 — ledger + nagłówek

**File**: `context/foundation/test-plan.md`

**Intent**: Świeże daty bez kłamstwa o zakresie przeglądu.

**Contract**: „Strategy (§1–§5) last reviewed: 2026-09-12 — przegląd mechaniczny §4–§8 po
S-05 (change `test-plan-refresh-2026-09-11`); **§1–§2 nieprzeglądane** (wywiad pominięty
decyzją właściciela) — świeże hot-spoty w research.md tej zmiany"; „Stack versions last
verified: 2026-09-12"; „AI-native tool references last verified: 2026-09-12 (visual review
wycofane)". Nagłówek pliku: „Last updated: 2026-09-12".

### Success Criteria:

#### Automated Verification:

- `grep -c "none yet — see §3 Phase" context/foundation/test-plan.md` → 0
- `grep -n "2026-08-04" context/foundation/test-plan.md` → zero trafień poza ewentualnym
  kontekstem historycznym w §3 (którego nie dotykamy)
- `npx prettier --check context/foundation/test-plan.md` przechodzi
- `git diff --stat` — nadal tylko `test-plan.md` + folder change'a

#### Manual Verification:

- Diff §1–§3: zero zmian (nagłówek pliku jest nad §1 — dozwolony)
- Tabele §4/§5 renderują się poprawnie (podgląd markdown)
- Read-through całości: plan spójny, żadna sekcja nie odsyła do skreślonej Fazy 4 jako żywej

**Implementation Note**: Po fazie 2 read-through całego pliku przed zamknięciem zmiany.

---

## Testing Strategy

Zmiana docs-only — brak testów kodu. Weryfikacja = grep-asercje + prettier + dyscyplina diffu
(patrz kryteria faz). Żadna komenda `npm run test*` nie musi biec (kod nietknięty), ale
`git status` musi pozostać czysty poza dwoma ścieżkami.

### Manual Testing Steps:

1. `git diff context/foundation/test-plan.md` — przejrzeć hunki: §1–§3 nieobecne w diffie.
2. Podgląd markdown tabel §4/§5 (render bez rozjechanych kolumn).
3. Spot-check trzech losowych nowych referencji file:line w repo.

## Performance Considerations

N/d (dokument).

## Migration Notes

N/d. Rollback = `git checkout -- context/foundation/test-plan.md`.

## References

- Research: `context/changes/test-plan-refresh-2026-09-11/research.md` (wszystkie kotwice)
- Archiwum S-05: `context/archive/2026-09-07-menu-availability-toggle/` (plan.md, reviews/impl-review.md)
- Lekcja F2: `context/foundation/lessons.md:55-65`
- Cel edycji: `context/foundation/test-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: §6 cookbook + §7 negative space (substancja)

#### Automated

- [x] 1.1 Grep: „brama dostępności" nieobecna w §7 (lub tylko jako „pokryta") — 1079852
- [x] 1.2 Grep: sekcja 6.8 istnieje — 1079852
- [x] 1.3 Wszystkie nowe referencje plikowe istnieją w repo (ls wg listy z fazy) — 1079852
- [x] 1.4 `git diff` dotyka tylko test-plan.md + folder change'a — 1079852

#### Manual

- [x] 1.5 Read-through §6–§7: ton i długość spójne z sąsiadami — 1079852
- [x] 1.6 §1–§3 wizualnie nietknięte w diffie — 1079852

### Phase 2: §4 stack, §5 gates, §6.3 e2e, §8 ledger (księgowość)

#### Automated

- [x] 2.1 Grep: zero „none yet — see §3 Phase"
- [x] 2.2 Grep: zero „2026-08-04" poza nietykanym §3
- [x] 2.3 `npx prettier --check context/foundation/test-plan.md`
- [x] 2.4 `git diff --stat` — nadal tylko test-plan.md + folder change'a

#### Manual

- [x] 2.5 Diff §1–§3 pusty (nagłówek pliku dozwolony)
- [x] 2.6 Tabele §4/§5 renderują się poprawnie
- [x] 2.7 Read-through całości: brak odesłań do Fazy 4 jako żywej
