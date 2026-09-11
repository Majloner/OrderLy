# Test-plan refresh po S-05 — Plan Brief

> Full plan: `context/changes/test-plan-refresh-2026-09-11/plan.md`
> Research: `context/changes/test-plan-refresh-2026-09-11/research.md`

## What & Why

`context/foundation/test-plan.md` (last updated 2026-08-04) rozjechał się z repo: S-05
(menu-availability-toggle) dowiózł bramę dostępności, którą §7 nadal deklaruje jako
nieistniejącą, cookbook §6 nie zna pięciu wzorców, które S-05 ustanowił, a §4/§6.3 twierdzą,
że e2e nie istnieje — istnieje. Refresh mechaniczny: zapisujemy rzeczywistość, nie podejmujemy
nowych decyzji strategicznych.

## Starting Point

S-05 zamknięty i zarchiwizowany (`context/archive/2026-09-07-menu-availability-toggle/`),
Faza 4 (AI-native visual) skreślona 2026-09-06, Playwright działa lokalnie (3 specy, setup
2 ownerów, bez CI), suite integration urósł do 20 plików (nowe `contract/`, `menu/`).
Research tej zmiany zmapował wszystko z kotwicami file:line na HEAD `4d679a1`.

## Desired End State

Przyszły autor testu, czytając test-plan, dostaje prawdziwy obraz: jak dopisać staff-write do
macierzy authz, jak asertować trigger kolumnowy (i czym różni się odmowa 0-wierszy od P0001),
jak testować wąski PATCH, jak zweryfikować polling, jak dodać spec Playwright — oraz uczciwą
listę tego, czego celowo nie testujemy.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Zakres edycji | Tylko §4–§8 + nagłówek; §1–§3 bajt-w-bajt | Wywiad pominięty decyzją właściciela — risk map bez przeglądu | Change notes |
| Luka pollingu (weryfikacja dwusesyjna) | Świadome wykluczenie w §7 z warunkiem re-evaluate (S-07) | Była owner-approved kryterium ręcznym fazy 4 + F6 zaakceptowane; promocja do e2e to nowa decyzja, nie refresh | Research → Plan |
| E2E w CI | §5 zapisuje stan „local-only, bez jobu CI"; wpięcie = osobny change | Refresh dokumentuje, nie zmienia infrastruktury | Plan |
| Wiersz AI-native w §4 | Adnotacja „wycofane", wiersz zostaje | Spójne z historiozachowawczym stylem notki o skreśleniu Fazy 4 w §3 | Plan |
| Liczby hot-spotów (brief: 33, unia: 23) | §2 nietknięte; świeże liczby w research.md | §2 poza zakresem; dowód czeka na pełny refresh z wywiadem | Change notes → Research |
| Lekcja F2 (test:integration) | Nowa pułapka w §6.7 | lessons.md już ją kodyfikuje; test-plan musi ją powtórzyć tam, gdzie czyta ją autor fazy | Lessons |

## Scope

**In scope:** §7 (rozszczepienie bulletu S-05/S-07/S-08 + wykluczenie pollingu), §6.4/§6.5/§6.6/§6.7 + nowa §6.8 (wzorce S-05), §6.3 (realny cookbook e2e), §4 (martwe wiersze, wersje, stemple), §5 (wiersz e2e, adnotacja visual), §8 (daty z zastrzeżeniem), nagłówek „Last updated".

**Out of scope:** §1–§3, zmiany CI, nowe testy/kod, wznowienie Fazy 4, automatyzacja weryfikacji dwusesyjnej, edycja lessons.md i archiwum.

## Architecture / Approach

Jeden plik, dwie fazy dla czytelnego review: Faza 1 = substancja (§6/§7 — nowe wzorce),
Faza 2 = księgowość (§4/§5/§6.3/§8). Każdy nowy wiersz cytuje istniejący plik repo
(kotwice zweryfikowane w research.md). Weryfikacja grep-asercjami + prettier + dyscyplina
diffu (§1–§3 nieobecne w hunkach).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. §6 + §7 (substancja) | Cookbook zna wzorce S-05; §7 mówi prawdę | Przegadanie — bullety muszą trzymać ton sekcji, nie streszczać research |
| 2. §4/§5/§6.3/§8 (księgowość) | Stack/gates/e2e/daty zgodne z repo | Przypadkowe naruszenie §1–§3 lub notki o Fazie 4 |

**Prerequisites:** research.md tej zmiany (jest); brak — zmiana docs-only.
**Estimated effort:** 1 sesja, obie fazy.

## Open Risks & Assumptions

- Zakładamy, że HEAD `4d679a1` pozostaje bazą — kotwice file:line z research.md tracą ważność
  po większych refaktorach (wtedy re-research, nie ślepa edycja).
- Data „Strategy last reviewed" z zastrzeżeniem §1–§2 może mylić szybkiego czytelnika — dopisek
  o zakresie przeglądu jest częścią kontraktu tej zmiany.

## Success Criteria (Summary)

- Zero łańcuchów „none yet — see §3 Phase"; §6.3/§6.8 istnieją i cytują realne pliki.
- Diff dotyka wyłącznie test-plan.md (+ folder change'a); §1–§3 bez zmian.
- Przyszły autor testu znajdzie wzorzec S-05 (staff-write, trigger, PATCH, polling, e2e) bez
  otwierania archiwum.
