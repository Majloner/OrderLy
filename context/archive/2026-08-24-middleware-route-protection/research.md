---
date: 2026-08-24T22:35:17+02:00
researcher: Claude Code (Fable 5)
git_commit: f59939373c43ab1cc63319209ccc099dcde1d1e0
branch: main
repository: Majloner/OrderLy
topic: "Risk #3 (middleware half): protected-page gating in src/middleware.ts — oracle, testability, history"
tags: [research, codebase, middleware, authz, risk-3, test-rollout]
status: complete
last_updated: 2026-08-24
last_updated_by: Claude Code (Fable 5)
---

# Research: Risk #3 (middleware half) — protected-page gating in `src/middleware.ts`

**Date**: 2026-08-24T22:35:17+02:00
**Researcher**: Claude Code (Fable 5)
**Git Commit**: `f59939373c43ab1cc63319209ccc099dcde1d1e0`
**Branch**: `main`
**Repository**: Majloner/OrderLy (permalink base: `https://github.com/Majloner/OrderLy/blob/f59939373c43ab1cc63319209ccc099dcde1d1e0/`)

## Research Question

Test-plan Risk #3 ma dwie połowy: „nie-właściciel wykonuje write owner-only" (pokryte macierzą tras API w `tests/integration/authz/`) **oraz** „niezalogowany dosięga trasy chronionej" — czyli ochrona tras *stron* w `src/middleware.ts`. Ta druga połowa nie ma żadnego testu (harness `buildContext` celowo omija middleware). Pytania: (1) gdzie ryzyko realnie przechodzi przez kod, (2) jakie zachowanie — wyprowadzone ze źródeł, nie z implementacji — dowodzi ochrony, (3) jaki jest najtańszy test, który to łapie.

## Summary

1. **Gdzie żyje ryzyko.** Wyłącznie w `src/middleware.ts` `onRequest` (`:20–82`): tablice `PROTECTED_ROUTES`/`OWNER_ROUTES` (`:5`, `:11`), dopasowanie prefiksowe `matchesRoute` (`:16–18`), redirect anonimowego (`:56–59`), gałąź signOut dla zdezaktywowanych/osieroconych (`:66–72`), odbicie nie-właściciela (`:75–79`). Middleware **nie** jest na ścieżce `/api/*` (`matchesRoute("/api/menu/…","/menu")` → false), więc suite middleware nie dubluje macierzy authz.

2. **Oracle ze źródeł istnieje i w dwóch miejscach NIE zgadza się z implementacją.**
   - PRD (`context/foundation/prd.md:229-232`): „Nieuwierzytelniony dostęp jest możliwy wyłącznie do ścieżki zamawiania z poziomu stolika — **panele personelu pozostają za logowaniem**."
   - PRD (`prd.md:217-224` + FR-002/003/004-006/008-011): menu, personel, sala i **profil lokalu** są owner-only; kelner „Nie zmienia konfiguracji firmy, menu, sali ani kont", kuchnia ma „wyłącznie dedykowany widok kuchni".
   - **Rozjazd #1**: źródła (FR-002 `prd.md:131`; `staff-accounts-roles/plan-brief.md:29-30` „no access to `/menu` or `/settings`"; archiwalny plan S-01 `:167`, `:195`) wymagają owner-only dla `/settings`, a `OWNER_ROUTES` (`src/middleware.ts:11`) go **nie zawiera** — kelner/kuchnia przechodzą middleware; zatrzymuje ich dopiero warunkowy render w `settings.astro:11`.
   - **Rozjazd #2** (otwarty finding PENDING, `staff-login-identifiers/reviews/impl-review.md:91`): `/` nie jest w `PROTECTED_ROUTES`, a login przekierowuje na `/` — zdezaktywowany pracownik **loguje się skutecznie** i siedzi na `/`, strażnik signOut nigdy nie odpala.

3. **Najtańszy test — dwie warstwy, obie bez e2e i bez serwera HTTP.** `defineMiddleware` to funkcja tożsamościowa; Astro publicznie eksportuje `createContext` z `astro/middleware` (buduje realny `APIContext` z prawdziwym parsowaniem cookies i `redirect()` → `Response 302 + Location`). Wystarczy jeden alias `"astro:middleware" → "astro/virtual-modules/middleware.js"` w `vitest.integration.config.ts`.
   - **Warstwa DB-free** (decyzje routingu anon): bez `SUPABASE_URL`/`SUPABASE_KEY` `createClient` zwraca `null` (`src/lib/supabase.ts:6-8`) — zero sieci, zero mocków; testuje redirect anon, pass-through tras publicznych i granicę prefiksu `/menu` vs `/menus`.
   - **Warstwa integration** (gałęzie zależne od roli i od RLS): realna sesja z `signInWithPassword` zserializowana do cookie `sb-127-auth-token` (`"base64-" + base64url(JSON.stringify(session))`) — `getUser()` i SELECT `profiles` biegną produkcyjną ścieżką pod prawdziwym RLS. Przypadek zdezaktywowanego personelu **wymaga** tej warstwy: stub klienta skłamałby o `current_staff_role() → NULL`.

## Detailed Findings

### A. Powierzchnia kodu (co dokładnie podlega testowi)

- `src/middleware.ts:5` — `PROTECTED_ROUTES = ["/dashboard", "/settings", "/menu", "/staff", "/room"]`.
- `src/middleware.ts:11` — `OWNER_ROUTES = ["/menu", "/staff", "/room"]` (bez `/settings` — patrz rozjazd #1).
- `src/middleware.ts:16-18` — `matchesRoute`: równość lub prefiks `route + "/"`; komentarz `:13-15` rezerwuje przyszłą publiczną stronę klienta (`/menus…` nie może być bramkowane).
- `src/middleware.ts:20-53` — rezolucja tożsamości: `createClient(headers, cookies)` → `getUser()` → SELECT `profiles (company_id, role, full_name, login)` pod RLS; brak profilu (orphan **lub** zdezaktywowany — resolwery zwracają NULL) zostawia `role = null`.
- `src/middleware.ts:56-59` — anon na trasie chronionej → `redirect("/auth/signin")`.
- `src/middleware.ts:66-72` — zalogowany bez roli na trasie chronionej → `signOut()` + `redirect("/auth/signin?error=…")` (polski komunikat).
- `src/middleware.ts:75-79` — nie-owner na trasie owner-only → `redirect("/dashboard")`.
- Middleware nie dotyka `/api/*` (`context/changes/testing-tenant-isolation-integration/research.md:40,97`).

### B. Oracle ze źródeł (co wolno asertować i skąd)

| Zachowanie | Źródło | Siła |
|---|---|---|
| Anon nigdy nie dostaje strony panelu personelu | `prd.md:229-232` („panele personelu pozostają za logowaniem"); FR-012 `prd.md:160` | PRD — twarda |
| `/menu`, `/staff`, `/room` owner-only; kelner/kuchnia odbici | `prd.md:217-224`; US-03 `prd.md:123`; `shape-notes.md:27-28` | PRD — twarda |
| **`/settings` owner-only** | FR-002 `prd.md:131`; `staff-accounts-roles/plan-brief.md:29-30`; archiwum S-01 `plan.md:167,195` | PRD+plan — twarda; **implementacja niezgodna** |
| `/dashboard` = dowolna zalogowana rola (landing kelnera/kuchni) | `staff-accounts-roles/plan.md:81-82,593` | tylko change-doc |
| Zdezaktywowany z żywym cookie: signOut na następnym żądaniu do trasy chronionej + redirect z parametrem błędu | `staff-accounts-roles/plan.md:87-90,492-501` (kontrakt obejmuje też orphana); non-goal `:148-149` (bez natychmiastowej rewokacji) | change-doc — twarda dla mechanizmu |
| Cel redirectu anon = `/auth/signin`; nie-owner = `/dashboard` | `staff-accounts-roles/plan.md:593-594`; archiwum S-01 `plan.md:167`; `context/deployment/deploy-plan.md:57,96` | change-doc (PRD milczy o URL-ach) |
| Trasa owner-only MUSI być też w PROTECTED (inaczej anon leci na `/dashboard`) | `staff-accounts-roles/plan.md:495-497` | change-doc — niezmiennik konfiguracji |
| Trasy publiczne bez bramki: `/`, `/auth/signin`, `/auth/signup`, `/auth/confirm-email`; `/menus` ≠ `/menu` | inwentarz `src/pages/**`; komentarz `middleware.ts:13-15`; `prd.md:231` | wyprowadzone |
| **Dokładna treść** polskiego komunikatu błędu | żaden dokument — istnieje tylko w `middleware.ts:69` | **NIE asertować brzmienia** (oracle-from-implementation); asertować obecność parametru `error` |

**Rozjazdy oracle ↔ implementacja (decyzja dla planu):**
1. `/settings` poza `OWNER_ROUTES` — test zgodny z oracle będzie **czerwony**, dopóki middleware nie zostanie poprawione (jednolinijkowy append). Strona ma własny warunkowy render (`settings.astro:11`), więc dziś nie ma wycieku danych, ale review S-03 (`archive/2026-07-08-menu-items-management/reviews/impl-review.md:67`) ustanowił middleware jako *jedyne* źródło ochrony tras — rozjazd łamie tę zasadę.
2. `/` poza pętlą dezaktywacji — zdezaktywowany loguje się i ląduje na `/` bez signOut (repro w `staff-login-identifiers/reviews/impl-review.md:91`, decyzja PENDING). Naprawa nieoczywista: dodanie `/` do `PROTECTED_ROUTES` bramkowałoby stronę publiczną; sugerowany kierunek reviewu to „dodać `/` do deactivated-session check", nie do pełnej ochrony.

### C. Testowalność (zweryfikowana na node_modules i w żywym Node)

- `astro:middleware` → alias Vite na `astro/virtual-modules/middleware.js` (tak robi sam Astro, `astro/dist/core/create-vite.js:215`); `defineMiddleware(fn) === fn` potwierdzone runtime'owo.
- `createContext` z `astro/middleware` (`astro/dist/core/middleware/index.js:13-84`) buduje realny `APIContext`: `cookies = new AstroCookies(request)` (prawdziwy parsing nagłówka `Cookie`, działający `.set()` potrzebny gałęzi signOut), `redirect()` → `Response(null, {status: 302, headers: {Location}})`, `url` z `request.url`. Wymaga `locals` przekazanych do wywołania (setter rzuca przy nadpisaniu; middleware tylko mutuje właściwości — OK) i `defaultLocale`.
- `next` = `async () => new Response("next-called")` — sentinel do rozróżnienia pass-through od redirectu.
- Cookie sesji: nazwa `sb-${hostname.split('.')[0]}-auth-token` → dla `http://127.0.0.1:54321` to **`sb-127-auth-token`**; wartość `"base64-" + stringToBase64URL(JSON.stringify(session))` (helpery są publicznymi eksportami `@supabase/ssr`); chunking nieistotny przy odczycie pojedynczego cookie. Zweryfikowane offline end-to-end: tak zbudowany Request → `createServerClient` → `getSession()` odtwarza sesję.
- Poświadczenia istnieją: fixtures tworzą userów przez `admin.createUser({ email, password: "orderly-integration-pass", email_confirm: true })` (`tests/integration/helpers/fixtures.ts:20,71-77,115-120`); `signInAs` już robi `signInWithPassword` (`tests/integration/helpers/clients.ts:43-50`) — sesję przechwycić z odpowiedzi (klienci mają `persistSession: false`).
- Stub `astro:env/server` już istnieje (`tests/integration/stubs/astro-env-server.ts`, alias w `vitest.integration.config.ts:21`) — `src/lib/supabase.ts` importuje się pod Vitest bez zmian.
- Żadnych istniejących testów/helperów wołających `onRequest` (grep czysty); `tests/integration/helpers/context.ts:3-9,46` celowo omija middleware (stub `cookies = {}`).
- `astro.config.mjs:22-31`: sekrety `optional: true` — stąd null-branch `createClient`, wart jednego testu (middleware bez env nie może wpuścić nikogo na trasę chronioną? uwaga: dziś przy `supabase === null` i braku usera anon → `/auth/signin`, co jest bezpieczne).
- `matchesRoute`/tablice **nieeksportowane** — czysty unit matchera wymagałby zmiany API produkcyjnego; niepotrzebne, bo warstwa DB-free przez `onRequest` testuje to samo bez żadnego mocka.

### D. Historia i stabilność (czy testy będą churnować)

- Middleware kształtowały: S-01 (tenant context), S-03 (`/menu` + fix prefiksu `b34cef8` z code-review — „no /menu over-match"), S-06 (`/room`), S-02 (`/staff` + gałąź signOut), S-09 (`display_name`; fallback `user.email` tylko dla ownerów — z review `staff-login-identifiers/reviews/impl-review.md:92`).
- Faza 1 rolloutu jawnie odłożyła redirecty stron: `testing-tenant-isolation-integration/plan.md:45` („page redirects are UX and deferred (revisit with an e2e layer, test-plan §3 Phase 4)") — przesłanka blokująca (`astro:middleware` nierozwiązywalne pod Vitest, `research.md:42`) okazała się **fałszywa**: wystarczy jeden alias. Wzorzec identyczny jak lekcja anon-RLS („sprawdź przesłankę, zanim uznasz za zablokowane").
- Luka NIE figuruje w `KNOWN-GAPS.md`; test-plan §3 oznacza Fazę 1 `complete`, więc połowa Ryzyka #3 zamknęła się na papierze bez testu.
- `room-layout-tables/change.md:28-35`: „waiter na `/room` → `/dashboard`" **oznaczone jako done, ale nigdy nieobserwowane** — ta zmiana domyka też tamten dług.
- `ui-redesign` (0/55, planned) **nie** dotyka middleware ani tras (`ui-redesign/plan.md:110-111` „same routes"; grep `middleware` → 0 trafień). Jedyny styk: banery `?error=` będą restylowane (`plan.md:495`) — asertować URL redirectu i parametr query, nie DOM.
- Plik był „shared append-only" między trzema równoległymi gałęziami i tę dyscyplinę raz złamano (`room-layout-tables/reviews/impl-review.md:328-330`) — kolejny argument za testem pilnującym konfiguracji tras.

## Code References

- `src/middleware.ts:5,11` — tablice tras; `:16-18` — `matchesRoute`; `:56-59` — redirect anon; `:66-72` — signOut zdezaktywowanego/orphana; `:75-79` — odbicie nie-ownera
- `src/lib/supabase.ts:5-24` — `createClient(headers, cookies)`: null-branch bez env; `createServerClient` z `parseCookieHeader`
- `tests/integration/helpers/fixtures.ts:20,71-77,115-120` — userzy z hasłem `orderly-integration-pass`
- `tests/integration/helpers/clients.ts:14,43-50` — `signInAs` / `AUTH_OPTS.persistSession: false`
- `tests/integration/helpers/context.ts:3-9,46` — harness API omijający middleware (kontrast)
- `vitest.integration.config.ts:21,27-31` — istniejący alias `astro:env/server` + wstrzykiwanie env (tu dojdzie alias `astro:middleware`)
- `src/pages/settings.astro:4-11,36-37` — warunkowy render owner-only w stronie (jedyna dzisiejsza obrona `/settings`)
- `context/foundation/prd.md:123,131,133,160,210-232` — normatywny Access Control i FR-y
- `context/changes/staff-accounts-roles/plan.md:87-90,148-149,492-501,593-594` — kontrakt dezaktywacji i cele redirectów

## Architecture Insights

- Middleware jest **jedynym** strażnikiem tras stron (decyzja z review S-03: bez defense-in-depth w frontmatter stron, poza `settings.astro`, które ma własny warunkowy render z powodów historycznych). Regres w dopasowaniu tras = renderowanie shellu nie-ownerom (bez wycieku danych — dane i tak tnie RLS), ale to wprost scenariusz Ryzyka #3.
- Niezmiennik konfiguracyjny „każda trasa z `OWNER_ROUTES` musi być też w `PROTECTED_ROUTES`" jest udokumentowany i łatwy do zepsucia przy appendzie — nadaje się na test property-style po eksporcie tablic **albo** behawioralnie: anon na każdej trasie owner-only musi lecieć na `/auth/signin`, nigdy na `/dashboard`.
- Dwuwarstwowość zgodna z test-planem (koszt × sygnał): decyzje routingu = DB-free (zero mocków), tożsamość/RLS = integration na lokalnym Supabase. Stub klienta Supabase dla gałęzi dezaktywacji skłamałby dokładnie tak, jak ostrzega §2 test-planu.

## Historical Context (from prior changes)

- `context/changes/testing-tenant-isolation-integration/plan.md:45` + `research.md:40-42,97` — jawne odłożenie middleware „do e2e" na fałszywej przesłance technicznej
- `context/changes/staff-accounts-roles/plan.md:492-501` — kontrakt signOut (oracle mechanizmu dezaktywacji)
- `context/changes/staff-login-identifiers/reviews/impl-review.md:91-92` — otwarty PENDING: `/` poza pętlą dezaktywacji (repro krok po kroku)
- `context/changes/room-layout-tables/change.md:28-35` — „waiter na /room" oznaczone done bez obserwacji
- `context/archive/2026-07-04-owner-company-registration/plan.md:167,195` — owner-only `/settings` od S-01
- `context/archive/2026-07-08-menu-items-management/reviews/impl-review.md:67-73` — middleware jako single source of route protection
- `context/foundation/lessons.md` — lekcja anon-RLS: „zanim uznasz lukę za zablokowaną przez przyszły slice, sprawdź przesłankę" (tu: przesłanka e2e)

## Related Research

- `context/changes/testing-tenant-isolation-integration/research.md` — mapa guard vs middleware vs RLS (połowa API Ryzyka #3)
- `context/changes/anon-read-scoping/research.md` — precedens „powierzchnia bez konsumenta"
- `context/foundation/test-plan.md` §2 Risk #3, §6.4 (cookbook tras API)

## Open Questions

1. **Zakres zmiany:** czy naprawiamy oba rozjazdy (`/settings` → `OWNER_ROUTES`; `/` w pętli dezaktywacji) w tej zmianie, żeby testy oracle były zielone — czy zostawiamy czerwone testy / `KNOWN-GAPS`? Rekomendacja: naprawić — obie poprawki są jednolinijkowe-do-kilkulinijkowych, mają udokumentowany oracle, a precedens anon-read-scoping pokazał koszt odkładania. Fix `/` wymaga decyzji projektowej (bramkować tylko pętlę dezaktywacji, nie całą trasę).
2. Czy test niezmiennika `OWNER_ROUTES ⊆ PROTECTED_ROUTES` robić behawioralnie (bez zmian produkcyjnych) czy przez eksport tablic (mały API change, czytelniejszy test)?
3. Czy gałąź `supabase === null` (brak env) zasługuje na asercję „trasa chroniona nadal odbija" — dziś zachowanie jest bezpieczne przypadkiem (user = null → redirect), warto je przygwoździć.
