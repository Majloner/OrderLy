# Menu Item Photos (S-04) Implementation Plan

## Overview

Właściciel dodaje zdjęcie potrawy do pozycji menu; system generuje miniaturę pokazywaną na liście
pozycji (PRD US-02, FR-005). Miniatura powstaje **w przeglądarce** (bo `sharp` nie działa na workerd),
a oryginał + miniatura trafiają do **publicznego bucketu Supabase Storage** przez **signed upload URL**
wystawiany przez owner-guarded route Astro. Na wierszu `menu_items` przechowujemy `photo_path` (referencja)
i `photo_updated_at` (cache-bust). Priorytet: $0 / free tier — bez płatnych transformów obrazów.

## Implementation Deviations (post-hoc)

> Added during `/10x-impl-review`. The Phase 2/3 "Changes Required" text below describes the
> originally-planned upload mechanism, which changed during implementation. Authoritative record:
> commit `880e882` and `context/foundation/lessons.md`.

- **Storage auth**: Supabase Storage does not honor the user JWT for RLS in this project, so signing
  upload URLs and removing objects moved to a **server-side service-role client** (`src/lib/storage.ts`),
  authorized by the endpoint (owner guard + `itemExistsInCompany` + server-built path). This supersedes
  the plan's "Out of scope: service-role client" line and the user-token/`uploadToSignedUrl` approach.
- **Photo mechanism**: `photo_path` is NOT carried through `menuItemInputSchema`/`items` routes; a
  dedicated `POST/PUT/DELETE /api/menu/items/[id]/photo(-url)` route owns it, and `photoUploadRequestSchema`
  validates the mint request. The browser PUTs blobs via a raw `putSignedBlob`.
- **Bucket enforcement**: migration `20260722100000` adds `file_size_limit` + `allowed_mime_types` to the
  bucket (real server-side upload constraint; the zod caps alone are advisory).
- **Dev tooling**: `resolve.dedupe: ["react","react-dom"]` added to `astro.config.mjs` to fix a dev-server
  duplicate-React error (unrelated to S-04 feature scope).

## Current State Analysis

- **`menu_items` (S-03) nie ma kolumny zdjęcia** — rozszerzamy przez ALTER (konwencja „nigdy nie
  re-CREATE", `supabase/migrations/20260708124756_menu_categories_items.sql:76`). Nowa nullable kolumna
  nie ma zależności od polityk/enumów, więc bez sekwencji „odpięcia zależności".
- **Brak jakiegokolwiek kodu Storage** — żadnego bucketu, uploadu ani multipart. `parseBody`
  (`src/lib/api.ts:63`) i `callMenuApi` (`src/components/hooks/useMenu.ts:11`) są JSON-only.
- **Anon read pozycji już pokryty** — polityka `menu_items_anon_read_visible` robi `select *` dla `anon`
  (`...20260708124756...:106`), więc nowa kolumna jest automatycznie widoczna dla przyszłego menu klienta (S-08).
- **Owner write pozycji już pokryty** — `menu_items_update_owner`/`insert_owner`
  (`...20260708124756...:123`) gated na `current_company_id()` + rola owner. Zapis `photo_path` przez
  istniejący PUT jest objęty tymi politykami.
- **Klient SSR ma tylko klucz anon** (`src/lib/supabase.ts`) w `context.locals.supabase`
  (`src/middleware.ts`) — brak service-role. Cała ścieżka musi działać pod RLS.
- **`sharp` nie działa na workerd**; **Supabase image transforms są tylko na planie Pro (~$25/mc)** —
  oba wykluczają serwerowe generowanie miniatur na free tier (`context/foundation/infrastructure.md:84,123`;
  `supabase/config.toml:125`). Miniatura musi powstać po stronie klienta.
- Lekcja `context/foundation/lessons.md`: „Anon RLS reads must be scoped by company_id" — pogodzona dla
  Storage przez **brak polityki anon SELECT** (patrz Krytyczne szczegóły).

## Desired End State

Właściciel na `/menu` w dialogu pozycji wybiera zdjęcie; przeglądarka tworzy miniaturę (400px) i wersję
pełną (1600px) w WebP, pokazuje podgląd, a po zapisaniu wgrywa oba obiekty do Storage i zapisuje
`photo_path`. Lista pozycji pokazuje miniaturę. Właściciel może usunąć zdjęcie. Kelner/kuchnia i anon nie
mogą zapisywać obiektów (Storage RLS). Menu klienta (S-08) będzie mogło czytać zdjęcia z publicznego CDN.

Weryfikacja: `npm run test:rls` (rozszerzony o Storage), `npm test`, `npm run build`, `npm run typecheck`,
`npm run lint`, oraz manualny przebieg dodania/podmiany/usunięcia zdjęcia na `/menu`.

### Key Discoveries:

- Kolumna zdjęcia: ALTER wzorem `supabase/migrations/20260708124756_menu_categories_items.sql:76`
- Helpery tenancy do Storage RLS: `current_company_id()` / `current_staff_role()` —
  `supabase/migrations/20260705212949_tenancy_core.sql`
- Ścieżka obiektu: `storage.foldername(name)[1]` = `company_id` (segment ścieżki)
- Model wiersza→typ: `MenuItem` w `src/types.ts:59` jest lustrem kolumn DB
- Explicit allow-list insert/update: `src/pages/api/menu/items.ts:33`, `.../items/[id].ts:38`
- Signed upload: RLS INSERT sprawdzany w momencie mintowania URL, token związany ze ścieżką
- Pełne tło: `context/changes/menu-item-photos/research.md`

## What We're NOT Doing

- **Serwerowe/edge generowanie miniatur** (`sharp`, Supabase transforms, Cloudflare Images) — świadomie
  poza zakresem pod priorytet $0. Zostawiamy oryginał w Storage, więc przyszłe przejście na transformy
  jest addytywne (osobny slice).
- **Menu klienta / anon widok zdjęć** — to S-08; tu tylko zapisujemy dane i publiczny bucket.
- **Wiele responsywnych rozmiarów / re-crop on-the-fly** — jeden rozmiar miniatury + jeden pełny.
- **Zawężenie anon-read po `company_id` na tabelach menu** — dług z lekcji, adresowany w S-07/S-08.
- **Kadrowanie/edycja zdjęcia w kliencie** (crop, filtry) — tylko resize/kompresja.
- **Service-role client / job sprzątający sieroty** — poza MVP.

## Implementation Approach

Backend-first, wzorem S-03: (1) migracja domenowa (kolumny) + bucket + Storage RLS + test izolacji;
(2) endpoint signed upload URL + rozszerzenie schematu/typu/endpointów pozycji + „usuń zdjęcie" + Vitest;
(3) UI: resize w kliencie, picker+podgląd w dialogu, miniatura w wierszu, cache-bust. Jedyny binarny hop
to browser → Storage (signed URL); wiersz nadal jedzie JSON-owym pipelinem S-03. RLS (wiersz + Storage)
jest egzekucją właściwą; guard w route to warstwa UX.

## Critical Implementation Details

- **Storage RLS bez anon SELECT.** Publiczny bucket serwuje obiekty po dokładnej ścieżce UUID przez CDN,
  ale **listing** obiektów przechodzi przez RLS. Nie tworzymy polityki `for select to anon` — to domyka
  lekcję „anon reads scoped by company_id" na warstwie Storage (brak enumeracji). Odczyt zdjęć przez
  `getPublicUrl` to czysty builder stringa, nie listing.
- **RLS sprawdzany przy mintowaniu signed URL.** `createSignedUploadUrl` wykonuje politykę INSERT w
  kontekście zalogowanego ownera i wiąże token z konkretną ścieżką — dlatego aplikacja z samym kluczem
  anon egzekwuje izolację najemcy na uploadzie bez service-role. Bajty obrazu **nie przechodzą przez
  Workera** (budżet 10ms CPU / limity subrequestów).
- **EXIF orientation.** Resize przez Canvas zapieka orientację; użyć `browser-image-compression`
  (`preserveExif`/`getExifOrientation`), żeby zdjęcia z telefonu były w poprawnej orientacji.
- **Cache-bust.** Ścieżka obiektu jest stabilna (`upsert`), więc publiczny CDN cache'uje starą wersję po
  podmianie. Render używa `?v=<epoch(photo_updated_at)>`; `photo_updated_at` ustawiane przy każdej zmianie
  zdjęcia.

## Phase 1: Fundament danych + Storage (migracja + bucket + RLS + test)

### Overview

Jedna migracja rozszerza `menu_items` o kolumny zdjęcia, tworzy publiczny bucket `menu-photos` i polityki
`storage.objects` (owner-write scoped by `company_id`, brak anon SELECT). Test izolacji rośnie o asercje
Storage.

### Changes Required:

#### 1. Kolumny zdjęcia na `menu_items`

**File**: `supabase/migrations/<timestamp>_menu_item_photos.sql`

**Intent**: Dodać referencję do zdjęcia i znacznik wersji do cache-bustu, przez ALTER (nie re-CREATE).

**Contract**: `alter table public.menu_items add column photo_path text` (nullable, bez default) oraz
`add column photo_updated_at timestamptz` (nullable). Brak zależności polityk od tych kolumn. Anon read
(`menu_items_anon_read_visible`) i owner write już je pokrywają (są `*`/kolumnowo-agnostyczne).

#### 2. Publiczny bucket `menu-photos`

**File**: ta sama migracja

**Intent**: Utworzyć publiczny bucket na zdjęcia menu (oryginał + miniatura).

**Contract**: `insert into storage.buckets (id, name, public) values ('menu-photos','menu-photos', true)
on conflict (id) do nothing;`. Ścieżki obiektów: `{company_id}/{item_id}/full.webp` oraz `.../thumb.webp`.

#### 3. Polityki `storage.objects` (owner-write, brak anon SELECT)

**File**: ta sama migracja

**Intent**: Tylko właściciel firmy może zapisywać/usuwać obiekty pod prefiksem swojej firmy; brak polityki
anon SELECT (odczyt przez publiczny CDN po ścieżce, bez listingu).

**Contract**: Polityki `menu_photos_insert_owner` / `menu_photos_update_owner` / `menu_photos_delete_owner`
na `storage.objects` `to authenticated`, z predykatem
`bucket_id = 'menu-photos' and (storage.foldername(name))[1] = public.current_company_id()::text and
public.current_staff_role() = 'owner'` (INSERT: `with check`; UPDATE: `using` + `with check`; DELETE:
`using`). Żadnej polityki `for select to anon`. (Pełny szkic SQL: `research.md` Appendix A.)

#### 4. Rozszerzenie testu izolacji o Storage

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: Guardrail pokrywa nowe polityki Storage.

**Contract**: Nowe asercje: (a) owner A może INSERT obiektu pod `A/...`; (b) owner A nie może INSERT pod
prefiksem firmy B; (c) waiter nie może INSERT/DELETE obiektu; (d) rollback po asercjach (wzorem istniejącego
skryptu). Seedy w `storage.objects` z minimalnym metadata.

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto na hosted: `npx supabase db push`
- Test izolacji przechodzi: `npm run test:rls`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Przegląd diffu migracji przed `db push` — statementy zgodne z planem (bucket public, brak anon SELECT)
- W Supabase Studio: bucket `menu-photos` istnieje jako publiczny; polityki widoczne na `storage.objects`

**Implementation Note**: Po tej fazie pauza na manualne potwierdzenie przed przejściem do fazy 2.

---

## Phase 2: API — signed upload URL + pole zdjęcia + „usuń zdjęcie"

### Overview

Endpoint mintujący signed upload URL (owner-only, allow-list content-type + limit rozmiaru) dla full+thumb;
rozszerzenie schematu/typu/endpointów pozycji o `photo_path`; ścieżka usuwania zdjęcia; testy schematu.

### Changes Required:

#### 1. Typ i schemat

**File**: `src/types.ts`, `src/lib/schemas/menu.ts`

**Intent**: Dodać `photo_path` (i `photo_updated_at`) do modelu i pozwolić przenosić `photo_path` przez
istniejący JSON pipeline (string, nie plik).

**Contract**: `MenuItem` dostaje `photo_path: string | null` i `photo_updated_at: string | null`
(`src/types.ts:59`). `menuItemInputSchema` (`src/lib/schemas/menu.ts:17`) dostaje opcjonalne
`photo_path` (string ograniczony do wzorca `{uuid}/{uuid}`, nullish→null — wzorem `description`). Sam plik
nie idzie przez schemat.

#### 2. Endpoint signed upload URL

**File**: `src/pages/api/menu/items/[id]/photo-url.ts`

**Intent**: Owner-only endpoint zwracający signed upload URL-e dla `full.webp` i `thumb.webp` danej pozycji;
RLS INSERT sprawdza się w tym momencie.

**Contract**: `export const prerender = false;` + `POST`. Guard: `guardMenuRequest(context, { write: true })`.
Walidacja: `id` przez `z.uuid()`; body zod z `contentType` (allow-list: `image/webp`) i rozmiarami
(limit np. ≤2 MB full, ≤200 KB thumb). Ownership pozycji: sprawdzić że pozycja należy do firmy (wzorem
`categoryExistsInCompany`, `src/lib/api.ts:58`). Zwraca `{ data: { full: {path, token}, thumb: {path, token} } }`
z `guard.supabase.storage.from('menu-photos').createSignedUploadUrl(path, { upsert: true })`; ścieżki
`{company_id}/{id}/full.webp` i `.../thumb.webp`. Błędy JSON PL (401/403/400/500) jak reszta `/api/menu`.

#### 3. Zapis `photo_path` + `photo_updated_at` w pozycji

**File**: `src/pages/api/menu/items.ts`, `src/pages/api/menu/items/[id].ts`

**Intent**: Przenieść `photo_path` przez istniejący insert/update i ustawić `photo_updated_at` gdy zdjęcie
się zmienia; obsłużyć „usuń zdjęcie".

**Contract**: Dodać `photo_path` do obiektów `.insert({...})` (`items.ts:33`) i `.update({...})`
(`[id].ts:38`). Gdy `photo_path` się zmienia (lub jest ustawiane/na null), ustawić
`photo_updated_at = new Date().toISOString()`. Usunięcie zdjęcia: PUT z `photo_path: null` czyści referencję;
obiekty Storage kasowane osobnym wywołaniem `storage.from('menu-photos').remove([...])` (w tym samym route
lub dedykowanym) — pod polityką owner DELETE. `GET /api/menu` zwraca nowe kolumny bez zmian zapytania.

#### 4. Testy jednostkowe schematu

**File**: `src/lib/schemas/menu.test.ts`

**Intent**: Pokryć walidację `photo_path`.

**Contract**: Nowe przypadki: poprawny `photo_path`; odrzucenie ścieżki spoza wzorca; `null`/brak →
przechodzi jako null. (Vitest, wzorem istniejących testów.)

### Success Criteria:

#### Automated Verification:

- Testy jednostkowe przechodzą: `npm test`
- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Typecheck przechodzi: `npm run typecheck`

#### Manual Verification:

- Smoke: `POST /api/menu/items/[id]/photo-url` bez sesji → 401; jako nie-owner → 403; jako owner →
  zwraca tokeny; content-type spoza allow-listy → 400
- Upload testowego blobu przez zwrócony signed URL kończy się obiektem w buckecie pod `{company_id}/{id}/...`
- PUT pozycji z `photo_path` zapisuje kolumnę i `photo_updated_at`; PUT z `photo_path: null` czyści i kasuje obiekty

**Implementation Note**: Po tej fazie pauza na manualne potwierdzenie przed przejściem do fazy 3.

---

## Phase 3: UI `/menu` — resize w kliencie, picker+podgląd, miniatura

### Overview

Util resize po stronie klienta (`browser-image-compression`), picker z podglądem w `MenuItemDialog`,
miniatura w `MenuItemRow` z cache-bustem, kontrolka „usuń zdjęcie". Upload przy zapisie pozycji.

### Changes Required:

#### 1. Util resize/kompresji

**File**: `src/lib/images.ts` (nowy), `package.json`

**Intent**: Wygenerować w przeglądarce miniaturę (400px) i wersję pełną (1600px) w WebP, z zachowaniem
orientacji EXIF; lazy-load biblioteki (tylko wyspa uploadu).

**Contract**: `browser-image-compression` jako dependency. Funkcja `resizeForUpload(file)` →
`{ full: Blob, thumb: Blob }`, WebP, `maxWidthOrHeight` 1600/400, `initialQuality ~0.8`,
`useWebWorker: true`, `preserveExif: true`. Import dynamiczny (`await import(...)`) wewnątrz handlera, żeby
nie ważyć bundla przeglądania menu.

#### 2. Picker + podgląd w dialogu

**File**: `src/components/menu/MenuItemDialog.tsx`

**Intent**: Dodać wybór pliku z podglądem miniatury; zdjęcie wgrywane przy zapisie (preview-before-save),
z progresem i możliwością usunięcia.

**Contract**: Pole zdjęcia w `MenuItemForm` (obok opisu, `MenuItemDialog.tsx:134`). Stan: wybrany plik /
wygenerowane blob-y / podgląd (objectURL) / istniejące `photo_path`. Na submit: jeśli wybrano nowe zdjęcie
→ `resizeForUpload` → `POST .../photo-url` → `uploadToSignedUrl(path, token, blob)` dla full+thumb →
przekazać `photo_path` do `onSubmit` (który leci istniejącym JSON PUT/POST). Kontrolka „usuń zdjęcie"
ustawia `photo_path: null`. Walidacja rozmiaru/typu przed uploadem; komunikaty błędów PL w dialogu.
Progress/anulowanie przez `onProgress`/`AbortController` biblioteki.

#### 3. Miniatura w wierszu pozycji

**File**: `src/components/menu/MenuItemRow.tsx`, `src/components/hooks/useMenu.ts`

**Intent**: Pokazać miniaturę (lub placeholder) na początku wiersza, z cache-bustem po podmianie.

**Contract**: Na początku wiersza (`MenuItemRow.tsx:52`) `<img>` z `getPublicUrl('menu-photos',
`${photo_path}/thumb.webp`)` + `?v=<epoch(photo_updated_at)>`; gdy brak `photo_path` — neutralny placeholder.
Klient Supabase w przeglądarce (lub złożenie URL publicznego z `SUPABASE_URL`) do zbudowania URL — bez
sekretów po stronie klienta. `useMenu` bez zmian (refetch niesie nowe kolumny).

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Build przechodzi: `npm run build`
- Testy jednostkowe nadal przechodzą: `npm test`
- Typecheck przechodzi: `npm run typecheck`

#### Manual Verification:

- Dodanie zdjęcia do pozycji: podgląd miniatury w dialogu, po zapisie miniatura na liście — bez przeładowania
- Zdjęcie z telefonu (obrócone) wyświetla się w poprawnej orientacji (EXIF)
- Podmiana zdjęcia natychmiast odświeża miniaturę (cache-bust `?v=`)
- Usunięcie zdjęcia znika z listy; obiekty skasowane z bucketu
- Duże zdjęcie (kilka MB) nie zawiesza karty na mobile; progres widoczny
- Nie-owner (podmiana roli) nie dostaje uploadu (403)
- Widok responsywny na mobile (miniatura nie psuje layoutu wiersza)

**Implementation Note**: Po tej fazie pauza na manualne potwierdzenie — zamyka zmianę.

---

## Testing Strategy

### Unit Tests:

- `menuItemInputSchema`: `photo_path` poprawny/niepoprawny/null (`src/lib/schemas/menu.test.ts`)

### Integration Tests:

- `supabase/tests/rls_isolation.sql`: Storage — owner INSERT pod własnym prefiksem OK; cross-company
  INSERT odrzucony; waiter INSERT/DELETE odrzucony

### Manual Testing Steps:

1. Owner dodaje zdjęcie do pozycji → podgląd → zapis → miniatura na liście
2. Podmiana zdjęcia → natychmiastowe odświeżenie (cache-bust)
3. Usunięcie zdjęcia → znika z listy, obiekty skasowane
4. Zdjęcie z telefonu (portret) → poprawna orientacja
5. Konto waiter: `POST .../photo-url` → 403

## Performance Considerations

Resize/kompresja w web-workerze (`useWebWorker`), by nie blokować wątku UI; miniatura 400px WebP trzyma
listę lekką (cel PRD: szybkie menu na mobile). Bajty obrazu omijają Workera (signed URL), więc budżet 10ms
CPU / limity subrequestów nietknięte. Biblioteka resize lazy-load tylko w wyspie uploadu.

## Migration Notes

Migracja idzie na żywą hostowaną bazę (`npx supabase db push` po przeglądzie diffu). Zmiany addytywne:
nowe nullable kolumny + nowy bucket + nowe polityki `storage.objects`. Bez usuwania/zmiany istniejących
kolumn czy polityk. `on conflict do nothing` na buckecie czyni insert idempotentnym.

## References

- Research: `context/changes/menu-item-photos/research.md` (Appendix A: szkic Storage RLS)
- Model wyjściowy S-03: `supabase/migrations/20260708124756_menu_categories_items.sql`
- Helpery tenancy: `supabase/migrations/20260705212949_tenancy_core.sql`
- Wzorzec walidacji własności: `src/lib/api.ts:58` (`categoryExistsInCompany`)
- Infra (workerd/sharp/koszt): `context/foundation/infrastructure.md:82,84,123`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Fundament danych + Storage (migracja + bucket + RLS + test)

#### Automated

- [x] 1.1 Migracja aplikuje się czysto na hosted: `npx supabase db push` — 302c280
- [x] 1.2 Test izolacji przechodzi: `npm run test:rls` — 302c280
- [x] 1.3 Build przechodzi: `npm run build` — 302c280

#### Manual

- [x] 1.4 Przegląd diffu migracji przed `db push` — bucket public, brak anon SELECT — 302c280
- [x] 1.5 W Supabase Studio: bucket `menu-photos` publiczny; polityki na `storage.objects` widoczne — 302c280

### Phase 2: API — signed upload URL + pole zdjęcia + „usuń zdjęcie"

#### Automated

- [x] 2.1 Testy jednostkowe przechodzą: `npm test` — 809256e
- [x] 2.2 Lint przechodzi: `npm run lint` — 809256e
- [x] 2.3 Build przechodzi: `npm run build` — 809256e
- [x] 2.4 Typecheck przechodzi: `npm run typecheck` — 809256e

#### Manual

- [x] 2.5 Smoke `POST .../photo-url`: 401 bez sesji, 403 nie-owner, tokeny dla ownera, 400 dla złego content-type — 880e882
- [x] 2.6 Upload przez signed URL tworzy obiekt pod `{company_id}/{id}/...`; PUT zapisuje `photo_path`+`photo_updated_at`; `photo_path: null` czyści i kasuje obiekty — 880e882

### Phase 3: UI `/menu` — resize w kliencie, picker+podgląd, miniatura

#### Automated

- [x] 3.1 Lint przechodzi: `npm run lint` — 880e882
- [x] 3.2 Build przechodzi: `npm run build` — 880e882
- [x] 3.3 Testy jednostkowe nadal przechodzą: `npm test` — 880e882
- [x] 3.4 Typecheck przechodzi: `npm run typecheck` — 880e882

#### Manual

- [x] 3.5 Dodanie zdjęcia: podgląd w dialogu, miniatura na liście bez przeładowania — 880e882
- [x] 3.6 Zdjęcie z telefonu w poprawnej orientacji (EXIF) — 880e882
- [x] 3.7 Podmiana zdjęcia natychmiast odświeża miniaturę (cache-bust) — 880e882
- [x] 3.8 Usunięcie zdjęcia znika z listy i kasuje obiekty — 880e882
- [x] 3.9 Duże zdjęcie nie zawiesza karty na mobile; progres widoczny — 880e882
- [x] 3.10 Nie-owner nie dostaje uploadu (403) — 880e882
- [x] 3.11 Widok responsywny na mobile — 880e882
