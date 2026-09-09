# AI Toolkit Package (GitHub Packages) — Implementation Plan

## Overview

Zbudowanie minimalnej zespołowej paczki npm `@majloner/ai-toolkit@0.1.0` w
`tools/ai-toolkit/`, dystrybuującej artefakty AI zespołu (skill `code-review`
oparty o pięć kryteriów OrderLY + reguły `CLAUDE.md`) przez GitHub Packages,
z idempotentnym instalatorem, deinstalatorem wg manifestu i pipeline'em
walidacja→publikacja (M5L4, model 1).

## Current State Analysis

- Brak w repo jakiejkolwiek dystrybucji npm (zero `.npmrc`, `publishConfig`,
  workflow publikacji) — patrz research.md.
- Gotowe wejścia: specyfikacje i szablony m5l4 w `.claude/prompts/` i
  `.claude/config-templates/`; pięć kryteriów zespołu w
  `tools/code-review-agent/prompts/review-system.md:9-33`; reguły twarde w `AGENTS.md`.
- Wzorzec paczki narzędziowej: `tools/code-review-agent/` (własny package.json,
  testy `node --test`, README).

## Desired End State

`tools/ai-toolkit/` zawiera kompletną, lokalnie zweryfikowaną paczkę
(`npm pack --dry-run` przechodzi, testy instalatora zielone, instalacja do
katalogu tymczasowego działa w obie strony), a `.github/workflows/publish-ai-toolkit.yml`
waliduje ją na PR i publikuje do `npm.pkg.github.com` po merge do `main`.
Konsument dodaje jedną linię `.npmrc` i `npm install @majloner/ai-toolkit`.

### Key Discoveries:

- Scope musi być `@majloner` (== owner repo), inaczej `GITHUB_TOKEN` nie opublikuje (research.md → Architecture Insights 1).
- Szablon workflow zakłada paczkę w korzeniu — wymagane `working-directory` + `paths:` (Insights 2).
- npm zawsze dołącza `package.json` do tarballa → instalator może czytać wersję z `require("./package.json")` zamiast hardkodować (unika dryfu wersji z szablonu).
- Paczka nie ma zależności → w CI zbędne `npm ci` (unikamy lockfile-trapu z M5L3).
- `.gitignore:507-508` ignoruje globalnie `reports/` — nie używać tej nazwy katalogu w paczce.

## What We're NOT Doing

- Model 2 (CodeArtifact/Terraform/OIDC) i model 3 (API+CLI) — decyzja w `context/foundation/ai-artifacts-distribution.md`.
- Hashy treści w manifeście (drift detection jak w 10x-cli) — poza MVP.
- Automatycznego bumpowania wersji w CI — wersję podbija autor zmiany w PR.
- Instalacji do innych narzędzi niż Claude Code (Cursor/Copilot) — MVP celuje w `.claude/`.
- Publikacji z tej gałęzi — publish wymaga merge do `main` (trigger `push: main`).

## Implementation Approach

Adaptujemy szablony m5l4 (nie kopiujemy 1:1): nazwa/scope `@majloner`,
lokalizacja `tools/ai-toolkit/`, treść skilla z naszych kryteriów M5L2/3,
wersja czytana z package.json, workflow z `working-directory` i filtrem `paths`.
Instalator/deinstalator eksportują czyste funkcje (`module.exports`) i odpalają
`main()` tylko przy `require.main === module`, żeby dały się testować hermetycznie.

## Phase 1: Struktura paczki i artefakty

### Overview

Powstaje szkielet paczki z metadanymi npm i treścią artefaktów (skill + reguły).

### Changes Required:

#### 1. Metadane paczki

**File**: `tools/ai-toolkit/package.json`

**Intent**: Zdefiniować publikowalną paczkę wg szablonu m5l4 z naszym scope.

**Contract**: `name: @majloner/ai-toolkit`, `version: 0.1.0`, `type: commonjs`,
`license: UNLICENSED`, `publishConfig.registry: https://npm.pkg.github.com`,
`files: ["skills/", "rules/", "install.js", "uninstall.js", "README.md"]`,
`scripts.postinstall: node install.js`, `scripts.test: node --test "tests/**/*.test.js"`,
`bin.ai-toolkit: ./install.js`, `engines.node: >=20`. Bez dependencies.
`tests/` celowo poza `files[]` (nie publikujemy testów).

#### 2. Skill code-review

**File**: `tools/ai-toolkit/skills/code-review/SKILL.md`

**Intent**: Zespołowy skill review na bazie pięciu kryteriów OrderLY
(`tools/code-review-agent/prompts/review-system.md`), w formacie wyjścia ze
spec m5l4 (severity Critical→Warning→Suggestion + rekomendacja).

**Contract**: Frontmatter dokładnie `name: code-review` (== nazwa katalogu,
waliduje to CI) i jednolinijkowe `description` z frazami wyzwalającymi
("review code", "check this PR", "review my changes", "code review").
Treść: rola, pięć kryteriów (tenant-isolation, auth-and-secrets,
input-validation, framework-conventions, test-coverage), zasady review
(bez nitpicków linterowych, tylko diff), format findingów z `file:line`,
zakończenie: `APPROVE` / `REQUEST CHANGES` / `NEEDS DISCUSSION`.

#### 3. Reguły zespołowe

**File**: `tools/ai-toolkit/rules/CLAUDE.md`

**Intent**: Blok reguł wstrzykiwany do `CLAUDE.md` konsumenta między
sentinelami — kondensat reguł twardych zespołu z `AGENTS.md`.

**Contract**: Czysty markdown bez sentineli (dodaje je instalator). Zawiera:
tenant isolation (`company_id` + RLS), SSR (`prerender = false`), auth w
middleware + sekrety z `astro:env/server`, React tylko dla interaktywności +
`cn()`, walidacja zod na wejściach API, semantyka kodów błędów.

#### 4. README paczki

**File**: `tools/ai-toolkit/README.md`

**Intent**: Instrukcja dla konsumenta i wydawcy.

**Contract**: Sekcje: co zawiera paczka; instalacja u konsumenta (`.npmrc`
z `@majloner:registry=https://npm.pkg.github.com` — bez tokenu w repo,
auth przez `npm login` lokalnie / `GH_PKG_TOKEN` w CI); co robi instalator
(sentinele, manifest `.claude/.ai-toolkit-manifest.json`, idempotencja);
odinstalowanie (`node uninstall.js` / `npm uninstall`); proces wydania
(bump wersji w PR → merge do main → publish z CI).

### Success Criteria:

#### Automated Verification:

- `npm pack --dry-run` w `tools/ai-toolkit/` wypisuje dokładnie: package.json, README.md, install.js*, uninstall.js*, skills/code-review/SKILL.md, rules/CLAUDE.md (*po Fazie 2)
- Frontmatter SKILL.md parsuje się i `name` == `code-review`

#### Manual Verification:

- Treść SKILL.md odzwierciedla pięć kryteriów z M5L2/3 bez utraty reguł twardych

---

## Phase 2: Instalator i deinstalator z testami

### Overview

Idempotentny instalator (skills → `.claude/skills/`, reguły → sentinele w
`CLAUDE.md`, manifest) i deinstalator wg manifestu; czysta logika pokryta testami.

### Changes Required:

#### 1. Instalator

**File**: `tools/ai-toolkit/install.js`

**Intent**: Adaptacja szablonu `m5l4-github-packages-install.js.template` —
kopiuje skille, wstrzykuje blok reguł, pisze manifest; nigdy nie wywala
`npm install` konsumenta.

**Contract**: CommonJS. `PACKAGE_NAME`/wersja z `require("./package.json")`
(nie hardkodowane). Sentinele: `<!-- BEGIN @majloner/ai-toolkit -->` /
`<!-- END @majloner/ai-toolkit -->`. Root konsumenta: `PROJECT_ROOT` env →
wspinaczka do `node_modules` → `cwd` (jak w szablonie). Manifest:
`.claude/.ai-toolkit-manifest.json` z `{package, version, installedAt, files[]}`.
Eksport `module.exports = { applyRulesBlock, findProjectRoot }`; `main()` tylko
gdy `require.main === module`; całość w try/catch z `console.warn` (spec:
postinstall nie może wywalić instalacji).

#### 2. Deinstalator

**File**: `tools/ai-toolkit/uninstall.js`

**Intent**: Adaptacja szablonu uninstall — usuwa pliki z manifestu, wycina blok
reguł, kasuje manifest.

**Contract**: CommonJS, sentinele jw. Eksport `module.exports = { removeRulesBlock }`;
`main()` gate'owany `require.main === module`.

#### 3. Testy jednostkowe

**File**: `tools/ai-toolkit/tests/install.test.js`

**Intent**: Hermetyczne testy kontraktu instalatora (lekcja z M5L3: logika
bramkowa bez testów = REQUEST CHANGES od własnego review-agenta na PR).

**Contract**: `node:test` + `node:assert/strict`, zero wywołań sieci. Pokrywa:
`applyRulesBlock` — append do pustego/istniejącego pliku, idempotencja (drugie
wywołanie nadpisuje blok zamiast dublować), zachowanie treści poza sentinelami;
`removeRulesBlock` — usunięcie bloku, no-op bez sentineli, round-trip
apply→remove; pełny cykl na katalogu tymczasowym (`fs.mkdtempSync`):
`PROJECT_ROOT=<tmp> main()` instaluje pliki + manifest, drugi run nie dubluje,
uninstall zostawia katalog czysty (bez plików skilla, bez bloku, bez manifestu).

### Success Criteria:

#### Automated Verification:

- `npm test` w `tools/ai-toolkit/` — wszystkie testy zielone
- Podwójny `PROJECT_ROOT=<tmp> node install.js` nie dubluje bloku reguł (asercja w testach)
- `node uninstall.js` po instalacji zostawia tmp bez śladów (asercja w testach)

#### Manual Verification:

- Instalacja do katalogu tymczasowego obejrzana ręcznie: struktura `.claude/skills/code-review/`, blok w `CLAUDE.md`, manifest czytelny

---

## Phase 3: Pipeline publikacji

### Overview

Workflow walidacja→publish na GitHub Packages, zgodny ze spec m5l4 i
konwencjami repo (concurrency, filtr paths).

### Changes Required:

#### 1. Workflow publikacji

**File**: `.github/workflows/publish-ai-toolkit.yml`

**Intent**: Walidacja paczki na PR; po push do `main` (tylko przy zmianach w
`tools/ai-toolkit/**`) walidacja + `npm publish` przez `GITHUB_TOKEN`.

**Contract**: Triggery: `pull_request` i `push` na `main` z
`paths: ["tools/ai-toolkit/**", ".github/workflows/publish-ai-toolkit.yml"]`.
`permissions: contents: read, packages: write`. Oba joby z
`defaults.run.working-directory: tools/ai-toolkit` i `actions/setup-node@v4`
(`node-version: 20`, `registry-url: https://npm.pkg.github.com`,
`scope: "@majloner"`). Walidacja (bez `npm ci` — brak zależności):
(1) node -e sprawdza `name`/`version`/`publishConfig.registry` w package.json,
(2) `test -f skills/code-review/SKILL.md`, (3) node -e sprawdza frontmatter
(`name:` == `code-review`, `description` niepuste), (4) `npm test`,
(5) `npm pack --dry-run`. Publish: `needs: validate`,
`if: github.event_name == 'push'`, `npm publish` z
`NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. Zakazane (spec): kroki AWS,
`id-token: write`.

### Success Criteria:

#### Automated Verification:

- `npx --yes yaml-lint` lub parsowanie YAML workflow przechodzi (wystarczy `node -e` z js-yaml z devDeps repo lub actionlint, jeśli dostępny; minimalnie: plik parsuje się w CI repo)
- Job `validate` zielony na PR (po pushu tej gałęzi)

#### Manual Verification:

- Po merge do `main`: job `publish` zielony, paczka `@majloner/ai-toolkit@0.1.0` widoczna w GitHub → Packages (dowody do 10xChampion, jeśli ta ścieżka byłaby wybrana)

---

## Testing Strategy

### Unit Tests:

- Sentinele: apply/update/remove, idempotencja, round-trip (Faza 2)
- Cykl instalacji na `mkdtemp`: install → re-install → uninstall

### Integration Tests:

- Job `validate` na PR pełni rolę integracyjną (frontmatter + pack dry-run + testy)

### Manual Testing Steps:

1. `cd tools/ai-toolkit && npm pack --dry-run` — lista plików zgodna z kontraktem
2. `PROJECT_ROOT=$(mktemp -d) node install.js` + oględziny wyniku, ponowny run, `node uninstall.js`
3. Po merge: sprawdzić kartę Packages w repo GitHub

## Performance Considerations

Brak — instalator to operacje na kilku plikach.

## Migration Notes

Brak istniejących konsumentów; pierwsza wersja 0.1.0. Wydania kolejnych wersji:
bump `version` w PR (rejestr odrzuca duplikaty), merge do main publikuje.

## References

- Related research: `context/changes/ai-toolkit-package/research.md`
- Decyzja modelu: `context/foundation/ai-artifacts-distribution.md`
- Spec paczki/CI: `.claude/prompts/m5l4-github-packages-spec-pack.md`, `.claude/prompts/m5l4-github-packages-spec-cicd.md`
- Szablony: `.claude/config-templates/m5l4-github-packages-*.template`
- Kryteria review: `tools/code-review-agent/prompts/review-system.md:9-33`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Struktura paczki i artefakty

#### Automated

- [x] 1.1 `npm pack --dry-run` wypisuje dokładnie kontraktowy zestaw plików — fd8a0c7
- [x] 1.2 Frontmatter SKILL.md parsuje się i `name` == `code-review` — fd8a0c7

#### Manual

- [x] 1.3 Treść SKILL.md odzwierciedla pięć kryteriów z M5L2/3 — fd8a0c7

### Phase 2: Instalator i deinstalator z testami

#### Automated

- [x] 2.1 `npm test` zielone — e149ab4
- [x] 2.2 Idempotencja podwójnej instalacji (asercja) — e149ab4
- [x] 2.3 Czysty uninstall (asercja) — e149ab4

#### Manual

- [x] 2.4 Ręczne oględziny instalacji do katalogu tymczasowego — e149ab4

### Phase 3: Pipeline publikacji

#### Automated

- [x] 3.1 YAML workflow poprawny składniowo — ad44f00
- [x] 3.2 Job `validate` zielony na PR — 8c73a0e

#### Manual

- [x] 3.3 Po merge do main: `publish` zielony, paczka widoczna w Packages — bc828f1
