<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Menu Items Management (S-03)

- **Plan**: `context/changes/menu-items-management/plan.md`
- **Mode**: Deep
- **Date**: 2026-07-08
- **Verdict**: SOUND (po naniesieniu poprawek z triage)
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS (1 observation) |
| Plan Completeness | WARNING → fixed |

## Grounding

6/6 istniejących ścieżek ✓ (`src/types.ts`, `src/pages/menu.astro` — nowe pliki zgodnie z planem);
symbole 5/5 ✓ (`menu_items_staff_all`, `menu_items_anon_read_available`, `PROTECTED_ROUTES`,
skrypt `test:rls`, `is_available` w teście izolacji); brief↔plan ✓; Progress↔Phase ✓.
Weryfikacja kodu (sub-agent): routing Astro `items.ts`+`items/[id].ts`+`items/reorder.ts` bezkolizyjny
(segment statyczny > dynamiczny); trigger `handle_new_user` — `CREATE OR REPLACE` z pustym
`search_path` poprawne, SECURITY DEFINER omija RLS (owner tabel); test izolacji strukturalnie gotowy
na fixture waitera i nowe asercje.

## Findings

### F1 — Błędne twierdzenie o kaskadzie przy DROP COLUMN is_available

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Phase 1, zmiana #2
- **Detail**: Plan twierdził, że DROP COLUMN kaskadowo usuwa politykę anon. W Postgres polityka RLS
  rejestruje zależność od kolumny (pg_depend): zwykły DROP COLUMN kończy się błędem zależności,
  a CASCADE usunąłby politykę po cichu (NOTICE), zostawiając anon bez odczytu do czasu CREATE POLICY.
- **Fix (user)**: Najpierw odpięcie poszczególnych zależności, usunięcie na końcu — sekwencja
  ADD COLUMN → backfill → DROP POLICY → DROP COLUMN → CREATE POLICY w jednej transakcyjnej migracji,
  bez CASCADE.
- **Decision**: FIXED (fix differently — zapisane w Phase 1 #2/#3 i Critical Implementation Details)

### F2 — zod nie jest zainstalowany, a plan nie dodawał go do zależności

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Plan Completeness
- **Location**: Phase 2, zmiana #1
- **Detail**: package.json nie zawiera zod (konwencja z AGENTS.md niezmaterializowana; istniejące
  route'y walidują ręcznie). Plan wymieniał @dnd-kit i vitest jako nowe zależności, zakładając zod.
- **Fix**: `zod` dopisany jako nowa dependency w kontrakcie Phase 2 #1.
- **Decision**: FIXED

### F3 — Brak bramki typecheck w kryteriach automatycznych

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — szybka decyzja; poprawka oczywista i wąska
- **Dimension**: Blind Spots
- **Location**: Success Criteria (fazy 2–3)
- **Detail**: Projekt jest TS strict, ale `astro build` (Vite) nie uruchamia pełnego typechecku i nie
  ma skryptu `astro check` — błędy typów w wyspie React/schematach mogłyby przejść przez lint+build.
- **Fix**: `@astrojs/check` + `typescript` jako devDependencies, skrypt `"typecheck": "astro check"`
  (Phase 2 #3); kryterium `npm run typecheck` dodane do faz 2 i 3 + odpowiednie pozycje w Progress
  (2.4, 3.4; renumeracja manualnych).
- **Decision**: FIXED

## Triage summary

- Fixed: F1 (fix differently), F2, F3 (3)
- Skipped/Accepted/Dismissed: — (0)
- Verdict after fixes: **SOUND**
