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
- Pre-commit: husky + lint-staged auto-fix staged files. No test framework is configured yet — add one before the first feature.

## Coding Style & Conventions

TypeScript strict (`astro/tsconfigs/strict`). Path alias `@/*` → `src/*`. Merge Tailwind classes with `cn()` from `@/lib/utils` — never concatenate class strings. API routes export uppercase `GET`/`POST` and validate input with zod. Add UI via `npx shadcn@latest add <name>` (new-york variant). Migration files: `YYYYMMDDHHmmss_short_description.sql`.

## Commit & Pull Request Guidelines

Remote is GitHub `Majloner/OrderLy`; open PRs against `main`. Only the initial commit and the .NET→Astro migration exist, so no message convention is established — define one before the second feature. The migration currently lives on branch `chore/migrate-dotnet-to-astro`.

## Notes

- Secrets `SUPABASE_URL`/`SUPABASE_KEY`: `.env` (Node) or `.dev.vars` (Cloudflare local, both gitignored). Never commit them.
- The `@przeprogramowani/10x-cli` block in `@CLAUDE.md` is generated — do not hand-edit it. `context/` is that toolkit's working area.
- `.mcp.json` registers a local `claude-manager-kanban` server (tooling, not app code).
- Migration cleanup still pending: review the `CLAUDE.md.scaffold` and `.github.scaffold` (`ci.yml`) siblings left by the scaffold.
