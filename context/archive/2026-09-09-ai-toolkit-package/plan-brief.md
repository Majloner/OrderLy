# AI Toolkit Package — Plan Brief

> Full plan: `context/changes/ai-toolkit-package/plan.md`
> Research: `context/changes/ai-toolkit-package/research.md`

## What & Why

Zespołowa paczka npm `@majloner/ai-toolkit`, która dystrybuuje artefakty AI
(skill code-review z pięcioma kryteriami OrderLY + reguły CLAUDE.md) tak, jak
dystrybuuje się kod: wersjonowana paczka w rejestrze, który zespół już ma
(GitHub Packages). Zamyka M5L4 (model 1) na realnej treści zespołu zamiast
generycznych szablonów.

## Starting Point

Repo nie ma żadnej dystrybucji npm. Mamy komplet wejść: specyfikacje i szablony
m5l4 (`.claude/prompts/`, `.claude/config-templates/`), pięć kryteriów review z
M5L2/3 (`tools/code-review-agent/prompts/review-system.md`) i wzorzec paczki
narzędziowej (`tools/code-review-agent/`).

## Desired End State

`tools/ai-toolkit/` zawiera paczkę przechodzącą `npm pack --dry-run` i testy
instalatora; workflow waliduje ją na PR i publikuje po merge do `main`.
Konsument: jedna linia `.npmrc` + `npm install @majloner/ai-toolkit` →
skill w `.claude/skills/`, reguły między sentinelami w `CLAUDE.md`, manifest
umożliwiający czysty uninstall.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Model dystrybucji | GitHub Packages (model 1) | Odbiorca = zespół na GitHubie; zero nowej infrastruktury | Foundation doc |
| Scope/nazwa | `@majloner/ai-toolkit` | GitHub Packages wymaga scope == owner repo, inaczej `GITHUB_TOKEN` nie opublikuje | Research + User |
| Treść artefaktów | Skill z 5 kryteriami OrderLY + reguły z AGENTS.md | Realna wartość zespołowa zamiast generycznego handoutu | User |
| Publikacja | Push do `main` + filtr `paths` | Wg spec lekcji, zero ręcznych kroków; wersję bumpuje autor w PR | User |
| Lokalizacja | `tools/ai-toolkit/` | Konwencja repo (siostra `tools/code-review-agent/`) | Research |
| Wersja w instalatorze | Z `require("./package.json")` | npm zawsze publikuje package.json; unika dryfu z hardkodem szablonu | Plan |
| Testy | `node:test`, hermetyczne, poza `files[]` | Lekcja z M5L3: logika bramkowa bez testów nie przejdzie własnego review na PR | Plan |

## Scope

**In scope:** package.json, SKILL.md, rules/CLAUDE.md, README, install.js,
uninstall.js, testy, workflow publish, instrukcja konsumenta (.npmrc).

**Out of scope:** CodeArtifact/Terraform (model 2), API+CLI (model 3), hashe w
manifeście, auto-bump wersji, wsparcie narzędzi innych niż Claude Code.

## Architecture / Approach

Adaptacja szablonów m5l4 pod repo: instalator kopiuje `skills/` do
`.claude/skills/` konsumenta, wstrzykuje reguły między sentinele
`<!-- BEGIN/END @majloner/ai-toolkit -->` w `CLAUDE.md`, pisze manifest
`.claude/.ai-toolkit-manifest.json`; uninstall czyta manifest. CI: `validate`
(frontmatter, testy, pack dry-run) na PR, `publish` przez `GITHUB_TOKEN` na
push do `main` z filtrem `paths: tools/ai-toolkit/**`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Struktura i artefakty | Publikowalny szkielet + treść skilla/reguł | Frontmatter niezgodny z walidacją CI |
| 2. Instalator + testy | Idempotentny install/uninstall z dowodem w testach | Regresja idempotencji sentineli |
| 3. Pipeline publikacji | validate na PR, publish po merge | Duplikat wersji przy publish (brak bumpa) |

**Prerequisites:** brak (wszystkie wejścia w repo); publish wymaga merge do `main`.
**Estimated effort:** 1 sesja, 3 fazy.

## Open Risks & Assumptions

- Publish zadziała dopiero po merge tej gałęzi do `main` — do tego czasu dowodem jest zielony `validate` na PR.
- Zakładamy brak organizacji GitHub; przy przenosinach do organizacji zmienia się scope (i konsumenci muszą zaktualizować `.npmrc`).

## Success Criteria (Summary)

- `npm test` i `npm pack --dry-run` zielone lokalnie; instalacja/deinstalacja na katalogu tymczasowym bez śladów.
- Job `validate` zielony na PR; po merge `publish` wystawia `0.1.0` w GitHub Packages.
- Konsument instaluje paczkę jedną linią `.npmrc` + `npm install`.
