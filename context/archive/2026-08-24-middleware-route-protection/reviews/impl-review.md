<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Middleware Route Protection (Risk #3, middleware half)

- **Plan**: context/changes/middleware-route-protection/plan.md
- **Scope**: Fazy 1–4 z 4 (pełny plan)
- **Date**: 2026-08-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS — wszystkie pozycje wszystkich faz MATCH; jedyny dryf (świeże sesje per test zamiast recyklingu sesji z seeda + eksport `PASSWORD` + `sessionCookieFromClient`) wymuszony realnym zachowaniem GoTrue (globalna rewokacja sesji przy signOut) i udokumentowany w 3 miejscach (test file, fixtures, test-plan §6.7) |
| Scope Discipline | WARNING — dwa EXTRA (eksport `PASSWORD`, helper `sessionCookieFromClient`), oba benign i udokumentowane; wszystkie 7 granic „What We're NOT Doing" respektowane |
| Safety & Quality | WARNING — F1 (kontrakt /api/* dla zdezaktywowanej sesji zmieniony bez analizy i testu); F2 obserwacja hardeningowa |
| Architecture | PASS |
| Pattern Consistency | PASS — suite zgodny z sąsiadami (oracle-komentarz, seed/cleanup, it.each, zero mocków wewnętrznych, `as never` tylko na granicy); 2 kosmetyczne obserwacje |
| Success Criteria | PASS — integration 235/235, unit 177/177, lint OK (przebieg z 2026-08-25); manuale 2.4 i 4.2 potwierdzone przez człowieka; sabotaż kontrolny wykonany (usunięcie `/room` czerwieni macierz) |

## Findings

### F1 — Globalny check dezaktywacji zmienia kontrakt /api/*: JSON 403 → 302 HTML

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — realny tradeoff; zatrzymaj się i przemyśl
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:65-71
- **Detail**: Middleware biegnie na KAŻDYM żądaniu, także `/api/*` (guardy konsumują `locals`, które on buduje — `src/lib/api.ts:45-46`); fałszywe jest tylko dopasowanie tablic tras. Przed zmianą zdezaktywowany user na `GET /api/menu` przechodził middleware i dostawał JSON 403 z `guardMenuRequest` (`!company_id` → „Konto nie jest przypisane do żadnej firmy"), cookie nietknięte. Po zmianie: `signOut()` + 302 na `/auth/signin?error=…`. Hooki fetch (`useMenu.ts:17-36`, domyślne `redirect: "follow"`) podążają za redirectem, dostają HTML 200, `envelope = null` i zwracają pusty sukces → `MenuManager.tsx:47` renderuje wieczne „Ładowanie menu…" bez błędu. Stan przejściowy (cookie czyszczone → następne żądanie anon) i dotyczy tylko już-zdezaktywowanych sesji; bezpieczeństwo fail-more-closed. Problem: zaszło pod fałszywą przesłanką zapisaną w `plan.md:37` („middleware nie działa na /api/*") i `test-plan.md` §6.4 („middleware NIE jest na ścieżce /api/*") i nie ma testu.
- **Fix A ⭐ Recommended**: carve-out w gałęzi dezaktywacji — `signOut()` bez zmian, ale dla `context.url.pathname.startsWith("/api/")` zwróć JSON 401 (kształt zgodny z `jsonError` z api.ts) zamiast redirectu; jeden wiersz macierzy pinuje; korekta fałszywego zdania w obu dokumentach.
  - Strength: API zachowuje kontrakt JSON — klienci fetch/przyszły polling FR-007 dostają odróżnialny błąd, a sesja i tak umiera.
  - Tradeoff: jedna gałąź więcej w middleware; kilkanaście linii + test.
  - Confidence: HIGH — pełna ścieżka dowodowa (api.ts, useMenu.ts, brak pokrycia).
  - Blind spot: kształt JSON-a błędu warto zgrać z istniejącym envelope.
- **Fix B**: świadomie zaakceptować 302 i przygwoździć testem (`runMiddleware("/api/menu", { cookie })` pod `withDeactivatedWaiter` → 302) + korekta dokumentów.
  - Strength: zero zmian produkcyjnych; zachowanie udokumentowane.
  - Tradeoff: „wieczne ładowanie" u zdezaktywowanego zostaje; każdy przyszły klient API musi znać pułapkę.
  - Confidence: MED — zależy od wagi UX tego przejściowego stanu.
  - Blind spot: polling-hooki S-05 powielą problem.
- **Decision**: FIXED via Fix A (2026-08-26) — carve-out /api/* w gałęzi dezaktywacji (signOut + JSON 401 przez jsonError), test „answers a deactivated session on /api/* with JSON 401", korekty plan.md (What We're NOT Doing) i test-plan.md §6.4.

### F2 — Błąd signOut() ignorowany (teoretyczna pętla przy awarii GoTrue)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:66
- **Detail**: supabase-js zwraca `{ error }` zamiast rzucać; przy błędzie innym niż 401/403/404 GoTrue-js NIE czyści lokalnej sesji — cookie zostaje, redirect na `/auth/signin` re-triggeruje gałąź aż GoTrue wstanie. Mało prawdopodobne (`getUser()` przeszedł chwilę wcześniej).
- **Fix**: przy błędzie signOut usunąć cookie sesji jawnie przez `context.cookies` przed redirectem.
- **Decision**: FIXED (2026-08-26) — błąd signOut obsłużony: przy { error } middleware jawnie kasuje cookies sb-*-auth-token przez context.cookies.delete przed odpowiedzią.

### F3 — `requireEnv` skopiowane verbatim z clients.ts

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Pattern Consistency
- **Location**: tests/integration/helpers/middleware.ts:25-31
- **Detail**: Identyczna funkcja istnieje w `clients.ts:19-25`.
- **Fix**: wyeksportować z clients.ts i importować.
- **Decision**: FIXED (2026-08-26) — requireEnv wyeksportowane z clients.ts, duplikat w helpers/middleware.ts usunięty.

### F4 — Jawny timeout 120_000 w beforeAll odbiega od `hookTimeout: 60_000`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Pattern Consistency
- **Location**: tests/integration/authz/middleware.test.ts:19
- **Detail**: Sąsiednie suity polegają na configowym `hookTimeout`; jawna wartość po cichu od niego odbiega.
- **Fix**: usunąć jawny argument (seed mieści się w limicie configu).
- **Decision**: FIXED (2026-08-26) — jawny timeout beforeAll usunięty; obowiązuje configowy hookTimeout.
