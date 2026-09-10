# Repository Guidelines

OrderLY is a multi-tenant SaaS for small/medium restaurants (active menu with photos, per-table permanent QR codes, anonymous client ordering, role-based staff panels). Stack: Astro 6 SSR + React 19 islands + TypeScript (strict) + Tailwind 4 + Supabase (Postgres/Auth/Storage) on Cloudflare Workers. Product scope and non-goals (no online payments, fiscalization, inventory, reservations, native mobile, multi-location) live in `@OrderLY-MVP.md` — treat it as the source of truth.

## Hard rules

- **Tenant isolation is non-negotiable.** Every table is scoped by `company_id`, enforced by Supabase Postgres Row Level Security. Enable RLS on every new table with granular per-operation, per-role policies; never write a query that can read or mutate rows across `company_id`.
- **SSR is the default.** `output: "server"` (`@astro.config.mjs`). Every API route under `src/pages/api/` must export `const prerender = false`.
- **Auth runs in middleware.** `src/middleware.ts` resolves the user into `context.locals.user` and gates `PROTECTED_ROUTES`; the Supabase SSR client lives in `src/lib/supabase.ts`. Server-only secrets come from `astro:env/server`, never `import.meta.env` in client code.
- **Astro for static/layout; React only for interactivity.** No Next.js directives (`"use client"`). Extract hooks to `src/components/hooks/`.
- **Availability/status updates use client polling (~3–5 s), not WebSockets** — a deliberate MVP simplification (PRD FR-007).

## Project Structure

`src/pages/` routes (`api/` endpoints, `auth/` pages); `src/components/` (`.astro` + `auth/` + shadcn `ui/`); `src/layouts/`; `src/lib/` services and helpers (`supabase.ts`, `utils.ts`); shared types in `src/types.ts`; DB migrations in `supabase/migrations/`.

## Build, Test, and Development Commands

- `npm run dev` — Astro dev server on the Cloudflare workerd runtime.
- `npm run build` / `npm run preview` — SSR build via `@astrojs/cloudflare`.
- `npm run lint` / `lint:fix` / `format` — ESLint 9 flat config (`@eslint.config.js`) + Prettier.
- `npx supabase start` — local Postgres/Auth (needs Docker); `npm run deploy` — ship to Cloudflare.
  Deploy must go through that script, not a bare `wrangler deploy`: `astro build` is what writes
  `.wrangler/deploy/config.json`, which points wrangler at the adapter-generated
  `dist/server/wrangler.json`. Without it wrangler falls back to the root `wrangler.jsonc`, whose
  `main` is a package specifier rather than a file, and fails with "entry-point file … was not found".
  **The "Workers Builds: orderly" check on every PR fails for exactly this reason.** Confirmed from
  the build records via the Workers Builds API (2026-08-13): the project's **build command is empty**
  and the deploy commands are the defaults — `npx wrangler deploy` on `main`, `npx wrangler versions
upload` on PR branches. Dependencies install and the deploy runs immediately with no build in
  between, so `dist/` never exists, `.wrangler/deploy/config.json` is never written, and wrangler
  falls back to the root config. The build log ends with wrangler's own hint: "please run your
  project's build command and try again".
  **Fix (Cloudflare dashboard, not this repo — Workers & Pages → `orderly` → Settings → Build): set
  the BUILD command to `npm run build`; leave the deploy commands at their defaults.** The build step
  runs before whichever deploy command applies, so one setting fixes production and preview alike.
  Setting the _deploy_ command to `npm run deploy` instead would fix only `main` — PR branches use
  `versions upload`, which that change does not touch.
  It is unrelated to the GitHub Actions CI in `.github/workflows/ci.yml`, which is green.
- Pre-commit: husky + lint-staged auto-fix staged files.
- Tests: `npm run test` (unit, DB-free) · `npm run test:integration` (needs `npx supabase start` +
  `.env.test`) · `npm run test:rls:local` (SQL RLS suite). Read `context/foundation/test-plan.md` §6
  before adding a test — it carries the cookbook, the fixtures, and the traps.

## Coding Style & Conventions

TypeScript strict (`astro/tsconfigs/strict`). Path alias `@/*` → `src/*`. Merge Tailwind classes with `cn()` from `@/lib/utils` — never concatenate class strings. API routes export uppercase `GET`/`POST` and validate input with zod. Add UI via `npx shadcn@latest add <name>` (new-york variant). Migration files: `YYYYMMDDHHmmss_short_description.sql`.

## Commit & Pull Request Guidelines

Remote is GitHub `Majloner/OrderLy`; open PRs against `main`. Only the initial commit and the .NET→Astro migration exist, so no message convention is established — define one before the second feature. The migration currently lives on branch `chore/migrate-dotnet-to-astro`.

## AI Tooling (`tools/`)

Standalone packages under `tools/` — repo tooling, not app code; their dependencies don't touch the app's.

- `tools/code-review-agent/` — scripted code-review agent on the **Claude Agent SDK**. It scores a diff against five acceptance criteria encoded in `tools/code-review-agent/prompts/review-system.md` (tenant-isolation, auth-and-secrets, input-validation, framework-conventions, test-coverage — sourced from the Hard rules above; update both together). The response shape is zod-enforced (`src/lib.mjs`) and the verdict is derived mechanically from the criteria (any `fail` ⇒ `request_changes`) — the model's own verdict is not trusted. Exit codes: `0` approve · `3` request_changes (the CI gate) · `1` contract/model error · `2` bad usage. Run locally: `npm run review:sample`, or `git diff main | node src/review.mjs -`. The promptfoo suite in `eval/` (`promptfooconfig.yaml`, 3 fixture diffs × 3 models via `exec:` provider) is the **prompt-regression gate** — run it before changing the prompt.
- `.github/workflows/code-review.yml` runs the agent on every PR to `main` (job `agent-review`, `REVIEW_MODEL: claude-sonnet-5` — picked from the promptfoo eval as 3/3 at ~45% of Opus cost): builds the PR diff (excluding `package-lock.json`), posts the verdict as a PR comment, and fails the check on `request_changes` or agent error. Auth: repo secret `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (subscription billing); `ANTHROPIC_API_KEY` is the token-billing alternative.
- `tools/ai-toolkit/` — team AI-artifacts npm package **`@majloner/ai-toolkit`** on GitHub Packages (`npm.pkg.github.com`). Ships `skills/code-review/SKILL.md` plus a condensed hard-rules block; `postinstall` copies skills into the consumer's `.claude/skills/` and injects the rules block into their `CLAUDE.md` between `<!-- BEGIN/END @majloner/ai-toolkit -->` sentinels (idempotent — reinstall replaces, never duplicates; manifest at `.claude/.ai-toolkit-manifest.json`; installer failures warn, never break `npm install`). Consumer setup is one committable `.npmrc` line (`@majloner:registry=https://npm.pkg.github.com`) + `npm install --save-dev @majloner/ai-toolkit`; registry auth stays out of the repo (local `npm login`, CI token via env). Releasing: bump `version` in `package.json` (the registry rejects duplicate versions) and merge — `.github/workflows/publish-ai-toolkit.yml` (paths-filtered to `tools/ai-toolkit/**`) validates on PR (frontmatter, installer tests, `npm pack --dry-run`) and publishes on push to `main` via `GITHUB_TOKEN`.

## Notes

- Secrets `SUPABASE_URL`/`SUPABASE_KEY`: `.env` (Node) or `.dev.vars` (Cloudflare local, both gitignored). Never commit them.
- The `@przeprogramowani/10x-cli` block in `@CLAUDE.md` is generated — do not hand-edit it. `context/` is that toolkit's working area.
- `.mcp.json` registers a local `claude-manager-kanban` server (tooling, not app code).
