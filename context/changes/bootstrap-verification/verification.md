---
bootstrapped_at: 2026-06-08T00:05:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: orderly
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim from `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: orderly
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: cloudflare-builds
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

**Why this stack** (from the hand-off body): Świadoma zmiana fundamentu z .NET na
JS/TS dla solo, 7-tygodniowego MVP OrderLY. Rekomendowany starter pary `(web-app, js)`
to 10x Astro Starter (Astro 6 + React 19 + TypeScript + Tailwind 4 + Supabase +
Cloudflare). Supabase = PostgreSQL + Auth + Storage + Row Level Security pokrywa
uwierzytelnianie/role (FR-001/003), multi-tenant izolację przez RLS (kluczowy
guardrail) i storage zdjęć menu (FR-005). Deploy na Cloudflare Pages/Workers;
świadoma degradacja realtime → polling co 3–5 s (`has_realtime: false`) sprawia, że
edge przestaje być blokerem. Odstępstwa do domknięcia: PRD FR-007 wciąż mówi „w
czasie rzeczywistym" (aktualizacja prd.md), miniatury przez Supabase Storage / CF
Images, CI na Cloudflare Builds zamiast globalnego Bitbucket, dotychczasowy szkielet
.NET zastąpiony (wymaga ponownego bootstrapu — wykonane na gałęzi
`chore/migrate-dotnet-to-astro`).

## Pre-scaffold verification

| Signal       | Value    | Severity | Notes                                                              |
| ------------ | -------- | -------- | ------------------------------------------------------------------ |
| npm package  | not run  | n/a      | cmd_template starts with `git clone` — npm recency step skipped per spec |
| GitHub repo  | not run  | n/a      | recency check unavailable: `gh` CLI not installed (WARN-AND-CONTINUE) |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (upstream `.git/` deleted before move-up)
**Exit code**: 0
**Files moved**: entire starter tree moved up into cwd — root files (`package.json`, `package-lock.json`, `astro.config.mjs`, `tsconfig.json`, `eslint.config.js`, `components.json`, `wrangler.jsonc`, `.env.example`, `.nvmrc`, `.prettierrc.json`, `README.md`), directories (`src/`, `public/`, `supabase/`, `.husky/`, `.vscode/`), and `node_modules/` (773 packages installed).
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold` (cwd CLAUDE.md preserved — carries the 10x-cli block), `.github.scaffold` (cwd `.github/workflows` preserved)
**.gitignore handling**: append-merged (cwd lines kept; starter lines deduped and appended under a `# from 10x-astro-starter` separator)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW (10 total)
**Direct vs transitive**: 2 direct / 8 transitive overall. Both direct advisories are MODERATE (`@astrojs/check`, `wrangler`). The sole HIGH (`devalue`) is transitive.

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** (transitive, range `5.6.3 - 5.8.0`) — DoS via sparse array deserialization (Svelte `devalue`). Fix available via `npm audit fix`.

#### MODERATE findings

- **@astrojs/check** (direct, `>=0.9.3`) — via `@astrojs/language-server`. Suggested fix pins `@astrojs/check@0.9.2` (a downgrade — review before applying).
- **wrangler** (direct) — via `miniflare`. Fix available via `npm audit fix`.
- **@astrojs/language-server** (transitive) — via `volar-service-yaml`.
- **@cloudflare/vite-plugin** (transitive) — via `miniflare` / `wrangler` / `ws`.
- **miniflare** (transitive) — via `ws`.
- **volar-service-yaml** (transitive) — via `yaml-language-server`.
- **ws** (transitive, `8.0.0 - 8.20.0`) — uninitialized memory disclosure. Fix available.
- **yaml** (transitive, `2.0.0 - 2.8.2`) — stack overflow via deeply nested YAML collections.
- **yaml-language-server** (transitive) — via `yaml`.

#### LOW / INFO findings

None.

> WARN-AND-CONTINUE: bootstrapper does not auto-fix. Every finding sits in the
> dev/tooling chain (Astro check, language-server, wrangler/miniflare/ws/yaml),
> not the runtime app surface. Run `npm audit fix` for the non-breaking fixes;
> review the `@astrojs/check@0.9.2` downgrade and the `devalue` HIGH before a
> release.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | cloudflare-builds   |
| ci_default_flow         | auto-deploy-on-merge|
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | false               |
| has_background_jobs     | false               |

Note: `ci_provider: cloudflare-builds` — v1 generates no CI files; wire the Cloudflare Pages build/deploy integration manually.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` is unnecessary — this repo already has history; the scaffold was applied on branch `chore/migrate-dotnet-to-astro`.
- Review the `.scaffold` siblings the conflict policy created: `CLAUDE.md.scaffold` (the starter's agent guide — merge useful parts into the repo CLAUDE.md) and `.github.scaffold` (the starter's CI workflows — compare against the existing `.github/workflows`).
- Rewrite `AGENTS.md` for the Astro/Supabase stack (it still documents the removed .NET stack) — run `/10x-agents-md`.
- Update `prd.md` FR-007 to the polling model so `has_realtime: false` matches the PRD.
- Address audit findings per your risk tolerance — the full breakdown is above (`npm audit fix`).
