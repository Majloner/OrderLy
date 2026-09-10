---
title: "OrderLY — ACL dla przeciekającego kontraktu Supabase Storage (zdjęcia menu)"
created: 2026-09-05
type: refactor-plan
---

# Plan refaktoru: warstwa antykorupcyjna wokół magazynu zdjęć menu

> Plan, nie implementacja. Każdy cytat `plik:linia` zweryfikowany na `main`
> (2026-09-05). Kontynuacja: `context/domain/01-domain-distillation.md`,
> `context/domain/02-invariant-aggregate-refactor.md`.

## KROK 0 — Kontekst

**Stack:** Astro 6 SSR + React 19 islands + Supabase + Cloudflare Workers
(`AGENTS.md`). Zależności zewnętrzne: `package.json:27-56` — kluczowe dla tej analizy:
`@supabase/ssr` (:40), `@supabase/supabase-js` (:41), `@sentry/astro` + `@sentry/cloudflare`
(:38-39), `browser-image-compression` (:46), `zod` (:56), `@dnd-kit/*` (:32-34).

**Deklaracje wymienialności w dokumentach:**

- `OrderLY-MVP.md:14` — „**Alternatywa (rozdzielone usługi):** frontend na
  Vercel/Netlify, backend na Railway/Render, **zdjęcia na Cloudflare R2 lub AWS S3**,
  baza PostgreSQL u dowolnego dostawcy."
- `OrderLY-MVP.md:15` — Supabase rekomendowane „na potrzeby projektu certyfikacyjnego"
  (sygnał tymczasowości).
- `context/foundation/tech-stack.md:38-40` — odstępstwo #2 wprost zostawia wybór
  otwarty: „Generowanie miniatur (FR-005) zrobimy przez **Supabase Storage transforms /
  Cloudflare Images**".
- `context/foundation/roadmap.md:140-142` — S-04 Unknown: „Ścieżka generowania miniatur
  na edge (sharp nie działa na workerd) — **Supabase Storage transforms czy Cloudflare
  Images?** — Owner: **TBD**".

Czyli: baza + auth zostały w `tech-stack.md:28-33` świadomie przybite do Supabase
(spójny stack, RLS jako guardrail), ale **dostawca magazynu/przetwarzania zdjęć jest
formalnie nierozstrzygnięty w trzech dokumentach** — to najmocniejszy rozjazd
intencja-vs-kod do sprawdzenia.

**Warstwy kodu:** migracje SQL (persystencja) → `src/lib` (serwisy/guardy) →
`src/pages/api` (API) → `src/pages/*.astro` (SSR UI) → `src/components/**` (React
islands — bundle przeglądarki) → wire (JSON DTO między nimi).

## KROK 1 — Zidentyfikowane przecieki zależności

| # | Zależność | Sygnał przecieku | Zasięg |
| --- | --- | --- | --- |
| Z-1 | `@supabase/supabase-js` (PostgREST query builder) | jeden SDK wołany w ~24 route'ach przez `locals.supabase` (`src/env.d.ts:9`); wiedza o SQLSTATE Postgresa w warstwie API: `isUniqueViolation` (23505) / `isInsufficientPrivilege` (42501) `src/lib/api.ts:154-163`, `isForeignKeyViolation` (23503) `src/lib/room-api.ts:55-57`, konsumowane w 10 route'ach (m.in. `src/pages/api/menu/items/[id].ts:59`, `src/pages/api/staff/index.ts:112-117`); zapytania `.from()` także w warstwie SSR-UI: `src/pages/staff.astro:16`, `src/pages/settings.astro:15-16` | 4 warstwy, 30+ plików |
| Z-2 | `@supabase/ssr` + GoTrue (auth) | typ `User` biblioteki w kontrakcie aplikacji `App.Locals` (`src/env.d.ts:3`); konwencja nazw cookie `sb-*-auth-token` odtwarzana ręcznie w `src/middleware.ts:105-107`; semantyka błędów GoTrue (status 0/5xx vs 4xx) w `src/middleware.ts:38-48`; kształt błędu `email_exists` + regex na message w `src/lib/staff-admin.ts:37-42` | middleware + typy globalne + 2 moduły lib |
| Z-3 | **Kontrakt Supabase Storage dla zdjęć menu** (schemat URL publicznych obiektów, bucket, warianty, multipart signed-upload) | serwerowy szczegół vendora zrekonstruowany **w bundlu przeglądarki**; `supabaseUrl` prop-drillowany przez 4 komponenty React; surowe `photo_path`/`photo_updated_at` w wire-DTO wymuszają na kliencie znajomość vendor-URL | 4 warstwy + wire + browser, 10 plików (pełna lista w KROKU 3) |
| Z-4 | `@sentry/astro` + `@sentry/cloudflare` | ten sam SDK po obu stronach granicy klient/serwer (`package.json:38-39`; commit `36942bd` „Sentry … for browser and worker") | cross-cutting **z założenia** (telemetria) — nie domena |
| Z-5 | `zod` | schematy na granicach (`src/lib/schemas/*`) | wzorzec zamierzony (`tech-stack.md:31-32`), nie przeciek |
| Z-6 | `@dnd-kit/*`, `radix-ui`, `browser-image-compression` | wyłącznie warstwa UI; `browser-image-compression` importowane dynamicznie w jednym pliku (`src/lib/images.ts:19`) | izolowane |

## KROK 2 — Klasyfikacja i wybór #1

| Oś | Z-1 PostgREST | Z-2 GoTrue | **Z-3 Storage (zdjęcia)** | Z-4 Sentry |
| --- | --- | --- | --- | --- |
| (a) warstwy/pliki | 4 / 30+ | 3 / 5 | **4 + wire + browser / 10** | 2 / kilka |
| (b) koszt wymiany dziś | ogromny — ale wymiana nie jest intencją | duży | **średni, rosnący z każdym slice'em UI** | mały |
| (c) dokumenty deklarują wymienialność | nie — `tech-stack.md:28-33` świadomie przybija bazę+RLS do Supabase (RLS to guardrail izolacji, `AGENTS.md` Hard rules) | nie | **TAK, w 3 dokumentach** (`OrderLY-MVP.md:14`, `tech-stack.md:38-40`, `roadmap.md:140-142` — Owner: TBD) | nie dotyczy |

**Wybór #1: Z-3 — kontrakt Supabase Storage dla zdjęć menu.**

Uzasadnienie:

1. **Jedyny przeciek z żywą deklaracją wymienialności.** Dla bazy i auth dokumenty
   świadomie wybrały Supabase (RLS jest architekturą egzekwowania izolacji — owijanie
   PostgREST w repozytoria walczyłoby z fundamentem, nie z przeciekiem). Dla zdjęć
   dokumenty w trzech miejscach mówią „dostawca do wyboru / Owner: TBD" — a kod tymczasem
   wkompilował kontrakt Supabase Storage w przeglądarkę.
2. **Najgroźniejszy kierunek przecieku.** Schemat URL serwerowej platformy
   (`/storage/v1/object/public/...`) i kształt multipart signed-uploadu są
   zaimplementowane w kodzie wysyłanym do przeglądarki klienta (`src/lib/images.ts:38-58`)
   — dokładnie sygnał „biblioteka serwerowa wciągana do bundla klienta".
3. **Przecieka też przez kontrakt wire.** `GET /api/menu` zwraca surowe
   `photo_path`/`photo_updated_at` (`MenuPayload`/`MenuItem`, `src/types.ts:71-82`),
   więc KAŻDY konsument API (przyszłe publiczne menu QR w S-08!) musi znać layout
   magazynu vendora, żeby w ogóle pokazać zdjęcie.
4. **Rośnie.** S-08 (publiczne menu klienta) będzie renderować te same miniatury —
   bez ACL prop `supabaseUrl` i `publicPhotoUrl` skopiują się do drugiego drzewa UI.

## KROK 3 — Diagnoza: kto dziś „zna" kontrakt Storage

**Pełna lista plików (before):**

| Plik | Co wie o vendorze |
| --- | --- |
| `src/lib/storage.ts:1,12,18,30-31,45` | import SDK; nazwa bucketa `menu-photos`; warianty `full.webp`/`thumb.webp`; `createSignedUploadUrl`/`remove` |
| `src/lib/images.ts:5,38-46,50-58` | druga kopia nazwy bucketa (`:5` — i trzecia, zahardkodowana w stringu URL `:56`); **schemat URL publicznego obiektu** `${supabaseUrl}/storage/v1/object/public/menu-photos/...` (`:56`); **kształt multipart signed-uploadu odtworzony ręcznie** — „Mirrors storage-js uploadToSignedUrl's multipart body" (`:35-41`), nagłówek `x-upsert` (`:42`); konwencja cache-bust `?v=` (`:57`) |
| `src/pages/menu.astro:4,19` | wyciąga `SUPABASE_URL` z env serwera i **wstrzykuje do island przeglądarki** |
| `src/components/menu/MenuManager.tsx:19,33,120-121,248,265,290` | `putSignedBlob` (vendor-upload z przeglądarki); prop-drilling `supabaseUrl` w dół drzewa |
| `src/components/menu/MenuItemRow.tsx:6,26,31,37-38` | buduje vendor-URL z surowych pól wiersza (`publicPhotoUrl(supabaseUrl, item.photo_path, "thumb", item.photo_updated_at)`) |
| `src/components/menu/MenuItemDialog.tsx:17,41,51,68,83,88,115-116,146,149` | j.w. + orkiestracja uploadu |
| `src/components/menu/CategorySection.tsx:12,23` | czysty przekaźnik propa `supabaseUrl` (nie używa go do niczego własnego) |
| `src/pages/api/menu/items/[id]/photo.ts:27,57,69` | konwencja ścieżki `{company_id}/{id}` budowana inline w route; sprzątanie obiektów vendora |
| `src/pages/api/menu/items/[id]/photo-url.ts:40,45` | j.w. + kształt odpowiedzi `{ full: { signedUrl }, thumb: { signedUrl } }` przenoszący pojęcie vendora („signed URL") do wire |
| `src/types.ts:71-75` | typ domenowy dokumentuje layout magazynu: „full/thumb objects live at `${photo_path}/full.webp` …" — layout vendora w kontrakcie typów współdzielonym przez UI |

**Duplikacja (ta sama wiedza, N kopii):** nazwa bucketa ×3 (`storage.ts:12`,
`images.ts:5`, `images.ts:56`); warianty `full.webp`/`thumb.webp` ×4 (`storage.ts:30-31`,
`storage.ts:45`, `images.ts:56`, komentarz `types.ts:72`); konwencja ścieżki
`{company_id}/{item_id}` ×4 (`types.ts:71`, `photo.ts:27`, `photo.ts:69`,
`photo-url.ts:40`); orkiestracja full+thumb ×3 (`storage.ts:29-32`, `MenuManager.tsx:120-121`,
`MenuItemDialog.tsx:146`).

**Rozjazd intencja-vs-kod:** dokumenty deklarują wymienialność dostawcy zdjęć
(`OrderLY-MVP.md:14`; `tech-stack.md:38-40`; `roadmap.md:140-142`), a wymiana na
Cloudflare R2/Images wymagałaby dziś edycji: 3 komponentów React, strony `.astro`,
dwóch modułów lib, dwóch route'ów i kontraktu wire — czyli wszystkich warstw naraz.

**Klient jako strażnik / cichy błąd:** przeglądarka komponuje URL bez wiedzy, czy
obiekt istnieje (złożenie `photo_path` + konwencja); `removePhotoObjects` jest
best-effort z połykanym rezultatem (`storage.ts:39-45` zwraca `void`, `photo.ts:68-69`
nie sprawdza) — akceptowalne dla sprzątania, ale to decyzja, która powinna być
zakodowana w jednym miejscu, nie rozproszona.

## KROK 4 — Projekt ACL

Katalog ACL: **`src/lib/photo-storage/`** — po refaktorze JEDYNE miejsce w repo
znające vendora magazynu zdjęć.

### 4.1 Value object: `MenuPhoto` (domena, zero vendora)

```ts
// src/lib/photo-storage/menu-photo.ts
// Jedyne miejsce wiedzy o TOŻSAMOŚCI zdjęcia: czyj jest (tenant), którego bytu
// dotyczy, która wersja. Prefiks company_id to reguła DOMENOWA (autoryzacja po
// ścieżce — serwer buduje, klient nie sfałszuje; dziś w komentarzu storage.ts:8-9),
// więc należy do VO, nie do adaptera.
export type PhotoVariant = "full" | "thumb";
export const PHOTO_VARIANTS: readonly PhotoVariant[] = ["full", "thumb"];

export class MenuPhoto {
  private constructor(readonly companyId: string, readonly itemId: string,
                      readonly version: Date | null) {}

  static forItem(companyId: string, itemId: string): MenuPhoto;          // nowe zdjęcie
  static fromRow(row: { company_id; id; photo_path; photo_updated_at }): MenuPhoto | null;
  // mapowanie DO persystencji — photo_path zostaje w DB jako neutralny klucz bazowy
  toRowPatch(): { photo_path: string; photo_updated_at: string };        // `${companyId}/${itemId}`
  static clearedRowPatch(): { photo_path: null; photo_updated_at: null };
  baseKey(): string;                                                     // `${companyId}/${itemId}`
  cacheToken(): string | null;                                           // Date.parse(version)
}

// DTO wire — GOTOWE dane dla UI, żadnego składania URL po stronie klienta:
export interface MenuPhotoUrls { thumb: string; full: string }
```

### 4.2 Wąski port

```ts
// src/lib/photo-storage/port.ts — reszta kodu zna WYŁĄCZNIE ten interfejs
export interface UploadTicket { url: string }        // nieprzezroczysty dla konsumenta
export interface UploadTickets { full: UploadTicket; thumb: UploadTicket }

export interface MenuPhotoStorage {
  /** czysta funkcja: publiczne URL-e wariantów (vendor-scheme tylko w adapterze) */
  publicUrls(photo: MenuPhoto): MenuPhotoUrls;
  /** bilety na upload full+thumb; null = magazyn nieskonfigurowany */
  mintUploadTickets(photo: MenuPhoto): Promise<UploadTickets | null>;
  /** sprzątanie obiektów; decyzja "best-effort, nie blokuje operacji" jest
      zakodowana TUTAJ (dziś rozproszona: storage.ts:39-45 + photo.ts:68-69) */
  removeObjects(photo: MenuPhoto): Promise<void>;
}
```

### 4.3 Adapter Supabase (server) + wykonawca uploadu (browser)

```ts
// src/lib/photo-storage/supabase-adapter.ts — JEDYNY importer
// @supabase/supabase-js dla Storage; jedyne wystąpienia w repo:
//  - bucketa "menu-photos",
//  - wariantów `${base}/full.webp` / `${base}/thumb.webp`,
//  - schematu URL `${SUPABASE_URL}/storage/v1/object/public/<bucket>/<key>?v=<token>`,
//  - createSignedUploadUrl / remove i klucza service-role
//    (lekcja "Storage nie honoruje tokenu użytkownika" — lessons.md:34-53 —
//    zostaje zakodowana w adapterze, a nie w komentarzach route'ów).
export function supabaseMenuPhotoStorage(): MenuPhotoStorage { ... }

// src/lib/photo-storage/upload-client.ts (browser) — druga połowa ACL:
// jedyne miejsce znające KSZTAŁT żądania uploadu (dziś images.ts:35-46 odtwarza
// multipart storage-js + nagłówek x-upsert). Konsument (React) widzi tylko:
export async function uploadPhotoVariants(
  tickets: UploadTickets, blobs: { full: Blob; thumb: Blob }, signal?: AbortSignal,
): Promise<void>;  // rzuca PhotoUploadFailedError(status)
```

`resizeForUpload` (WebP w przeglądarce, `browser-image-compression`) jest
vendor-neutralne — zostaje w `src/lib/images.ts`; z tego pliku znikają
`putSignedBlob` i `publicPhotoUrl`.

### 4.4 Kontrakt wire po zmianie (UI dostaje dane domenowe)

`MenuItem` (DTO z `GET /api/menu` i route'ów items) zamiast surowych
`photo_path`/`photo_updated_at` niesie wynik portu:

```ts
export interface MenuItem { ...; photo: MenuPhotoUrls | null }   // src/types.ts
```

Serwer (route) składa: `photo: p ? storage.publicUrls(p) : null`. React renderuje
`item.photo?.thumb` — **żadnego `supabaseUrl` w propsach, żadnego składania URL**.
Odpowiedź `photo-url.ts` zwraca `UploadTickets` (nieprzezroczyste), nie
„signedUrl" z nazwy vendora.

### 4.5 Cienkie route'y

```ts
// POST /api/menu/items/[id]/photo-url  (bez zmian autoryzacji: guardMenuRequest)
const photo = MenuPhoto.forItem(guard.companyId, id);
const tickets = await storage.mintUploadTickets(photo);
return tickets ? jsonData(tickets) : jsonError("Nie udało się przygotować przesyłania zdjęcia", 500);

// PUT /api/menu/items/[id]/photo — patch wiersza przez VO, nie inline string:
.update(MenuPhoto.forItem(guard.companyId, id).toRowPatch())
// DELETE — .update(MenuPhoto.clearedRowPatch()); await storage.removeObjects(photo)
```

## KROK 5 — Dowód izolacji + before/after

**Wymiana dostawcy (np. Cloudflare R2 + Images, wariant z `OrderLY-MVP.md:14` /
`tech-stack.md:39-40`) dotyka wyłącznie:**

- `src/lib/photo-storage/r2-adapter.ts` (nowy: presigned PUT, inny schemat URL),
- `src/lib/photo-storage/upload-client.ts` (raw PUT zamiast multipart — dlatego
  wykonawca uploadu JEST częścią ACL),
- konfiguracji (sekrety/wiring adaptera).

**Nie dotyka:** migracji i kolumn (`photo_path` zostaje neutralnym kluczem bazowym
`{company_id}/{item_id}`), kontraktu wire (`MenuPhotoUrls` i `UploadTickets` są
vendor-agnostyczne), żadnego komponentu React, żadnej strony `.astro`, żadnego
route'u API, walidacji `photoUploadRequestSchema` (`src/lib/schemas/menu.ts:59-71`
— limity i WebP to nasza decyzja produktowa, nie vendora).

**Before → after:**

| Miejsce | Before | After |
| --- | --- | --- |
| `src/lib/images.ts:50-58` | `publicPhotoUrl(supabaseUrl, path, variant, version)` — vendor-URL w przeglądarce | funkcja usunięta; URL przychodzi gotowy w `item.photo` |
| `src/lib/images.ts:38-46` | ręczna rekonstrukcja multipart storage-js | przeniesione do `photo-storage/upload-client.ts` (ACL) |
| `src/pages/menu.astro:4,19` | `SUPABASE_URL` z env wstrzykiwany do island | prop znika; strona nie zna vendora |
| `MenuItemRow.tsx:37-38`, `MenuItemDialog.tsx:115-116` | komponent składa URL z 3 surowych kawałków | `item.photo?.thumb` — gotowa dana domenowa |
| `CategorySection.tsx:12,23`, `MenuManager.tsx:33,248,265,290` | prop-drilling `supabaseUrl` przez warstwy, które go nie używają | prop usunięty z całego drzewa |
| `photo.ts:27,57,69`, `photo-url.ts:40` | konwencja `{company_id}/{id}` inline ×3 + import `storage.ts` | `MenuPhoto.toRowPatch()/baseKey()` + port |
| `src/lib/storage.ts` | moduł luzem, bucket+warianty+SDK | treść wchłonięta przez `supabase-adapter.ts`; plik znika |
| `src/types.ts:71-75` | typ domenowy dokumentuje layout obiektów vendora | `photo: MenuPhotoUrls \| null`; layout zna tylko adapter |

**Otwarte pytania zależne od kontraktu biblioteki — rozstrzygnięcie:**

`roadmap.md:140-142` (S-04 Unknown, Owner: TBD): „Supabase Storage transforms czy
Cloudflare Images?" — kod już to de facto rozstrzygnął **trzecią drogą**, ale nie
odnotował: warianty produkuje przeglądarka, bo „sharp does not run on workerd and
Supabase image transforms require a paid plan" (`src/lib/images.ts:1-3`). Decyzję
kodujemy w ACL: adapter przyjmuje GOTOWE warianty (nie transformuje), a kontrakt
portu (`mintUploadTickets` dla pary full+thumb) czyni ją jawną. Wpis unknownu w
roadmapie zamknąć adnotacją „rozstrzygnięte: warianty client-side; decyzja
zakodowana w src/lib/photo-storage/". Gdyby przyszła zmiana na Cloudflare Images
(transformacja po stronie dostawcy), zmienia się wyłącznie adapter: `publicUrls`
zwraca URL-e z parametrami transformacji, `mintUploadTickets` przyjmuje jeden oryginał.

## KROK 6 — Weryfikacja i plan faz

**Kryterium sukcesu (grep):** po refaktorze następujące wzorce zwracają wyłącznie
`src/lib/photo-storage/**`:

```bash
grep -rn "menu-photos\|storage/v1\|createSignedUploadUrl\|x-upsert\|supabaseUrl\|publicPhotoUrl\|putSignedBlob" src
```

(poza `src` wolno im występować w: `supabase/migrations/20260722100000_menu_photos_bucket_limits.sql`
— definicja bucketa jest z natury adapterowa/vendorowa — oraz w `context/`).

| Plik | Zna vendora dziś | Po refaktorze |
| --- | --- | --- |
| `src/lib/storage.ts` | tak | plik usunięty (→ adapter) |
| `src/lib/images.ts` | tak (`:5,38-46,50-58`) | **nie** (zostaje tylko neutralny resize) |
| `src/pages/menu.astro` | tak (`:4,19`) | **nie** |
| `src/components/menu/MenuManager.tsx` | tak | **nie** |
| `src/components/menu/MenuItemRow.tsx` | tak | **nie** |
| `src/components/menu/MenuItemDialog.tsx` | tak | **nie** |
| `src/components/menu/CategorySection.tsx` | tak | **nie** |
| `src/pages/api/menu/items/[id]/photo.ts` | tak | **nie** (VO + port) |
| `src/pages/api/menu/items/[id]/photo-url.ts` | tak | **nie** (port) |
| `src/types.ts` | tak (`:71-75`) | **nie** (`MenuPhotoUrls`) |
| `src/lib/photo-storage/{menu-photo,port}.ts` | — | nie (czysta domena) |
| `src/lib/photo-storage/{supabase-adapter,upload-client}.ts` | — | **tak — jedyne** |

**Plan faz (konwencja projektu: `/10x-new` → `/10x-plan` → `/10x-implement`;
runnery `npm run test` / `test:integration` / `test:e2e` — `package.json:14-18`;
test-first tam, gdzie logika czysta):**

1. **F0 (test-first, unit):** `menu-photo.ts` (VO: fromRow/toRowPatch/baseKey/
   cacheToken) + `port.ts` + `supabase-adapter.ts` z czystym `publicUrls`
   (testowalne bez sieci). Stare moduły nietknięte — brak regresji.
2. **F1 (integration):** route'y `photo.ts`/`photo-url.ts` przechodzą na VO+port;
   DTO **addytywnie** zyskuje `photo: MenuPhotoUrls | null` obok starych pól
   (jedna faza kompatybilności wire).
3. **F2 (UI):** komponenty na `item.photo`; usunięcie prop-drillingu `supabaseUrl`,
   `publicPhotoUrl`, importu `SUPABASE_URL` z `menu.astro`; `putSignedBlob` →
   `upload-client.ts`. Weryfikacja wizualna istniejącym harnessem
   (`npm run test:visual`, `package.json:18`).
4. **F3 (cięcie):** usunięcie `photo_path`/`photo_updated_at` z wire-DTO (kolumny
   DB zostają), kasacja `storage.ts`, grep-weryfikacja kryterium sukcesu w CI/hooku.
5. **F4 (zapis wiedzy):** wpis do `context/foundation/lessons.md` („kontrakt vendora
   magazynu żyje wyłącznie w ACL; UI dostaje gotowe URL-e") + zamknięcie unknownu
   w `roadmap.md:140-142` + reguła dla S-08: publiczne menu QR konsumuje
   `MenuPhotoUrls`, nigdy surowe ścieżki.

**Zakres świadomie odłożony (nie-cele tego ACL):** Z-1 (PostgREST/RLS to
architektura egzekwowania izolacji — `AGENTS.md` Hard rules — nie przeciek do
owijania; higiena SQLSTATE jest już połowicznie scentralizowana w
`src/lib/api.ts:154-163`) oraz Z-2 (GoTrue w middleware) — z dwiema tanimi
rekomendacjami na później: przenieść wiedzę o cookie `sb-*` (`middleware.ts:105-107`)
do `src/lib/supabase.ts` (już jedyne miejsce tworzenia klienta) i zastąpić typ
`User` w `App.Locals` (`env.d.ts:3`) własnym, wąskim typem sesji.
