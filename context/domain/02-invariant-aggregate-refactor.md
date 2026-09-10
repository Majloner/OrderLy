---
title: "OrderLY — niezmiennik #1 i projekt agregatu-strażnika (rachunek stolika)"
created: 2026-09-05
type: refactor-plan
---

# Plan refaktoru: agregat-strażnik dla niezmiennika cyklu życia rachunku stolika

> Plan, nie implementacja. Każdy cytat `plik:linia` zweryfikowany na branchu `main`
> (2026-09-05). Bazuje na destylacji domeny:
> `context/domain/01-domain-distillation.md`.

## KROK 0 — Kontekst (skrót)

Dokumenty: `context/foundation/prd.md` (kanoniczny; sekcja **Business Logic**
`prd.md:187-208` opisuje dokładnie jedną regułę — cykl życia zamówienia stolika),
`OrderLY-MVP.md` (starszy, częściowo zrewidowany), `context/foundation/roadmap.md`
(wedge produktu: `roadmap.md:23-25`), `context/foundation/lessons.md`.

Stack: Astro 6 SSR + React 19 + Supabase (Postgres/RLS) na Cloudflare Workers
(`AGENTS.md`). Logika biznesowa żyje dziś w trzech warstwach i repo ma dla każdej
ustalony idiom egzekwowania reguł:

| Warstwa | Idiom egzekwowania | Precedens |
| --- | --- | --- |
| Persystencja | RLS default-deny + indeksy częściowe + **triggery-strażniki** rzucające `errcode 42501` | `guard_profile_self_change` `supabase/migrations/20260727220415_staff_accounts_roles.sql:112-140`; `guard_company_code_immutable` `20260803134535:22-38`; strukturalny brak DELETE policy na `tables` `20260727120000:189-190` |
| Operacje wielowierszowe | **atomowe RPC** (funkcja SQL, jedna transakcja) zamiast N zapytań z route'a | `reorder_menu_categories/items` `20260717093000_menu_ordering_hardening.sql:1-36`, wołane przez `supabase.rpc(...)` w `src/pages/api/menu/items/reorder.ts:22` |
| API | cienki guard → walidacja zod → zapytanie; mapowanie kodów DB na HTTP | `guardMenuRequest` `src/lib/api.ts:29-52`; `isInsufficientPrivilege` (42501→403) `src/lib/api.ts:158-163` |

Ten plan projektuje agregat tak, by **wpisywał się w te trzy idiomy**, a nie wprowadzał
czwarty.

## KROK 1 — Niezmienniki biznesowe (identyfikacja)

| ID | Niezmiennik („musi być zawsze prawdziwe") | Źródło |
| --- | --- | --- |
| N-01 | Żadne żądanie nie ujawnia ani nie mutuje danych innej firmy | `prd.md:184-185`, guardrail `prd.md:73-74`; `AGENTS.md` Hard rules |
| N-02 | Stolik nigdy nie jest usuwany; jedyny cykl życia to aktywacja/dezaktywacja (trwałość wydrukowanego QR) | FR-009 `prd.md:151-152`; guardrail `prd.md:75-76` |
| N-03 | Numer stolika jest unikalny w obrębie firmy (pierwotny identyfikator) | FR-010 `prd.md:153-154` |
| N-04 | Kod lokalu (przyszła treść QR) po nadaniu nigdy się nie zmienia | `20260728150833:17-19`; konsekwencja FR-011 `prd.md:155-156` |
| N-05 | Rola `owner` nie jest nadawalna; właściciel nie zdegraduje ani nie dezaktywuje sam siebie | `prd.md:217-219,226-227` |
| N-06 | Login personelu jest niezmienny po utworzeniu (adres auth jest z niego wyprowadzany) | `src/lib/staff-identity.ts:14-17`; `20260803134535:12-16` |
| N-07 | **Do zamówienia wolno dołożyć wyłącznie pozycje dostępne** (niedostępna/wyprzedana/zarchiwizowana — nigdy) | Business Logic `prd.md:199-200`; AC US-01 `prd.md:92` |
| N-08 | **Klient dokłada pozycje wyłącznie do OTWARTEGO rachunku swojego stolika; zamknięcie przez personel nieodwracalnie odcina edycję i kończy sesję stolika** | FR-015 `prd.md:166-167`; FR-019 `prd.md:170-171`; Business Logic `prd.md:201-208` |
| N-09 | Status pozycji zamówienia przechodzi wyłącznie `nowe → w toku → zrealizowane`, per pozycja | FR-014 `prd.md:164-165` |
| N-10 | Anonimowa sesja jest ściśle przypisana do jednego stolika; zamówienia stolików się nie mieszają | guardrail `prd.md:77-78`; `prd.md:229-232` |
| N-11 | Klient widzi wyprzedaną pozycję (ale jej nie zamówi); niedostępnej i zarchiwizowanej nie widzi wcale | FR-007 `prd.md:144-145`; AC US-01 `prd.md:92` |

## KROK 2 — Klasyfikacja i wybór #1

Osie: (a) rdzeniowość dla sensu produktu (Kryterium sukcesu #1 = „pełna pętla zamówienia
end-to-end" `prd.md:58-60`; wedge = QR wiążący sesję ze stolikiem `roadmap.md:23-25`),
(b) rozsmarowanie po warstwach, (c) realne egzekwowanie.

| ID | (a) rdzeniowość | (b) rozsmarowanie | (c) egzekwowanie |
| --- | --- | --- | --- |
| N-01 | guardrail #1 | celowo wszędzie (RLS na każdej tabeli) | **egzekwowany** (RLS + `supabase/tests/rls_isolation.sql`) |
| N-02 | rdzeniowy (trwałość QR) | 1 miejsce | **egzekwowany strukturalnie** (`20260727120000:189-190`) |
| N-03 | supporting | 1 miejsce | **egzekwowany** (`tables_company_number_idx` `20260727120000:160`) |
| N-04 | rdzeniowy pośrednio | 1 trigger | **egzekwowany** (`20260803134535:22-38`) |
| N-05 | supporting | policy + trigger | **egzekwowany** (`20260727220415:81-140`) |
| N-06 | supporting (skutek złamania nieodwracalny) | 3 pliki deklaracji, 1 realna zapora (schemat API `src/lib/schemas/staff.ts:65-67`) | **deklarowany** — brak triggera DB |
| **N-07** | **rdzeń** — wejście reguły biznesowej PRD | pole `availability` istnieje w 3 warstwach (enum DB `20260708124756:15`, zod `src/lib/schemas/menu.ts:43`, typ+etykiety `src/types.ts:4-12`), ale **brama zamawialności — nigdzie** | **naruszalny/nieistniejący** |
| **N-08** | **rdzeń rdzenia** — to jest treść sekcji Business Logic i Kryterium sukcesu #1 | zero kodu; reguła żyje w 4 miejscach prozy (`prd.md:166-171,187-208`; `roadmap.md:189,202-209`) i jednym odroczeniu w komentarzu DB (`20260705215147:10`) | **nieistniejący**; roadmapa sama nazywa ryzyko: „błąd w tej regule albo psuje dokładanie pozycji (FR-015), albo pozwala edytować zamknięte zamówienie" `roadmap.md:209` |
| N-09 | rdzeń (pętla statusów) | zero kodu | **nieistniejący** |
| N-10 | rdzeń (wedge) | zero kodu; odroczony wprost: „True per-table session isolation arrives with orders in S-08" `20260705215147:10` | **nieistniejący** |
| N-11 | rdzeń ścieżki klienta | żył w polityce RLS, **usuniętej** (`20260813010000:60`); dziś tylko komentarz-projekt `20260813010000:48-52` | **deklarowany historycznie** |

**Wybór #1: N-08 (z N-07 i N-09 jako nieodłącznymi warunkami tej samej maszyny stanów).**

Sformułowanie robocze niezmiennika:

> **Pozycja trafia do zamówienia wyłącznie wtedy, gdy rachunek jej stolika jest OTWARTY
> i pozycja jest DOSTĘPNA; status pozycji przechodzi tylko `nowe → w toku →
> zrealizowane`; zamknięcie rachunku jest jawną akcją personelu i nieodwracalnie
> odcina dalsze dokładanie oraz edycję klienta.**

Uzasadnienie: to jedyny niezmiennik, który maksymalizuje obie osie naraz — jest
dosłownie definicją sukcesu produktu (`prd.md:58-60`) i jednocześnie nie egzekwuje go
nic (żadna tabela, żaden route, żaden typ). „Refaktor" ma tu szczególny sens
prewencyjny: roadmapa dzieli ten jeden model na **cztery slice'y i trzech aktorów**
(S-08 klient, S-09 statusy/zamknięcie, S-10 kelner, S-11 kuchnia — `roadmap.md:49-52`),
a obowiązujący w repo wzorzec „guard w każdym route + RLS" (`src/lib/api.ts:26-28`)
przy czterech slice'ach wyprodukuje **cztery niezależne kopie reguły**. RLS nie uratuje:
polityka wierszowa nie wyrazi warunku między-wierszowego „rodzic-otwarty i pozycja-dostępna".
Agregat trzeba zaprojektować ZANIM powstanie pierwszy route S-08 — potem będzie to
klasyczny refaktor rozsmarowanej reguły.

## KROK 3 — Diagnoza: gdzie reguła żyje dziś

**Warstwa dokumentów (jedyne miejsce pełnej reguły):**

- Wejścia/wyjścia reguły i aktorzy: `prd.md:193-203` („zbiór pozycji, które wolno
  dołożyć do zamówienia (tylko dostępne), stan otwarte / zamknięte całego rachunku
  stolika…").
- Otwarty rachunek + odcięcie po zamknięciu: FR-015 `prd.md:166-167`, FR-019
  `prd.md:170-171`.
- Maszyna stanów pozycji: FR-014 `prd.md:164-165`.
- Izolacja sesji stolika: `prd.md:77-78`.

**Warstwa persystencji — istnieją wyłącznie WEJŚCIA reguły, nie reguła:**

- `menu_items.availability` (enum, `20260708124756:15,93-94`) — stan istnieje, ale
  nic go nie konsumuje jako bramy: jedyny zapis to pełna edycja pozycji przez
  właściciela (`src/pages/api/menu/items/[id].ts:44-56`, pole `availability` :51),
  wbrew FR-007 niedostępna dla kelnera (RLS `menu_items_update_owner`
  `20260708124756:129-135`; trasa `/menu` w `OWNER_ROUTES` `src/middleware.ts:13`).
- Połowa N-11 była zakodowana w polityce `menu_items_anon_read_visible`
  (`20260708124756:103-109` — „sold_out stays visible (FR-007)…") i została świadomie
  **usunięta** (`20260813010000:60`); docelowy kształt istnieje wyłącznie jako komentarz
  (`20260813010000:48-52`).
- Tożsamość stolika i jego trwałość (podłoże sesji): `20260705215147:15-22`,
  `20260727120000:160,189-190` — egzekwowane, ale to fundament pod niezmiennik, nie on sam.
- DB **jawnie odracza** resztę: „True per-table session isolation arrives with orders
  in S-08" `20260705215147:10`.

**Warstwa API/serwisu:** brak jakiegokolwiek route'u zamówień (grep
`orders|order_item|zamówien` po `src/` — zero trafień domenowych). Obowiązujący wzorzec
guardów jest per-route i per-zasób (`guardMenuRequest`/`guardStaffRequest`
`src/lib/api.ts:29-95`) — bez zmiany podejścia reguła zostanie skopiowana do każdego
przyszłego route'u zamówień.

**Warstwa UI:** nie istnieje; jedyne „ślady" to marketing (`src/components/Welcome.astro:87-89`)
i etykiety dostępności (`src/types.ts:8-12`). Ryzyko wzorcowe do uprzedzenia: w naiwnym
S-08 strażnikiem bramy dostępności byłby wyłącznie disabled przycisk w React —
klient HTTP ominąłby go jednym curlem.

**Połykanie błędów:** brak dziś kodu do połykania, ale repo ma udokumentowany negatywny
precedens dokładnie tej klasy („Collapsing a failed lookup into `false` used to swallow
the error and mislabel an infra failure" — `src/lib/api.ts:97-101`) oraz pozytywny wzór
fail-fast do naśladowania (trigger → `errcode 42501` → jawne 403, `src/lib/api.ts:158-163`).

**Wniosek diagnozy:** niezmiennik nie ma dziś ŻADNEGO strażnika; jego wejścia są
rozproszone w 3 warstwach; plan dostarczania (4 slice'y, 3 aktorów) gwarantuje
rozsmarowanie, jeśli właściciel reguły nie powstanie wcześniej.

## KROK 4 — Projekt agregatu-strażnika: `TableOrder` (rachunek stolika)

Zasada: **agregat decyduje, RPC wykonuje atomowo, trigger jest zaporą strukturalną** —
trzy warstwy, jedna reguła, jedne nazwy błędów. To rozszerzenie idiomu repo („RLS is
the real enforcement; this gives the UI fast, friendly JSON errors" `src/lib/api.ts:26-28`)
o brakujący środek: moduł domenowy.

### 4.1 Granica agregatu

- **Root:** `TableOrder` — otwarty/zamknięty rachunek JEDNEGO stolika.
- **Encje wewnętrzne:** `OrderItem` (pozycja rachunku ze statusem).
- **Poza granicą:** `MenuItem` (osobny agregat; do rachunku wchodzi jako **snapshot**
  nazwy i ceny — rozliczenie `prd.md:168-169` nie może się zmieniać, gdy właściciel
  edytuje menu w trakcie posiłku; założenie do potwierdzenia, patrz Open Questions),
  `RoomTable` (referencja przez id), sesja klienta (aktor, nie stan agregatu).
- **Twardy warunek jednoznaczności:** co najwyżej JEDEN otwarty rachunek per stolik —
  to niezawodne domknięcie „zamówienia różnych stolików się nie mieszają" po stronie
  zapisu.

### 4.2 Model aktora

```ts
// src/lib/domain/table-order.ts (nowy moduł, czysty — bez I/O)
export type OrderActor =
  | { kind: "client"; tableId: string }                    // anonimowa sesja stolika (token z S-07/S-08)
  | { kind: "staff"; userId: string; role: StaffRole };    // z context.locals (src/middleware.ts:49-86)
```

Uprawnienia aktorów wynikają wprost z PRD Access Control (`prd.md:215-232`):
klient — tylko `addItem` i tylko na własnym stoliku; kelner/właściciel — wszystko;
kuchnia — wyłącznie `advanceItem` (`prd.md:223-224`: „Nie edytuje menu ani zamówień").

### 4.3 Nazwane błędy domenowe (fail-fast, nigdy cicha aktualizacja)

```ts
export type OrderDomainErrorCode =
  | "ORDER_CLOSED"                    // dokładanie/edycja po zamknięciu (N-08)
  | "ORDER_ALREADY_CLOSED"            // powtórne zamknięcie
  | "ITEM_UNAVAILABLE"                // pozycja niedostępna/wyprzedana/zarchiwizowana (N-07)
  | "ILLEGAL_ITEM_STATUS_TRANSITION"  // np. done -> new (N-09)
  | "SESSION_TABLE_MISMATCH"          // sesja klienta ≠ stolik rachunku (N-10)
  | "FORBIDDEN_ACTOR"                 // np. klient prowadzi statusy, kuchnia zamyka
  | "TABLE_HAS_OPEN_ORDER"            // próba otwarcia drugiego otwartego rachunku
  | "TABLE_INACTIVE";                 // otwarcie rachunku na zdezaktywowanym stoliku

export class OrderDomainError extends Error {
  constructor(readonly code: OrderDomainErrorCode) { super(code); }
}
```

### 4.4 Metody domenowe (sygnatury + pseudokod preconditions)

```ts
export const ORDER_ITEM_STATUSES = ["new", "in_progress", "done"] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];
// Jedyne legalne przejścia (N-09). Zamknięta lista — brak przejść wstecz w MVP.
const ITEM_TRANSITIONS: Record<OrderItemStatus, OrderItemStatus[]> = {
  new: ["in_progress"], in_progress: ["done"], done: [],
};

export class TableOrder {
  // fabryka: pierwszy dodany element otwiera rachunek (ścieżka klienta S-08);
  // kelner może też otworzyć jawnie pusty (S-10)
  static open(table: { id: string; isActive: boolean }, actor: OrderActor): TableOrder {
    if (!table.isActive) throw new OrderDomainError("TABLE_INACTIVE");
    // unikalność "jeden otwarty per stolik" domyka warstwa DB (indeks częściowy);
    // repozytorium tłumaczy 23505 na TABLE_HAS_OPEN_ORDER
    ...
  }

  addItem(menuItem: MenuItemSnapshot, quantity: number, actor: OrderActor): OrderItemDraft {
    this.assertOpen();                                   // -> ORDER_CLOSED
    this.assertActorMayEdit(actor);                      // klient: kind==="client" && actor.tableId===this.tableId
                                                         //   -> SESSION_TABLE_MISMATCH / FORBIDDEN_ACTOR (kuchnia)
    if (menuItem.archivedAt !== null
        || menuItem.availability !== "available")        // sold_out widoczna ≠ zamawialna (N-07/N-11)
      throw new OrderDomainError("ITEM_UNAVAILABLE");
    return { menuItemId, nameSnapshot, priceSnapshot, quantity, status: "new" };
  }

  advanceItem(itemId: string, to: OrderItemStatus, actor: OrderActor): void {
    this.assertOpen();                                   // -> ORDER_CLOSED
    if (actor.kind !== "staff") throw new OrderDomainError("FORBIDDEN_ACTOR"); // klient nie prowadzi statusów
    const item = this.itemOrThrow(itemId);
    if (!ITEM_TRANSITIONS[item.status].includes(to))
      throw new OrderDomainError("ILLEGAL_ITEM_STATUS_TRANSITION");
    item.status = to;
  }

  close(actor: OrderActor): void {                       // FR-019: jawna akcja personelu
    if (actor.kind !== "staff" || actor.role === "kitchen")
      throw new OrderDomainError("FORBIDDEN_ACTOR");
    if (this.status === "closed") throw new OrderDomainError("ORDER_ALREADY_CLOSED");
    this.status = "closed";                              // odcina edycję klienta i kończy sesję stolika
  }
}
```

### 4.5 Persystencja: schemat + zapora strukturalna (wzorce już obecne w repo)

```sql
-- migracja: YYYYMMDDHHmmss_orders_aggregate.sql (szkic)
create type public.order_status      as enum ('open', 'closed');
create type public.order_item_status as enum ('new', 'in_progress', 'done');

create table public.orders (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  table_id   uuid not null,
  status     public.order_status not null default 'open',
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  uuid references public.profiles (user_id),
  -- composite FK wzorem 20260728120000_room_tables_composite_fk.sql:
  -- rachunek nie wskaże stolika innej firmy nawet przy błędzie aplikacji
  foreign key (company_id, table_id) references public.tables (company_id, id)
);
-- N-08/N-10 strukturalnie: jeden otwarty rachunek per stolik
create unique index orders_one_open_per_table on public.orders (table_id) where status = 'open';

create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete restrict,
  company_id     uuid not null references public.companies (id) on delete cascade,
  menu_item_id   uuid not null references public.menu_items (id) on delete restrict,
  name_snapshot  text not null,
  price_snapshot numeric(10, 2) not null,
  quantity       int not null check (quantity > 0),
  status         public.order_item_status not null default 'new',
  added_by_staff uuid references public.profiles (user_id),  -- null = klient (sesja anonimowa)
  created_at     timestamptz not null default now()
);
```

Triggery-zapory (lustrzane do `guard_profile_self_change` `20260727220415:112-140` —
chronią nawet przed przyszłym niechlujnym route'em albo zapisem kluczem service-role):

```sql
-- 1) wiersz zamówienia: jedyne legalne przejście open -> closed; zamknięty = zamrożony
create function public.guard_order_transition() ... -- raise 'ORDER_ALREADY_CLOSED' / 42501-style errcode
-- 2) pozycje: INSERT/UPDATE/DELETE dozwolone tylko, gdy rodzic 'open' (N-08)
create function public.guard_order_items_parent_open() ... -- raise 'ORDER_CLOSED'
-- 3) pozycje: status tylko new->in_progress->done (N-09)
create function public.guard_order_item_status() ...       -- raise 'ILLEGAL_ITEM_STATUS_TRANSITION'
-- 4) pozycje: INSERT tylko gdy menu_item dostępny i niezarchiwizowany (N-07)
--    (sprawdzenie w tym samym stmt/transakcji co insert — brak okna TOCTOU)
create function public.guard_order_item_available() ...    -- raise 'ITEM_UNAVAILABLE'
```

### 4.6 Atomowe komendy (JEDNA transakcja) — wzorem `reorder_*` RPC

Precedens: `20260717093000:1-8` wprost dokumentuje, dlaczego wielokrokowe operacje
z Workera są wadliwe (partial failure + subrequest cap). Każda komenda agregatu to
jedna funkcja SQL = jedna transakcja, z blokadą wiersza rachunku:

```sql
create function public.order_add_item(p_table_id uuid, p_menu_item_id uuid, p_quantity int)
returns public.order_items
language plpgsql security invoker set search_path = ''
as $$
declare v_order public.orders; v_item public.menu_items;
begin
  -- (1) znajdź-lub-otwórz otwarty rachunek stolika i ZABLOKUJ go (for update):
  --     równoległe close() poczeka; po jego commicie ten insert widzi 'closed' i pada
  select * into v_order from public.orders
    where table_id = p_table_id and status = 'open' for update;
  if not found then
    -- stolik musi być aktywny (TABLE_INACTIVE); wyścig dwóch pierwszych dodań
    -- rozstrzyga orders_one_open_per_table (23505 -> retry-lookup w tej samej funkcji)
    insert into public.orders (company_id, table_id) ... returning * into v_order;
  end if;
  if v_order.status <> 'open' then raise exception 'ORDER_CLOSED' using errcode = 'P0001'; end if;
  -- (2) brama dostępności w TEJ transakcji (N-07)
  select * into v_item from public.menu_items
    where id = p_menu_item_id and company_id = v_order.company_id
      and archived_at is null and availability = 'available';
  if not found then raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001'; end if;
  -- (3) snapshot nazwy i ceny
  insert into public.order_items (order_id, company_id, menu_item_id,
                                  name_snapshot, price_snapshot, quantity)
    values (v_order.id, v_order.company_id, v_item.id, v_item.name, v_item.price, p_quantity)
    returning *;
end $$;

create function public.order_close(p_order_id uuid) returns public.orders ...;
  -- for update; już 'closed' -> raise 'ORDER_ALREADY_CLOSED'; set closed_at/closed_by
create function public.order_advance_item(p_item_id uuid, p_to public.order_item_status)
  returns public.order_items ...;  -- for update na rodzicu; nielegalne przejście -> raise
```

RLS na `orders`/`order_items`: personel — `company_id = current_company_id()` (odczyt
cały personel; INSERT/UPDATE przez RPC: kelner+właściciel, statusy także kuchnia);
**żadnej polityki `to anon `** — ścieżka klienta idzie przez funkcje związane z tokenem
sesji stolika (S-07), zgodnie z lekcją i projektem w `20260813010000:48-52` oraz
`lessons.md:15-21`. DELETE: brak polityki (rachunek się zamyka, nie znika — spójnie
z „deactivate, never delete" na `tables`).

### 4.7 Repozytorium i cienkie route'y

```ts
// src/lib/order-repo.ts — jedyne miejsce zapytań o rachunek
export const tableOrderRepo = {
  loadOpenByTable(supabase, tableId): Promise<TableOrder | null>,  // orders + order_items jednym selectem
  addItem(supabase, cmd): Promise<OrderItem>,      // rpc("order_add_item", ...)
  advanceItem(supabase, cmd): Promise<OrderItem>,  // rpc("order_advance_item", ...)
  close(supabase, orderId): Promise<Order>,        // rpc("order_close", ...)
  // tłumaczenie błędów DB -> OrderDomainError: message 'ORDER_CLOSED'|... oraz
  // 23505 na orders_one_open_per_table -> TABLE_HAS_OPEN_ORDER
};
```

Route jest wyłącznie transportem (wzorem `src/pages/api/menu/items/[id].ts:17-31`):

```ts
// POST /api/orders/items (klient i personel; aktor z sesji/tokena)
const guard = guardOrderRequest(context, { actor });        // sibling guardMenuRequest (api.ts:29-52)
const body  = await parseBody(context, orderItemInputSchema);
try {
  const order = await tableOrderRepo.loadOpenByTable(...);
  TableOrder.fromRows(order).addItem(item, qty, actor);     // decyzja agregatu (szybki, nazwany błąd)
  return jsonData(await tableOrderRepo.addItem(...));       // egzekucja atomowa (autorytatywna przy wyścigu)
} catch (e) {
  return mapOrderDomainError(e);                            // ORDER_CLOSED->409, ITEM_UNAVAILABLE->422,
}                                                           // FORBIDDEN_ACTOR/SESSION_TABLE_MISMATCH->403
```

Egzekucja przenosi się w całości na serwer: UI (przyszłe S-08/S-09/S-11) tylko
odzwierciedla odmowy — disabled na `sold_out` to ergonomia, nie strażnik.

## KROK 5 — Before/after, fazy, testy, nazwy

### Before → after (każde dzisiejsze miejsce reguły)

| Miejsce dziś | Before | After |
| --- | --- | --- |
| Brama dostępności | `availability` to bierne pole edycji menu (`src/pages/api/menu/items/[id].ts:51`) i etykieta UI (`src/types.ts:8-12`); nic nie wiąże jej z zamawialnością | precondition `TableOrder.addItem` + trigger `guard_order_item_available` + check w `order_add_item` (jedna transakcja) |
| Widoczność `sold_out` dla klienta (N-11) | reguła żyła w usuniętej polityce `20260708124756:103-109` → `20260813010000:60`; dziś tylko komentarz `:48-52` | poza agregatem (ścieżka odczytu): funkcja-projekcja SECURITY DEFINER `public_menu(venue_code)` wg projektu z `20260813010000:48-52`; agregat egzekwuje komplementarne „widoczna ≠ zamawialna" |
| Otwarte/zamknięte + odcięcie klienta | wyłącznie proza `prd.md:166-171,201-208` | `orders.status` + `close()` + `guard_order_transition` + `guard_order_items_parent_open` |
| Maszyna statusów pozycji | wyłącznie proza `prd.md:164-165` | `ORDER_ITEM_STATUSES`/`ITEM_TRANSITIONS` (jedno źródło w module domeny) + trigger `guard_order_item_status` |
| Izolacja sesja↔stolik | proza `prd.md:77-78`; DB odracza (`20260705215147:10`) | aktor `client.tableId` + composite FK `(company_id, table_id)` + `orders_one_open_per_table`; token sesji — zależność od S-07 |
| Wzorzec strażnika | guard per-route, reguła skopiowałaby się do 4 slice'ów (`roadmap.md:49-52`) | jeden moduł `table-order.ts` + trzy RPC; route'y S-08/S-09/S-10/S-11 wołają te same metody z różnym aktorem |

### Fazy refaktoru

Repo ma dyscyplinę test-first (`/10x-tdd`) i trzy runnery: `npm run test` (unit,
DB-free), `npm run test:integration` (lokalny Supabase), `npm run test:rls:local`
(suita SQL) — `AGENTS.md` §Build/Test. Mutacje: Stryker selektywnie na modułach
ryzyka (`CLAUDE.md` §Mutation testing).

1. **F0 — moduł domeny (test-first, unit):** `src/lib/domain/table-order.ts` czysty
   (bez I/O). Czerwone testy z listy poniżej → implementacja → refactor. Bez migracji.
2. **F1 — migracja (test-first na suicie RLS):** tabele, enumy, indeks częściowy,
   4 triggery, 3 RPC; asercje w `supabase/tests/rls_isolation.sql` (izolacja firm,
   default-deny anon, nielegalne operacje **rzucają**, nie no-opują) — wzorem
   istniejącej suity.
3. **F2 — repozytorium + mapowanie błędów (test-first, integration):** przypadki
   współbieżne (close vs addItem na zablokowanym wierszu; wyścig dwóch pierwszych
   dodań o otwarcie rachunku).
4. **F3 — cienkie route'y** dla aktorów wg slice'ów roadmapy (S-08 klient, S-09
   statusy+zamknięcie, S-10 kelner, S-11 kuchnia); e2e ścieżki klienta przez
   `/10x-e2e` po zbudowaniu UI.
5. **F4 — Stryker** zawężony do `src/lib/domain/table-order.ts` (rdzeń ryzyka);
   przegląd ocalałych mutantów per polityka `CLAUDE.md`.

Zależność otwarta: mechanizm tokenu anonimowej sesji należy do S-07/S-08 — F0–F2 są
od niego niezależne (aktor `client` to wejście, nie implementacja tokenu).

### Przypadki testowe niezmiennika

Legalne: dodanie dostępnej pozycji do otwartego rachunku (klient przy własnym stoliku;
kelner; właściciel) · pierwszy `addItem` otwiera rachunek na aktywnym stoliku ·
`new→in_progress`, `in_progress→done` (kelner, kuchnia) · `close` otwartego rachunku
przez kelnera/właściciela · dodanie pozycji, gdy inne pozycje są `done` (FR-015:
statusy kuchenne nie blokują dokładania, `prd.md:167`).

Nielegalne (każde = nazwany błąd, operacja zatrzymana, stan nietknięty):
`addItem` po `close` → `ORDER_CLOSED` (także w wyścigu: close commituje pierwszy) ·
`addItem` pozycji `sold_out`/`unavailable`/zarchiwizowanej → `ITEM_UNAVAILABLE` ·
klient z sesją stolika A dokłada do rachunku stolika B → `SESSION_TABLE_MISMATCH` ·
klient prowadzi statusy / zamyka → `FORBIDDEN_ACTOR` · kuchnia dodaje/zamyka →
`FORBIDDEN_ACTOR` · `done→new`, `new→done` → `ILLEGAL_ITEM_STATUS_TRANSITION` ·
powtórne `close` → `ORDER_ALREADY_CLOSED` · drugi otwarty rachunek tego samego stolika
→ `TABLE_HAS_OPEN_ORDER` (23505 na indeksie częściowym) · otwarcie na nieaktywnym
stoliku → `TABLE_INACTIVE` · cross-tenant: `order_add_item` na pozycję innej firmy →
`ITEM_UNAVAILABLE`/0 wierszy pod RLS (asercja w suicie SQL) · edycja `order_items`
zamkniętego rachunku bezpośrednim UPDATE (symulacja niechlujnego route'u) → trigger
rzuca `ORDER_CLOSED`.

### Nowe nazwy load-bearing (do rejestru)

Repo nie prowadzi formalnego rejestru kontraktów; najbliższe odpowiedniki to
`src/types.ts` (lustro schematu) i `context/foundation/lessons.md`. Zarejestrować:

- Typy/moduły: `TableOrder`, `OrderItem`, `OrderActor`, `ORDER_ITEM_STATUSES`,
  `OrderItemStatus`, `OrderDomainError` (+ 8 kodów z §4.3), `tableOrderRepo`,
  `guardOrderRequest`, `mapOrderDomainError`.
- SQL: `public.orders`, `public.order_items`, enumy `order_status` /
  `order_item_status`, indeks `orders_one_open_per_table`, RPC `order_add_item` /
  `order_close` / `order_advance_item`, triggery `guard_order_transition` /
  `guard_order_items_parent_open` / `guard_order_item_status` /
  `guard_order_item_available`.
- Wpis do `lessons.md` po F1: „Niezmienniki między-wierszowe egzekwuj w agregacie +
  RPC + triggerze, nie w route'ach" (uogólnienie precedensu `reorder_*`).

### Open Questions (decyzje właściciela produktu, nieblokujące F0–F2)

1. **Snapshot ceny/nazwy pozycji** — przyjęte jako założenie projektowe (rozliczenie
   `prd.md:168-169` nie powinno dryfować przy edycji menu); PRD nie rozstrzyga wprost.
2. **Korekty statusów wstecz** (pomyłka kuchni: `done→in_progress`) — PRD podaje tylko
   przejścia w przód (`prd.md:164-165`); MVP: brak przejść wstecz, korekta = nowa pozycja.
3. **Jawne otwarcie pustego rachunku przez kelnera** (S-10) vs wyłącznie implicit przy
   pierwszej pozycji — projekt dopuszcza oba, roadmapa zdecyduje w S-10.
