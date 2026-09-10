# Menu Availability Toggle (S-05) — Plan Brief

> Full plan: `context/changes/menu-availability-toggle/plan.md`
> Research: `context/changes/menu-availability-toggle/research.md`

## What & Why

Kelner przełącza dostępność pozycji menu (dostępna / niedostępna / wyprzedana) bezpośrednio
z sali, żeby klient nie zamówił rzeczy, której nie ma (FR-007). To pierwszy zapis w aplikacji
dozwolony dla roli innej niż owner — dotąd kelner nie miał żadnej ścieżki zapisu ani nawet
wstępu na `/menu`.

## Starting Point

Model 3 stanów istnieje od S-03 (enum w DB, typy, badge w UI), ale zmienia go wyłącznie owner
pełnym PUT-em w dialogu edycji. RLS, guard API i middleware zgodnie blokują kelnera; po
zalogowaniu personel ląduje na stronie marketingowej. W repo nie ma żadnego pollingu.
Migracja S-03 zostawiła wprost obietnicę: "S-05 will add the waiter availability-toggle write path".

## Desired End State

Kelner loguje się, ląduje na /dashboard, wchodzi na /menu i przełącza dostępność selectem
w wierszu; owner w drugiej sesji widzi zmianę w ≤5 s bez odświeżania. Kuchnia widzi menu
read-only. Nic poza `availability` kelner zmienić nie może — dowodzą tego suita RLS
(trigger w DB) i macierz autoryzacji tras.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Widoczność dla klienta anon | Poza zakresem — polling staff-owy; klient w S-08 | Brak jakiegokolwiek anon-konsumenta (polityki celowo usunięte); publiczny odczyt = SD-RPC S-08 | Research |
| Gdzie kelner przełącza | Wspólny `/menu`, UI różnicowane po roli | Jedna lista, mniej kodu; owner-akcje ukryte po roli | Plan (user) |
| Kuchnia na /menu | Read-only (widzi, nie klika) | RLS i tak daje jej SELECT; widok "co wyprzedane" realnie przydatny | Plan (user) |
| Kształt toggle'a | Select (shadcn) w wierszu + busy-flag | 3 stany nie mieszczą się w przełączniku binarnym; wzorzec Select już jest | Plan (user) |
| Redirect po zalogowaniu | Wszyscy → `/dashboard` | Jedna reguła bez logiki ról w signin; naprawia UX także ownerowi | Plan (user) |
| Niezmiennik "tylko availability" | Polityka UPDATE dla kelnera + trigger porównujący wiersze bez `availability` | RLS nie umie ograniczać kolumn; trigger-precedensy już są; PATCH zostaje na PostgREST | Plan |
| Kształt endpointu | `PATCH /api/menu/items/[id]/availability`, schemat `.pick()` | Ustalona konwencja wąskich PATCH-y (impl-review F5), gotowy szablon activation | Research |
| Polling | 4 s w `useMenu`, pauzy: hidden/dialog/mutacja | Dokumentowa degradacja realtime → 3–5 s; ochrona przed klobberowaniem edycji | Research |

## Scope

**In scope:** migracja RLS + trigger; PATCH availability + rozszerzenie guarda (owner+kelner);
wpuszczenie kelnera i kuchni na /menu z UI po roli; select-toggle w wierszu; kafle dashboardu
(Menu dla wszystkich, ustawienia tylko owner); redirect logowania → /dashboard; pierwszy
polling; komplet testów (RLS SQL, macierz authz z pierwszym "waiter allowed", IDOR, parity).

**Out of scope:** klient anonimowy/QR (S-08); inne uprawnienia kelnera/kuchni; WebSockety;
zmiany w pełnym PUT; refresh test-planu (osobno, §7).

## Architecture / Approach

Warstwa po warstwie od dołu: DB (polityka + trigger jako jedyne twarde źródło niezmiennika)
→ API (wąski PATCH wg szablonu activation, guard z trybem "availability write") → UI
(role-aware /menu + redirect) → polling (interwał w hooku useMenu z pauzami). Rola przecina
3 niezależne warstwy — każda faza zmienia dokładnie jedną.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. DB | Polityka UPDATE kelnera + trigger niezmiennika, asercje RLS | Trigger zbyt luźny/ciasny (porównanie jsonb minus availability) |
| 2. API | PATCH availability + guard + macierz z "waiter allowed" | Rozszerzenie kształtu macierzy bez psucia istniejących wierszy |
| 3. UI | Role-aware /menu, kafle, redirect /dashboard | Regresja e2e route-protection (kelner już nie odbijany z /menu) |
| 4. Polling | Odświeżanie 4 s z pauzami | Tick klobberujący otwarty dialog / migotanie błędem |

**Prerequisites:** lokalny Supabase (Docker) do faz 1–2; dwie sesje przeglądarki do fazy 4.
**Estimated effort:** ~2 sesje; fazy 1+2 razem, 3+4 razem.

## Open Risks & Assumptions

- Macierz authz wymaga pierwszej w historii zmiany kształtu wiersza — ryzyko dotknięcia
  wszystkich istniejących wpisów (minimalizować: pole opcjonalne z defaultem "owner-only").
- Zakładamy, że `route-protection.spec.ts` da się zaktualizować bez przebudowy harnessu e2e.
- Roadmapowy outcome S-05 mówi o kliencie — przy archiwizacji odnotować w roadmapie redukcję
  (klient = S-08 na SD-RPC), żeby /10x-test-plan --refresh nie liczył klienta do S-05.

## Success Criteria (Summary)

- Kelner przełącza dostępność w ≤2 kliknięcia od wejścia na /menu; nic innego zmienić nie może
  (dowód: trigger + macierz, nie tylko UI).
- Druga zalogowana sesja widzi zmianę ≤5 s bez odświeżania.
- Kuchnia widzi menu bez akcji; anon dalej nie widzi nic (bez regresji izolacji).
