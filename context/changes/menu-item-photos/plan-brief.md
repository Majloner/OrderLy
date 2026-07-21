# Menu Item Photos (S-04) — Plan Brief

> Full plan: `context/changes/menu-item-photos/plan.md`
> Research: `context/changes/menu-item-photos/research.md`

## What & Why

Właściciel dodaje zdjęcie potrawy do pozycji menu, a system pokazuje miniaturę na liście pozycji
(PRD US-02, FR-005). Zdjęcia sprzedają menu i przyspieszają budowę atrakcyjnej karty — metryka PRD to
≥80% pozycji ze zdjęciem, przy szybkim ładowaniu na telefonie klienta.

## Starting Point

S-03 (`menu-items-management`) dostarczył model `menu_items` i wyspę `/menu` z dialogiem pozycji. Nie ma
kolumny zdjęcia, żadnego kodu Storage ani toru uploadu — `menu_items` rozszerzymy przez ALTER, a Storage
zbudujemy od zera. Runtime to Cloudflare Workers (workerd): `sharp` nie działa, a Supabase image transforms
są tylko na planie Pro — więc miniatury muszą powstawać w przeglądarce.

## Desired End State

W dialogu pozycji właściciel wybiera zdjęcie, widzi podgląd miniatury i po zapisie ma je na liście. Może je
podmienić (natychmiastowe odświeżenie) lub usunąć. Oryginał + miniatura leżą w publicznym buckecie Supabase
Storage; kelner/kuchnia i anon nie mogą zapisywać (Storage RLS). Menu klienta (S-08) będzie mogło czytać
zdjęcia z publicznego CDN.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Generowanie miniatur | Client-side (`browser-image-compression` → WebP) | `sharp` nie działa na workerd; Supabase transforms = Pro/$25; jedyna droga $0 | Research |
| Storage | Publiczny bucket `menu-photos`, ścieżki `{company_id}/{item_id}/{full,thumb}.webp` | Anon menu (S-08) czyta z CDN; ścieżki UUID rename-proof | Research |
| Upload | Signed upload URL z owner-guarded route; bajty omijają Workera | RLS sprawdzany przy mincie tokenu; budżet 10ms CPU nietknięty | Research |
| Storage RLS | Owner-write scoped by `company_id`; brak anon SELECT | Domyka lekcję anon-RLS (brak listingu); odczyt po ścieżce przez CDN | Research |
| Kształt danych | Jedna kolumna `photo_path` (+ `photo_updated_at`) | Najchudsze; full/thumb wyprowadzane konwencją | Plan |
| Wymiary/jakość | thumb 400px / full 1600px, WebP q~0.8 | Szybka lista na mobile przy dobrym detalu | Plan |
| UX uploadu | Podgląd przed zapisem; upload przy zapisie pozycji | Jeden atomowy zapis, brak obiektów-sierot | Plan |
| Walidacja | Allow-list content-type (webp) + limit rozmiaru przy mincie signed URL | Tanie, serwerowe, bez bajtów przez Workera | Plan |
| Cache-bust | `?v=<epoch(photo_updated_at)>`, ścieżka stabilna | Natychmiastowe odświeżenie po podmianie, bez sierot | Plan |
| Archiwizacja | Zostaw obiekty; kasuj tylko przy jawnym „usuń zdjęcie" | Archiwizacja odwracalna, zdjęcia tanie | Plan |

## Scope

**In scope:** migracja (kolumny `photo_path`/`photo_updated_at`, bucket, Storage RLS, test izolacji),
endpoint signed upload URL + walidacja, rozszerzenie schematu/typu/endpointów pozycji, „usuń zdjęcie",
util resize client-side, picker+podgląd w dialogu, miniatura w wierszu z cache-bustem.

**Out of scope:** serwerowe/edge transformy (sharp/Supabase Pro/CF Images), menu klienta/anon widok (S-08),
wiele rozmiarów / re-crop, kadrowanie w kliencie, zawężenie anon-read tabel menu (S-07/S-08), job sprzątający
sieroty.

## Architecture / Approach

Backend-first (wzorem S-03): (1) migracja domenowa + bucket + Storage RLS + test; (2) endpoint signed
upload URL + pole `photo_path` w JSON pipeline + „usuń zdjęcie" + Vitest; (3) UI z resize w przeglądarce.
Jedyny binarny hop to browser → Storage (signed URL); wiersz `menu_items` nadal jedzie istniejącym JSON
PUT/POST. RLS (wiersz + Storage) to egzekucja właściwa; guard w route to warstwa UX.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fundament danych + Storage | migracja: kolumny + bucket + Storage RLS + test izolacji | polityki `storage.objects` + bucket na żywej bazie |
| 2. API + walidacja | endpoint signed upload URL, pole `photo_path`, „usuń zdjęcie", Vitest | poprawny kontrakt signed-URL + allow-list, spójność z JSON pipeline |
| 3. UI `/menu` | resize client-side, picker+podgląd, miniatura + cache-bust | pamięć na mobile przy dużych zdjęciach; orientacja EXIF |

**Prerequisites:** S-03 (`menu-items-management`) done; Supabase CLI zlinkowane; przegląd diffu przed `db push`.
**Estimated effort:** ~2–3 sesje w 3 fazach.

## Open Risks & Assumptions

- Miniatura tylko po stronie klienta = brak serwerowego źródła prawdy dla rozmiarów; dodanie nowych
  rozmiarów później wymaga re-uploadu (oryginał zostaje w Storage, więc przejście na transformy jest addytywne).
- Ceny/plany chmur zmienne — research flaguje re-weryfikację „Supabase transforms = Pro" i „CF Images 5k/mc free"
  gdyby kiedyś wracać do transformów.
- Publiczny bucket: świadomy trade-off (zdjęcia jawne, ale brak listingu bez polityki anon SELECT).
- Duże zdjęcia z telefonu mogą obciążyć pamięć karty — mityguje `maxWidthOrHeight` + web-worker.

## Success Criteria (Summary)

- Właściciel dodaje/podmienia/usuwa zdjęcie pozycji, miniatura pojawia się na liście bez przeładowania.
- Kelner/kuchnia i anon nie mogą zapisywać obiektów (Storage RLS + 403), dowiedzione przez `npm run test:rls`.
- `npm test`, `npm run typecheck`, `npm run build`, `npm run lint` przechodzą.
