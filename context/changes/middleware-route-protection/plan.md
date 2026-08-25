# Middleware Route Protection (Risk #3, middleware half) — Implementation Plan

## Overview

Domykamy nieprzetestowaną połowę test-planowego Ryzyka #3: bramkowanie tras *stron* w `src/middleware.ts` (redirect anonimowego, odbicie nie-właściciela, signOut zdezaktywowanego, semantyka prefiksów). Suite testów integracyjnych wywołuje `onRequest` bezpośrednio (bez serwera HTTP, bez e2e), a po drodze naprawiamy dwa rozjazdy oracle ↔ implementacja odkryte w researchu, tak żeby testy kończyły zielone.

## Current State Analysis

- `src/middleware.ts:20-82` — jedyny strażnik tras stron: `PROTECTED_ROUTES` (`:5`), `OWNER_ROUTES` (`:11`), `matchesRoute` (`:16-18`), redirect anon (`:56-59`), signOut zdezaktywowanego/orphana **tylko wewnątrz gałęzi tras chronionych** (`:66-72`), odbicie nie-ownera (`:75-79`).
- Zero testów middleware: harness API (`tests/integration/helpers/context.ts:3-9`) celowo go omija; grep `onRequest` po `tests/` — pusty.
- **Rozjazd #1**: źródła (FR-002 `context/foundation/prd.md:131`, `staff-accounts-roles/plan-brief.md:29-30`, archiwum S-01 `plan.md:167,195`) wymagają owner-only `/settings`; `OWNER_ROUTES` go nie zawiera — broni tylko warunkowy render `settings.astro:11`.
- **Rozjazd #2** (PENDING z `staff-login-identifiers/reviews/impl-review.md:91`): `/` nie jest chronione, a `src/pages/api/auth/signin.ts:39` przekierowuje po logowaniu na `/` — zdezaktywowany pracownik loguje się skutecznie i siedzi na `/`; strażnik signOut nigdy nie odpala.
- Faza 1 rolloutu odłożyła middleware „do e2e" na fałszywej przesłance — `astro:middleware` rozwiązuje jeden alias Vite, a `astro/middleware` publicznie eksportuje `createContext` budujące realny `APIContext` (zweryfikowane runtime'owo, patrz research §C).

## Desired End State

- `tests/integration/authz/middleware.test.ts` przechodzi na `npm run test:integration` i dowodzi: anon nigdy nie dostaje strony panelu (PRD: „panele personelu pozostają za logowaniem"), kelner/kuchnia odbici ze wszystkich tras owner-only (w tym `/settings`), zdezaktywowany z żywą sesją jest wylogowany przy następnym żądaniu na **dowolną** trasę, trasy publiczne i `/menus` nie są bramkowane.
- `src/middleware.ts` zgodny z oracle: `/settings` w `OWNER_ROUTES`, check dezaktywacji globalny.
- Cookbook §6 test-planu opisuje wzorzec; PENDING z review S-09 i nieobserwowany dług „waiter na `/room`" z `room-layout-tables/change.md:28-35` zamknięte adnotacją.

### Key Discoveries:

- `defineMiddleware(fn) === fn`; alias `"astro:middleware" → "astro/virtual-modules/middleware.js"` wystarcza (tak robi sam Astro: `astro/dist/core/create-vite.js:215`).
- `createContext` z `astro/middleware` daje realne `cookies` (parsing nagłówka `Cookie`, działający `.set()` dla signOut) i `redirect()` → `Response 302 + Location`; wymaga przekazania `locals` w wywołaniu (setter rzuca) i `defaultLocale`.
- Sesja przez cookie: nazwa `sb-${hostname.split(".")[0]}-auth-token` (dla `http://127.0.0.1:54321` → `sb-127-auth-token`), wartość `"base64-" + stringToBase64URL(JSON.stringify(session))`; helpery to publiczne eksporty `@supabase/ssr`. Zweryfikowane end-to-end w researchu §C.
- Fixture'y już tworzą userów z hasłem (`tests/integration/helpers/fixtures.ts:20`), a `signInAs` robi `signInWithPassword` (`clients.ts:43-50`) — sesję przechwytujemy z odpowiedzi (klienci mają `persistSession: false`).
- `vitest.integration.config.ts:27-31` wstrzykuje env globalnie — test gałęzi `supabase === null` wymaga izolacji modułów (patrz Critical Implementation Details).

## What We're NOT Doing

- **Żadnego e2e ani serwera HTTP** — cała ochrona jest dowodliwa przez bezpośrednie wywołanie `onRequest`.
- **Nie asertujemy brzmienia polskiego komunikatu błędu** (`middleware.ts:69`) — istnieje tylko w implementacji (oracle-from-implementation); asertujemy obecność parametru `error`.
- **Nie testujemy populacji `display_name`** — zakres S-09, nie Ryzyka #3 (decyzja z pytań planistycznych).
- **Nie eksportujemy `matchesRoute`/tablic tras** — niezmiennik `OWNER ⊆ PROTECTED` dowodzimy behawioralnie.
- **Nie ruszamy `settings.astro`** — warunkowy render zostaje jako defense-in-depth.
- **Nie zmieniamy redirectu `signin.ts` na `/dashboard`** — globalny check dezaktywacji domyka scenariusz bez zmiany UX logowania.
- **Nie dublujemy testów guardów API** — middleware nie działa na `/api/*`; macierz authz już to pokrywa.

## Implementation Approach

Jeden plik testowy `tests/integration/authz/middleware.test.ts` na istniejącym harnessie integracyjnym (lokalne Supabase, `seedTwoCompanies`). Nowy helper `tests/integration/helpers/middleware.ts` kapsułkuje: pozyskanie sesji → serializację do cookie → budowę kontekstu przez `createContext` → wywołanie `onRequest` z sentinelem `next`. Kolejność faz: harness (bez niego nic nie ruszy) → poprawki produkcyjne z testami kontraktowymi (czerwony→zielony) → pełna parametryczna macierz → synchronizacja dokumentacji.

## Critical Implementation Details

- **Globalny check dezaktywacji — umiejscowienie.** Gałąź „`locals.user` istnieje ∧ `locals.role === null` ∧ `supabase` ≠ null → signOut + redirect" wychodzi z bloku `PROTECTED_ROUTES` i staje się samodzielnym blokiem **przed** checkami tras. Warunki są rozłączne z checkiem anon (`user === null`), więc kolejność względem niego nie zmienia wyników — ale check dezaktywacji musi poprzedzać blok owner-only, żeby zdezaktywowany dostał signOut, a nie zwykły redirect. Anon i goście bez cookie są nietknięci (`user === null`).
- **Brak pętli redirectów.** Zdezaktywowany na `/auth/signin` dostaje jeden hop: signOut czyści cookies (przez `setAll` → `context.cookies.set`), redirect na `/auth/signin?error=…` przychodzi już z nagłówkami czyszczącymi; kolejne żądanie (bez sesji) renderuje stronę. Test buduje drugie żądanie bez cookie i asertuje pass-through.
- **Obserwable signOut.** Asertować: status 302 + `Location` zaczynające się od `/auth/signin?` z parametrem `error` + wyczyszczenie cookie sesji w odpowiedzi (nagłówki `Set-Cookie` / stan `ctx.cookies`). NIE polegać na serwerowej rewokacji tokenu (access token JWT bywa ważny do wygaśnięcia) ani na treści komunikatu.
- **Test `supabase === null`.** Stub `astro:env/server` czyta `process.env` w momencie importu, a config wstrzykuje env globalnie — test musi użyć `vi.resetModules()` + `vi.stubEnv("SUPABASE_URL", "")`/delete + dynamicznego `await import("@/middleware")` w izolacji (i przywrócić env po teście), inaczej złapie moduł zbudowany na wstrzykniętym env.
- **`createContext` caveats.** `locals` przekazać w argumencie wywołania (`createContext({ request, defaultLocale: "", locals: {} })`) — przypisanie `ctx.locals = …` po fakcie rzuca; middleware tylko mutuje właściwości, co jest dozwolone. Nazwę cookie wyprowadzać z `process.env.SUPABASE_URL`, nie hardkodować `sb-127`.
- **Serializacja suite'u.** `fileParallelism: false` już jest — deaktywacja/reaktywacja profilu w fixture nie wyścignie innych plików; test dezaktywacji ma przywrócić `deactivated_at = null` w `afterAll`/`finally`, bo fixture'y są współdzielone w pliku.

## Phase 1: Middleware test harness

### Overview

Umożliwić import i wywołanie `onRequest` pod Vitest oraz dać helper do budowy uwierzytelnionych żądań. Kończy się testem dymnym dowodzącym, że łańcuch działa.

### Changes Required:

#### 1. Vitest alias

**File**: `vitest.integration.config.ts`

**Intent**: Rozwiązać wirtualny moduł `astro:middleware` tak, jak robi to sam Astro, żeby `src/middleware.ts` importował się pod Vitest.

**Contract**: W `resolve.alias`, obok istniejącego `astro:env/server`, dochodzi `"astro:middleware": "astro/virtual-modules/middleware.js"` (ścieżka pakietowa; plik istnieje w astro 6.3.1).

#### 2. Middleware test helper

**File**: `tests/integration/helpers/middleware.ts` (nowy)

**Intent**: Jedno miejsce na mechanikę „sesja → cookie → APIContext → onRequest", żeby testy czytały się jak scenariusze, a pułapki (nazwa cookie, base64url, sentinel next) żyły raz.

**Contract**: Eksportuje co najmniej: `sessionCookieFor(email: string)` — loguje się `signInWithPassword` (hasło fixture'ów), zwraca wartość nagłówka `Cookie`; `runMiddleware(path: string, opts?: { cookie?: string })` — buduje `Request("http://localhost" + path)`, kontekst przez `createContext` z `astro/middleware` (`locals: {}`, `defaultLocale: ""`), woła `onRequest` z `next = async () => new Response("next-called")` i zwraca `{ response, locals, nextCalled }`. Nietrywialny fragment (kontrakt, od którego zależą pozostałe fazy):

```ts
import { serializeCookieHeader, stringToBase64URL } from "@supabase/ssr";
const cookieName = `sb-${new URL(process.env.SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
const cookieValue = "base64-" + stringToBase64URL(JSON.stringify(session));
serializeCookieHeader(cookieName, cookieValue, {});
```

#### 3. Smoke test

**File**: `tests/integration/authz/middleware.test.ts` (nowy)

**Intent**: Dowieść, że harness działa, zanim powstaną właściwe asercje.

**Contract**: Dwa przypadki: anon (bez cookie) na `/dashboard` → 302 + `Location: /auth/signin`; anon na `/` → `nextCalled === true`.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` zielony (wymaga `npx supabase start` + `.env.test`); nowy plik wykonuje oba przypadki dymne
- `npm run test` (unit) bez zmian zielony — alias nie dotyka configu unitów
- `npm run lint` zielony

---

## Phase 2: Oracle fixes — `/settings` owner-only i globalny check dezaktywacji

### Overview

Dwie poprawki produkcyjne z udokumentowanym oracle + testy kontraktowe, które je wymuszają (faza nadaje się pod `/10x-tdd`: każdy test nazywa się jednym zdaniem i jest czerwony przed poprawką).

### Changes Required:

#### 1. `/settings` w OWNER_ROUTES

**File**: `src/middleware.ts`

**Intent**: FR-002 + plany S-01/S-02 czynią profil lokalu owner-only; middleware jest jedynym strażnikiem tras (decyzja z review S-03), więc tablica musi to odzwierciedlać.

**Contract**: `OWNER_ROUTES = ["/menu", "/staff", "/room", "/settings"]`. `/settings` już jest w `PROTECTED_ROUTES` — niezmiennik `OWNER ⊆ PROTECTED` zachowany. `settings.astro` bez zmian.

#### 2. Globalny check dezaktywacji

**File**: `src/middleware.ts`

**Intent**: Kontrakt S-02 („zdezaktywowany z żywym cookie jest wylogowany przy następnym żądaniu") ma obowiązywać na każdej trasie — dziś nie obejmuje `/`, na które kieruje logowanie (repro: review S-09 F3, PENDING).

**Contract**: Gałąź `user && !role && supabase → signOut() + redirect("/auth/signin?error=…")` przeniesiona z wnętrza bloku PROTECTED przed checki tras, wykonywana bezwarunkowo względem ścieżki. Komunikat błędu bez zmian. Zachowanie dla anon i poprawnie zalogowanych — identyczne jak dziś.

#### 3. Testy kontraktowe

**File**: `tests/integration/authz/middleware.test.ts`

**Intent**: Wymusić oba fixy i przygwoździć brak pętli.

**Contract**: (a) kelner na `/settings` → 302 `/dashboard`; (b) zdezaktywowany kelner (update `profiles.deactivated_at` klientem service-role, przywrócony po teście) z żywą sesją na `/` → 302 na `/auth/signin` z parametrem `error` + wyczyszczone cookie sesji; (c) to samo żądanie na `/auth/signin` → jeden hop, a żądanie ponowione bez cookie → pass-through (brak pętli); (d) poprawnie zalogowany kelner na `/` → pass-through (check nie nadgorliwy).

### Success Criteria:

#### Automated Verification:

- Nowe testy kontraktowe zielone w `npm run test:integration`; przed poprawkami (a) i (b) były czerwone (dowód nie-tautologiczności)
- Cała istniejąca macierz authz/isolation/validation bez regresu (`npm run test:integration`)
- `npm run test` i `npm run lint` zielone

#### Manual Verification:

- Na dev serwerze (`npm run dev` + lokalne Supabase): kelner wchodzący na `/settings` ląduje na `/dashboard`; zdezaktywowany pracownik po zalogowaniu jest natychmiast wylogowany z komunikatem — zamiast siedzieć na `/`

---

## Phase 3: Pełna macierz bramkowania tras

### Overview

Parametryczne domknięcie wszystkich zachowań Ryzyka #3 na warstwie middleware — jedna macierz zamiast rozproszonych kopii (anty-wzorzec „redundant copies").

### Changes Required:

#### 1. Macierz tras

**File**: `tests/integration/authz/middleware.test.ts`

**Intent**: Każdy wiersz łapie inną regresję: usunięcie trasy z tablicy, zamianę celu redirectu, nadgorliwe bramkowanie tras publicznych, regres prefiksu.

**Contract**: Parametrycznie (`it.each`):
- anon na każdej z `/dashboard`, `/settings`, `/menu`, `/staff`, `/room` **i po jednej podścieżce** (np. `/menu/cokolwiek`) → 302 `/auth/signin`;
- **niezmiennik behawioralnie**: anon na każdej trasie owner-only → `Location` to `/auth/signin`, nigdy `/dashboard` (łapie trasę dopisaną tylko do `OWNER_ROUTES`);
- kelner **i** kuchnia na każdej z `/menu`, `/staff`, `/room`, `/settings` → 302 `/dashboard` (domyka nieobserwowany dług „waiter na `/room`" z `room-layout-tables/change.md:28-35`);
- owner na każdej trasie chronionej → pass-through (`nextCalled`);
- anon na `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email` oraz `/menus` → pass-through (granica prefiksu i rezerwacja przyszłej strony publicznej).

#### 2. Gałąź `supabase === null`

**File**: `tests/integration/authz/middleware.test.ts`

**Intent**: Przygwoździć, że przy braku konfiguracji Supabase trasa chroniona nadal odbija anonima (dziś bezpieczne przypadkiem: `user === null` → redirect) — realny scenariusz błędnej konfiguracji workera.

**Contract**: Izolowany przypadek z `vi.resetModules()` + wyczyszczonym env + dynamicznym importem `@/middleware`: żądanie na `/dashboard` → 302 `/auth/signin`; env przywrócony po teście.

### Success Criteria:

#### Automated Verification:

- Pełna macierz zielona w `npm run test:integration`
- Sabotaż kontrolny (lokalnie, nie commitowany): usunięcie `"/room"` z `PROTECTED_ROUTES` czerwieni macierz; przywrócenie — zieleni (dowód nie-tautologiczności)
- `npm run lint` zielony

---

## Phase 4: Synchronizacja dokumentacji

### Overview

Cookbook i długi dokumentacyjne — zgodnie z rytmem rolloutu (§6 wypełnia się, gdy faza ląduje).

### Changes Required:

#### 1. Cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Następny kontrybutor nowej trasy strony ma dostać przepis, nie archeologię.

**Contract**: Nowa podsekcja §6 („Adding a middleware page-gating test"): lokalizacja i helper, przepis na cookie sesji, obowiązek dopisania nowej trasy chronionej do macierzy, pułapki (nie asertować brzmienia komunikatu; env wstrzykiwany globalnie → izolacja modułów dla wariantu null-env). W §2 przy Ryzyku #3 adnotacja, że połowa middleware jest CHRONIONA od daty wdrożenia, ze wskazaniem na ten folder zmiany.

#### 2. Zamknięcie długów

**Files**: `context/changes/room-layout-tables/change.md`, `context/changes/staff-login-identifiers/reviews/impl-review.md`

**Intent**: Oba dokumenty wskazują otwarte, nieobserwowane zobowiązania, które ta zmiana właśnie domknęła.

**Contract**: Jednolinijkowe adnotacje: w `change.md` przy wierszach o nieobserwowanym redirectcie kelnera — „obserwowane od tej zmiany"; w review F3 — status PENDING → resolved z odnośnikiem do `middleware-route-protection`.

#### 3. Epilog zmiany

**Files**: `context/changes/middleware-route-protection/plan.md`, `change.md`

**Intent**: Stan wykonania odzwierciedlony w Progress; `change.md` na `status: implemented`.

**Contract**: Checkboxy Progress z sha commitów; data `updated`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` zielony (markdown nie podlega, ale hook pre-commit przechodzi)

#### Manual Verification:

- Cookbook §6 czytelny dla osoby bez kontekstu tej rozmowy; adnotacje w obu starych dokumentach wskazują właściwe miejsca

---

## Testing Strategy

### Unit Tests:

- Bez zmian — decyzje routingu świadomie w warstwie integration (decyzja z pytań planistycznych: jeden plik, zero churnu w configu unitów).

### Integration Tests:

- `tests/integration/authz/middleware.test.ts` — całość opisana w fazach 1–3; fixture'y `seedTwoCompanies`, sprzątanie w `afterAll`, deaktywacja odwracana w `finally`.

### Manual Testing Steps:

1. `npx supabase start`, `npm run dev`; zaloguj kelnera i wejdź na `/settings` → oczekiwany `/dashboard`.
2. Jako owner zdezaktywuj kelnera; w otwartej sesji kelnera odśwież `/` → oczekiwane wylogowanie i `/auth/signin` z komunikatem.
3. Wejdź anonimowo na `/menus` → strona nie jest bramkowana (404/przyszła strona publiczna, nie redirect).

## Migration Notes

Brak migracji DB. Zmiana zachowania produkcyjnego: kelner/kuchnia na `/settings` są teraz odbijani na `/dashboard` (wcześniej: shell bez formularza); zdezaktywowany pracownik jest wylogowywany na każdej trasie (wcześniej: tylko chronionych). Obie zmiany realizują udokumentowany kontrakt — nie wymagają komunikacji poza wpisem w cookbooku.

## References

- Research: `context/changes/middleware-route-protection/research.md` (oracle §B, mechanika testowa §C, historia §D)
- Kontrakt dezaktywacji: `context/changes/staff-accounts-roles/plan.md:492-501`
- Otwarte PENDING: `context/changes/staff-login-identifiers/reviews/impl-review.md:91-92`
- Dług obserwacyjny: `context/changes/room-layout-tables/change.md:28-35`
- Wzorce suite'u: `context/foundation/test-plan.md` §6.2, §6.4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Middleware test harness

#### Automated

- [x] 1.1 `npm run test:integration` zielony z nowym plikiem dymnym (anon `/dashboard` → signin; anon `/` → pass-through)
- [x] 1.2 `npm run test` (unit) bez zmian zielony
- [x] 1.3 `npm run lint` zielony

### Phase 2: Oracle fixes — `/settings` owner-only i globalny check dezaktywacji

#### Automated

- [ ] 2.1 Testy kontraktowe (a)–(d) zielone; (a) i (b) czerwone przed poprawkami (dowód nie-tautologiczności)
- [ ] 2.2 Istniejące suity integration bez regresu
- [ ] 2.3 `npm run test` i `npm run lint` zielone

#### Manual

- [ ] 2.4 Dev server: kelner na `/settings` → `/dashboard`; zdezaktywowany po zalogowaniu natychmiast wylogowany

### Phase 3: Pełna macierz bramkowania tras

#### Automated

- [ ] 3.1 Macierz parametryczna zielona (anon/kelner/kuchnia/owner × trasy + podścieżki + publiczne + `/menus`)
- [ ] 3.2 Sabotaż kontrolny czerwieni macierz (nie-tautologiczność), przywrócony
- [ ] 3.3 Wariant `supabase === null`: `/dashboard` → `/auth/signin` w izolacji modułów
- [ ] 3.4 `npm run lint` zielony

### Phase 4: Synchronizacja dokumentacji

#### Automated

- [ ] 4.1 Pre-commit hook przechodzi na zmianach dokumentacyjnych

#### Manual

- [ ] 4.2 Cookbook §6 + adnotacja Ryzyka #3 w §2; adnotacje w `room-layout-tables/change.md` i review S-09 wskazują tę zmianę
