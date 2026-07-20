---
project: OrderLY
created: 2026-06-15
platform: Cloudflare Workers
worker_name: orderly
production_url: https://orderly.milosz-sw.workers.dev
cloudflare_account: milosz.sw@gmail.com (6fff60b3c02587199f63be0da4ed4261)
supabase_url: https://xvrwteiiyhtmrphpebcp.supabase.co
status: first deploy live (auth round-trip verified; full sign-up/sign-in pending Auth-URL config)
---

# OrderLY — Deployment Runbook (Cloudflare Workers)

Reproducible runbook for deploying OrderLY, derived from
[`context/foundation/infrastructure.md`](../foundation/infrastructure.md) and the stack in
[`context/foundation/tech-stack.md`](../foundation/tech-stack.md). The first deployment was
executed on 2026-06-15; this document is the canonical "how to deploy" reference.

All commands run from the repo root `C:\Projekty\Repozytoria\10x`. Stack: Astro 6 +
React 19 + `@astrojs/cloudflare` 13 → Cloudflare Workers (Static Assets); external Supabase
(Postgres/Auth). Env is read via `astro:env/server` (NOT `process.env`).

## One-time prerequisites

1. **Cloudflare login** (interactive, browser OAuth):
   ```bash
   npx wrangler login
   npx wrangler whoami        # verify account
   ```
2. **Hosted Supabase project** — created at supabase.com (region Central EU / Frankfurt).
   From **Project Settings → API**: Project URL + **publishable** key (`sb_publishable_…`,
   client-safe; never use the `service_role` secret). Current project:
   `https://xvrwteiiyhtmrphpebcp.supabase.co`.
3. **Worker name** is `orderly` in [`wrangler.jsonc`](../../wrangler.jsonc) (`main` →
   `@astrojs/cloudflare/entrypoints/server`, `compatibility_flags: ["nodejs_compat"]`,
   `ASSETS` → `./dist`, observability on). The `SESSION` KV namespace and `IMAGES` binding
   are **auto-provisioned by the adapter on deploy** — no manual setup.

## Local secrets

Create `.dev.vars` (gitignored — do NOT commit) for local `workerd` dev:
```
SUPABASE_URL=https://xvrwteiiyhtmrphpebcp.supabase.co
SUPABASE_KEY=sb_publishable_…
```

## Build & local smoke test

```bash
npm install
npx astro sync          # regenerates astro:env types
npm run build           # outputs ./dist (adapter = @astrojs/cloudflare)
npm run dev             # real workerd runtime at http://localhost:4321
```
Smoke checks (expected results):
- `GET /` → `200`, **no** "Supabase nie jest skonfigurowany" banner (env wired).
- `GET /dashboard` → `302 → /auth/signin` (middleware protection).
- `POST /api/auth/signin` with a **matching `Origin` header** (Astro CSRF `checkOrigin` is on)
  and bad creds → `302 → /auth/signin?error=Invalid login credentials` (real Supabase round-trip).
  Without the `Origin` header you get `403` — that's the CSRF guard, not a bug.

## Production secrets

```bash
# Worker must exist (deploy once first) — or wrangler creates it on first deploy below.
printf '%s' "<SUPABASE_URL>" | npx wrangler secret put SUPABASE_URL
printf '%s' "<SUPABASE_KEY>" | npx wrangler secret put SUPABASE_KEY
npx wrangler secret list      # confirm both present
```
`wrangler secret put` auto-deploys a new version, so secrets go live immediately.

## Deploy

```bash
npm run build
npx wrangler deploy           # → https://orderly.<subdomain>.workers.dev
```
First deploy registers the `*.workers.dev` subdomain and provisions the `SESSION` KV namespace
(`orderly-session`). Live URL: **https://orderly.milosz-sw.workers.dev**.

## Supabase Auth URL config (after the deploy URL is known)

In the Supabase dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://orderly.milosz-sw.workers.dev`
- **Redirect URLs**: add `https://orderly.milosz-sw.workers.dev/**`

For the first end-to-end auth test choose ONE:
- Keep email confirmation ON (uses Supabase's built-in rate-limited mailer; sign-up lands on
  `/auth/confirm-email`, user clicks the emailed link, then signs in), or
- Temporarily turn OFF **Authentication → Providers → Email → Confirm email** to test sign-in
  immediately (re-enable before real use).

## Post-deploy verification (end-to-end)

1. `GET https://orderly.milosz-sw.workers.dev/` → `200`, no config banner. ✅ (verified)
2. `GET /dashboard` while signed out → `302 → /auth/signin`. ✅ (verified)
3. `POST /api/auth/signin` bad creds → `302 → ?error=Invalid login credentials`
   (Worker→Supabase round-trip). ✅ (verified)
4. **Full flow (browser, after Auth-URL config):** sign up → confirm email → sign in →
   `/dashboard` loads → sign out. ⏳ pending.
5. `npx wrangler tail` during the flow → no `1102` "Worker exceeded CPU" errors, no 500s.

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback <VERSION_ID>     # reverts Worker code in seconds
```
Code-only; this deploy runs no DB migrations, so nothing else to undo.

## Operational notes & risks (from infrastructure.md)

- **Free-tier 10ms CPU ceiling** per invocation (requests are 100k/day free). Watch
  `wrangler tail` for `1102` on SSR-heavy routes; documented fallback is the $5/mo plan (50ms).
- **Secrets ≠ `.env` in prod**: the Worker reads `SUPABASE_URL`/`SUPABASE_KEY` from Worker
  secrets via `astro:env/server`. Keep `.dev.vars` ↔ Worker secrets in sync.
- **Supabase from edge**: no persistent DB connections; the app uses the Supabase HTTP client,
  which is correct for Workers.
- **Thumbnails (FR-005)**: cannot use `sharp` on `workerd`; use Supabase Storage transforms or
  Cloudflare Images (the `IMAGES` binding is already wired). Not exercised by this deploy.

## Follow-ups (out of scope for first deploy)

- Wire **Cloudflare Builds** (auto-deploy on merge) per tech-stack hints; CI is currently
  manual `wrangler deploy` only. The scaffold workflow at `.github.scaffold/workflows/ci.yml`
  is lint+build only and not active.
- Rebrand the page `<title>` (still "10x Astro Starter" in `src/layouts/Layout.astro`).
- Define DB schema/migrations (companies/menu/orders/tenants) — none exist yet.
- Optional: pin `workers_dev`/`preview_urls` explicitly in `wrangler.jsonc` to silence deploy
  warnings; `npm audit fix` for dev-tooling advisories.
