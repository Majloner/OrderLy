---
date: 2026-09-09T23:19:42+0200
researcher: Claude Code (Fable 5)
git_commit: e99a892bf930b79db4dcdbcc126b276f38c7feb4
branch: feat/ai-code-review-pipeline
repository: Majloner/OrderLy
topic: "Minimalna zespołowa paczka npm z artefaktami AI (GitHub Packages, m5l4 model 1)"
tags: [research, ai-toolkit, npm, github-packages, m5l4, distribution]
status: complete
last_updated: 2026-09-09
last_updated_by: Claude Code (Fable 5)
---

# Research: Minimalna zespołowa paczka npm z artefaktami AI

**Date**: 2026-09-09T23:19:42+0200 · **Git Commit**: e99a892 · **Branch**: feat/ai-code-review-pipeline

## Research Question

Jak zbudować w tym repo minimalną paczkę `ai-toolkit` (skill code-review, reguły
CLAUDE.md, instalator/deinstalator, publikacja na GitHub Packages) zgodnie ze
specyfikacjami m5l4 (model 1), reużywając istniejące artefakty zespołu?

## Summary

Wszystkie wejścia są na miejscu: specyfikacje i szablony m5l4 definiują pełny
kształt paczki (package.json, install/uninstall z sentinelami i manifestem,
workflow publikacji, consumer `.npmrc`), a repo ma gotowe artefakty do
dystrybucji — pięć kryteriów review z M5L2/3. Do decyzji (plan): scope musi być
`@majloner` (GitHub Packages wymaga scope == właściciel repo), paczka wg
konwencji repo trafia do `tools/ai-toolkit/`, a workflow szablonowy trzeba
zaadaptować do podkatalogu (`working-directory`), bo zakłada paczkę w korzeniu.

## Detailed Findings

### Specyfikacje i szablony m5l4 (wejścia)

- Spec paczki: [m5l4-github-packages-spec-pack.md](../../../.claude/prompts/m5l4-github-packages-spec-pack.md) —
  struktura starteru, wymagania package.json (`publishConfig.registry`,
  `files[]`, `postinstall`), zachowanie instalatora (idempotencja, sentinele
  `<!-- BEGIN/END <pkg> -->`, manifest `.claude/.ai-toolkit-manifest.json`,
  nie wywala `npm install` przy błędzie), auth tylko przez env/`npm login`.
- Spec CI/CD: [m5l4-github-packages-spec-cicd.md](../../../.claude/prompts/m5l4-github-packages-spec-cicd.md) —
  walidacja (frontmatter SKILL.md, `name` == katalog, `npm pack --dry-run`),
  publish na push do main przez `NODE_AUTH_TOKEN: GITHUB_TOKEN`,
  `permissions: packages: write`; jawnie zakazuje kroków AWS.
- Spec skilla: [m5l4-shared-spec-skill.md](../../../.claude/prompts/m5l4-shared-spec-skill.md) —
  frontmatter `name`+`description`, kategorie review, format wyników
  Critical→Warning→Suggestion + rekomendacja APPROVE/REQUEST CHANGES/NEEDS DISCUSSION.
- Szablony 1:1 w [.claude/config-templates/](../../../.claude/config-templates/):
  package.json (`type: commonjs`, `bin.ai-toolkit`, `engines >=20`),
  install.js (root przez wspinaczkę do `node_modules`, `copyDir` skilli,
  `applyRulesBlock` na sentinelach, manifest `{package, version, installedAt, files}`),
  uninstall.js (czyta manifest, usuwa pliki, wycina blok reguł), workflow, `.npmrc`.
- Konwencje zespołowe (wsad do skilla): [m5l4-shared-conventions.md](../../../.claude/prompts/m5l4-shared-conventions.md) —
  starter do adaptacji, nie prawda objawiona.

### Artefakty repo do reużycia

- **Pięć kryteriów review OrderLY** — [tools/code-review-agent/prompts/review-system.md](../../../tools/code-review-agent/prompts/review-system.md)
  (tenant-isolation, auth-and-secrets, input-validation, framework-conventions,
  test-coverage) + reguły twarde w [AGENTS.md](../../../AGENTS.md). To naturalna,
  zespołowa treść skilla `code-review` — zamiast generycznych konwencji z handoutu.
- Wzorzec paczki narzędziowej w repo: [tools/code-review-agent/](../../../tools/code-review-agent/)
  (własny package.json, testy `node --test`, README) — `tools/ai-toolkit/` będzie siostrą.

### Konwencje SKILL.md w repo (od agenta Explore)

- Frontmatter: `name` (== nazwa katalogu), `description` (jedna linia);
  opcjonalnie `allowed-tools`, `argument-hint`. Bez `version`/`license`.
- H1 `# /<skill-name> — Tytuł`, potem sekcje H2; nowsze skille ładują
  frazy wyzwalające do `description`.

### Rejestr i dystrybucja — stan zerowy

- Brak w repo `.npmrc`, `publishConfig` i workflow publikacji (jedyne ślady to
  szablony m5l4). Root package.json to aplikacja Astro — paczka musi być osobna.
- `.gitignore:507-508` ignoruje globalnie `reports/` (uwaga przy nazwach katalogów).

### Manifest instalacyjny — wzorce

- Prosty (szablon m5l4): `{package, version, installedAt, files[]}` —
  wystarczający dla MVP; deinstalacja czyta manifest zamiast zgadywać ścieżki.
- Rozbudowany ([.claude/.10x-cli-manifest.json](../../../.claude/.10x-cli-manifest.json)):
  dodatkowo `contentHashes` (detekcja dryfu) i ledger per lekcja — poza zakresem MVP.

### Workflows w repo

- [ci.yml](../../../.github/workflows/ci.yml): push main + PR, concurrency z cancel-in-progress.
- [code-review.yml](../../../.github/workflows/code-review.yml): PR do main, AI review (M5L3).
- Workflow publikacji nie istnieje — powstanie `publish-ai-toolkit.yml`.

## Code References

- `.claude/config-templates/m5l4-github-packages-install.js.template:12-21` — wykrywanie roota konsumenta
- `.claude/config-templates/m5l4-github-packages-install.js.template:52-62` — idempotentny blok reguł na sentinelach
- `.claude/config-templates/m5l4-github-packages-uninstall.js.template:26-37` — deinstalacja wg manifestu
- `tools/code-review-agent/prompts/review-system.md:9-33` — pięć kryteriów zespołu
- `.github/workflows/code-review.yml:3-5` — konwencja triggerów PR w repo

## Architecture Insights

1. **Scope musi zgadzać się z właścicielem repo na GitHubie**: publikacja do
   `npm.pkg.github.com` wymaga scope `@majloner` (owner `Majloner`), nie
   placeholderowego `@twoj-zespol`.
2. **Adaptacja szablonu workflow**: szablon zakłada paczkę w korzeniu repo;
   u nas będzie `tools/ai-toolkit/` → kroki wymagają `working-directory` i
   `paths:` w triggerze (publikacja tylko przy zmianach paczki), plus bump
   wersji przed publish (rejestr odrzuca duplikat wersji).
3. **Idempotencja jak w 10x-cli**: sentinele + manifest to ten sam mechanizm,
   który sprawdził się w `.10x-cli-manifest.json`; MVP zostaje przy prostym
   kształcie manifestu bez hashy.
4. **Brak lockfile-trapu z M5L3**: paczka nie potrzebuje devDependencies —
   instalator to czysty Node (fs/path), więc `npm ci` w walidacji nie powtórzy
   problemu promptfoo z code-review-agenta.

## Historical Context (from prior changes)

- M5L2/M5L3 (ta sesja, branch `feat/ai-code-review-pipeline`): zbudowano
  `tools/code-review-agent` z pięcioma kryteriami i pipeline review na PR —
  paczka ai-toolkit dystrybuuje te kryteria jako skill do repozytoriów zespołu.
- `context/foundation/ai-artifacts-distribution.md` — decyzja: model 1
  (GitHub Packages), uzasadnienie i odrzucenie modeli 2/3.

## Related Research

- Brak wcześniejszych research.md o dystrybucji paczek w `context/changes/**` i `context/archive/**`.

## Open Questions

1. Nazwa binarki/paczki: `@majloner/ai-toolkit` (wg spec `ai-toolkit`) — czy
   prefiksować `orderly-`? MVP: zostaje `ai-toolkit` (spec).
2. Czy publish ma iść z gałęzi `main` tylko po merge PR #38 (workflow wejdzie
   z tą gałęzią)? MVP: tak, trigger `push: main` + `paths: tools/ai-toolkit/**`.
