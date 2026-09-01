<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: UI Redesign — "Karta / bistro"

- **Plan**: context/changes/ui-redesign/plan.md
- **Scope**: Fazy 1–5 z 5 (pełny plan), commity c7f8c39..fc76257 (baza 1e13e81)
- **Date**: 2026-08-28
- **Verdict**: REJECTED at review → po triage APPROVED (F1+F2 FIXED 2026-08-28, grepy bez filtra czyste, lint/typecheck/unit/build zielone)
- **Findings**: 1 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING — jedno pominięcie (F1); poza nim wierność wyjątkowa: dyscyplina dwóch commitów (047cd35→bb1e9d6, 4925e69→eeb3ab6) zweryfikowana, wszystkie tokeny/triple/mapy/nagłówki tam, gdzie plan kazał; 4 zadeklarowane adaptacje potwierdzone jako zasadne (neutralizacja `@custom-variant dark` wręcz poprawniejsza niż planowane usunięcie) |
| Scope Discipline | PASS — negative space trzyma (Banner.astro nietknięty, jedyna nowa zależność to @fontsource, tabular-nums tylko w wierszu menu, brak zmian tras/layoutu); wtrącone commity 772b5c6 (E2E, m3l4) i cf3e1c8 (hooki, m3l3) to odrębne zmiany |
| Safety & Quality | FAIL — F1 (niewidoczne wyposażenie sali na białej kanwie) |
| Architecture | PASS |
| Pattern Consistency | PASS — cn()/class:list wszędzie, bracketed cn() w mapach; 2 obserwacje kosmetyczne (F3, F4) |
| Success Criteria | FAIL — kryteria 3.7 i 4.6 odhaczone, a literalnie fałszywe: wpis `wall` w room-object-visuals.ts łamie oba grepy (plik .ts poza filtrem `--include="*.astro" --include="*.tsx"`) |

Kryteria automatyczne odtworzone przy przeglądzie: lint exit 0, typecheck 0 errors, unit 177/177, integration 237/237, build Complete. Matematyka kontrastów w global.css przeliczona niezależnie — wszystkie zapisane wartości dokładne; tinty bez zapisu policzone: destructive/10 nad porcelaną 4.67:1 (podłoga, F2), primary/10–20 7.0–8.5:1, warning-eyebrow 6.17:1, EmptyState 6.22:1.

## Findings

### F1 — room-object-visuals.ts ominął każdą fazę: ciemna mapa na białej kanwie

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality + Success Criteria (+ Plan Adherence: MISSING surface)
- **Location**: src/components/room/room-object-visuals.ts:34-46
- **Detail**: `ROOM_OBJECT_STYLES` — 9 rodzajów wyposażenia (wall/chair/door/window/bar/plant/stairs/toilet/till) — wciąż nosi ciemne literały (`border-white/25 bg-white/20 text-white/70`; pastele `*-100/70` na `*-500/15`). RoomCanvas od Fazy 3 jest białą kartą (`RoomCanvas.tsx:115`), a `DraggableRoomObject.tsx:217` maluje te style na niej: ściana biała-na-białym (~1.5:1), ikony nieczytelne — wyposażenie funkcjonalnie niewidoczne. Stale komentarz „Muted next to the purple tables… dark theme". Przyczyna pominięcia: plik `.ts` poza cenzusem planu („32 z 45 plików .astro/.tsx") i poza filtrami rozszerzeń wszystkich grepów weryfikacyjnych — przez co odhaczone 3.7 i 4.6 są fałszywe.
- **Fix**: Przełączyć 9 wpisów na tokeny semantyczne (ten sam ruch co DraggableTable: neutral dla ściany/mebli, info/warning/success tam, gdzie kind niesie odcień), zaktualizować komentarz pliku, powtórzyć grepy 3.7/4.6 bez filtra rozszerzeń, dopisać adnotację korygującą przy 3.7/4.6 w Progress.
- **Decision**: FIXED (2026-08-28) — mapa przełączona na triple semantyczne (identity z ikon, tint grupuje), komentarz zaktualizowany, grepy 3.7/4.6 powtórzone bez filtra rozszerzeń (czyste), adnotacje korygujące dopisane w Progress.

### F2 — Najciaśniejsza para kontrastu bez zapisanej noty

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; fix oczywisty i wąski
- **Dimension**: Safety & Quality
- **Location**: src/styles/global.css (--destructive)
- **Detail**: `text-destructive` na `bg-destructive/10` nad porcelaną komponuje się do 4.67:1 — AA przechodzi z zapasem 0.17 przy tekście `text-sm` (ErrorPanel, ServerError, baner błędu settings). Plik obiecuje „re-run the math if any value changes", a ta para-podłoga nie jest zapisana.
- **Fix**: Jedna linia komentarza przy `--destructive`: „on destructive/10 over porcelain 4.67:1 — floor pair; don't lighten the colour or the tint".
- **Decision**: FIXED (2026-08-28) — nota o parze-podłodze dopisana przy --destructive w global.css.

### F3 — PascalCase ErrorPanel/EmptyState w katalogu vendorowanych prymitywów

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/ErrorPanel.tsx, src/components/ui/EmptyState.tsx
- **Detail**: ui/ jest umownie zarezerwowane dla shadcn (lowercase, „add via npx shadcn add", komentarz w global.css mówi o „vendored code we do not edit"). Casing akurat odróżnia „nasze" od „vendorowanych", ale granica katalogu się rozmywa.
- **Fix**: Udokumentować konwencję w AGENTS.md albo przenieść do components/shared/ — nieblokujące.
- **Decision**: SKIPPED — casing celowo odróżnia własne komponenty od vendorowanych; konwencja do AGENTS.md przy innej okazji.

### F4 — index.astro dostał tytuł mimo „no copy changes except Welcome"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline
- **Location**: src/pages/index.astro:6
- **Detail**: `<title>` to metadane w duchu kryterium 5.7 (landing opisuje OrderLY); dryf zadeklarowany w komunikacie commitu ef1e48b.
- **Fix**: Żaden — odnotowane jako świadomy mikro-dryf.
- **Decision**: ACCEPTED — świadomy mikro-dryf w duchu kryterium 5.7.
