# Middleware Route Protection (Risk #3, middleware half) — Plan Brief

> Full plan: `context/changes/middleware-route-protection/plan.md`
> Research: `context/changes/middleware-route-protection/research.md`

## What & Why

Test-planowe Ryzyko #3 (High × High) ma dwie połowy. Macierz authz pokrywa trasy API, ale połowa „niezalogowany dosięga trasy chronionej" żyje w `src/middleware.ts` i nie ma **żadnego** testu — faza 1 rolloutu odłożyła ją „do e2e" na przesłance, która okazała się fałszywa (wystarczy jeden alias Vite i publiczne `createContext` Astro). Dostarczamy suite integracyjny wywołujący `onRequest` bezpośrednio i naprawiamy dwa rozjazdy oracle ↔ implementacja znalezione w researchu.

## Starting Point

`src/middleware.ts` jest jedynym strażnikiem tras stron (`PROTECTED_ROUTES`/`OWNER_ROUTES`, redirecty, signOut zdezaktywowanych). Rozjazdy: **(1)** źródła (FR-002, plany S-01/S-02) każą `/settings` owner-only, a `OWNER_ROUTES` go nie zawiera; **(2)** `/` nie jest chronione, a logowanie kieruje na `/` — zdezaktywowany pracownik loguje się skutecznie i strażnik nigdy nie odpala (otwarty PENDING z review S-09).

## Desired End State

`tests/integration/authz/middleware.test.ts` dowodzi na produkcyjnej ścieżce (realna sesja w cookie, realny RLS): anon nigdy nie dostaje panelu, kelner/kuchnia odbici ze wszystkich tras owner-only (w tym `/settings`), zdezaktywowany wylogowany przy następnym żądaniu na dowolną trasę, trasy publiczne i `/menus` niebramkowane. Middleware zgodny z oracle, testy zielone, cookbook §6 z przepisem.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Warstwa testowa | Integration przez `onRequest`, bez e2e/HTTP | `defineMiddleware` = identity, `createContext` publiczne; e2e nie dodaje sygnału | Research |
| Rozjazdy oracle ↔ kod | Naprawić oba w tej zmianie | Poprawki drobne, oracle twardy; precedens anon-read-scoping pokazał koszt odkładania | Plan |
| Fix dziury `/` | Globalny check dezaktywacji (każda trasa) | Domyka intencję S-02 bez listy tras do pamiętania; anon nietknięty | Plan |
| Niezmiennik `OWNER ⊆ PROTECTED` | Behawioralnie (anon na owner-route → signin, nigdy dashboard) | Zero zmian produkcyjnych; testuje skutek, nie strukturę | Plan |
| Umiejscowienie testów | Jeden plik `tests/integration/authz/middleware.test.ts` | Jeden alias w configu, zero churnu w unitach, CI job `db` już to uruchamia | Plan |
| Komunikat błędu dezaktywacji | Asertować tylko obecność parametru `error` | Brzmienie istnieje wyłącznie w kodzie — asercja byłaby lustrem implementacji | Research |
| Extras | Gałąź `supabase === null`; bez testów `display_name` | Null-env dziś bezpieczne przypadkiem — warto przygwoździć; display_name to zakres S-09 | Plan |

## Scope

**In scope:** alias `astro:middleware` w vitest.integration.config; helper sesja→cookie→APIContext; testy dymne, kontraktowe i macierz parametryczna; dwie poprawki `src/middleware.ts`; cookbook §6 + zamknięcie długów (PENDING S-09, nieobserwowany „waiter na /room").

**Out of scope:** e2e/HTTP, testy `/api/*` (pokryte), brzmienie komunikatów, `display_name`, eksport tablic tras, zmiany `settings.astro` i `signin.ts`.

## Architecture / Approach

Helper buduje realne żądanie: `signInWithPassword` → sesja → cookie `sb-<host>-auth-token` (`base64url`) → `createContext` z `astro/middleware` → `onRequest` z sentinelem `next`. Gałęzie tożsamościowe biegną produkcyjną ścieżką (GoTrue + RLS na lokalnym Supabase); decyzje routingu anon to żądanie bez cookie.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Harness | Alias + helper + testy dymne | Niezgodność wersji astro/@supabase/ssr z przepisem na cookie |
| 2. Oracle fixes | `/settings` w OWNER_ROUTES; globalny check dezaktywacji + testy kontraktowe | Pętla redirectów na `/auth/signin` (jawnie testowana) |
| 3. Macierz | Parametryczne pokrycie ról × tras + prefiks + null-env | Izolacja env dla wariantu null (moduły cache'ują env z importu) |
| 4. Docs | Cookbook §6, adnotacje długów, epilog | — |

**Prerequisites:** Docker + `npx supabase start`, `.env.test` (jak dla całej warstwy integration).
**Estimated effort:** ~1–2 sesje; fazy 2–3 nadają się pod `/10x-tdd`.

## Open Risks & Assumptions

- Globalny check dezaktywacji wykonuje signOut także na trasach auth — założenie „jeden hop, brak pętli" jest jawnie testowane (2c).
- Zmiana zachowania produkcyjnego (kelner na `/settings` → `/dashboard`) realizuje udokumentowany kontrakt, ale jest widoczna dla użytkowników.

## Success Criteria (Summary)

- Suite middleware zielony na `npm run test:integration`, czerwony przed poprawkami i przy sabotażu tablic (nie-tautologiczny).
- Zdezaktywowany pracownik nie może korzystać z aplikacji po następnym żądaniu — na dowolnej trasie.
- Cookbook §6 pozwala dodać test dla nowej trasy chronionej bez czytania tej historii.
