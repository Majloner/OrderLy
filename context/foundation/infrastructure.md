---
project: OrderLY
researched_at: 2026-06-15
recommended_platform: Cloudflare Workers (Static Assets)
runner_up: Render
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare
---

## Recommendation

**Deploy on Cloudflare Workers (Static Assets model).**

It is the only candidate that passes all five agent-friendly criteria, its free tier
(100k requests/day) comfortably covers a low-qps / medium-user / small-data MVP, and the
repository is **already wired for it** — `@astrojs/cloudflare` v13.5.0, `wrangler.jsonc`
with `nodejs_compat` and an `ASSETS` binding, and a Supabase secrets schema in
`astro.config.mjs`. Choosing anything else means swapping the Astro adapter and discarding
working config. With "minimize cost" as the decisive interview answer, external Supabase
removing any co-location need, and no requirement for persistent connections, Cloudflare
wins on cost, fit, and zero migration churn.

## Platform Comparison

Scored Pass / Partial / Fail against the five agent-friendly criteria, then weighted by the
interview answers (cost-minimize = heavy; external services fine = co-location irrelevant;
single-region = edge is a bonus not a gate; no persistent connections = no serverless
penalty; no platform familiarity = no tie-break).

| Platform | CLI-first | Managed / serverless | Agent-readable docs | Stable deploy API | MCP / integration | Cost @ MVP |
|---|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass | Pass | Pass* | **$0** free (100k req/day) → $5 floor if paid |
| **Render** | Pass | Pass | Pass | Pass | Partial (MCP can't deploy / can't make free instances) | $7/mo Starter (free tier cold-starts) |
| **Netlify** | Partial (rollback UI-only) | Pass | Pass | Pass | Pass (official GA MCP) | Free credit tier covers low traffic |
| Vercel | Pass | Pass | Pass | Pass | Partial (MCP beta) | **$20/mo** (Hobby is non-commercial) |
| Railway | Partial (rollback via dashboard) | Pass | Pass | Pass | Pass | $5/mo floor, no free tier |
| Fly.io | Partial (no 1-cmd rollback) | Partial (Dockerfile + unmanaged DB) | Partial (no official llms.txt) | Partial (multi-step rollback) | Partial (experimental flyctl mcp) | ~$2–8/mo, no free tier |

\* Cloudflare ships 16 first-party MCP servers (Docs, Bindings, Builds, Observability, …)
that are production-available but carry **no explicit GA label** — a real but soft signal.

**Per-platform notes:**

- **Cloudflare** — `wrangler deploy` / `wrangler rollback [VERSION_ID]` / `wrangler tail` give the full unattended ops loop; `developers.cloudflare.com/llms.txt` + `Accept: text/markdown` make docs agent-readable; edge runtime is fully managed (no OS/TLS/routing surface). The one real ceiling is **10ms CPU per invocation on the free tier**, not request count.
- **Render** — Web Service (Node) for SSR + free Static Site for SSG; full native WebSocket and a real always-on process make it the cleanest fallback if edge constraints bite. Render CLI is GA; rollback is via REST API, not a CLI subcommand; MCP can't trigger deploys.
- **Netlify** — closest serverless sibling to Cloudflare, official GA MCP server (`npx @netlify/mcp`), credit-based free tier covers a low-traffic MVP. Gap: there is **no `netlify rollback` CLI command** — rollback ("Publish deploy") is UI-only, an agent blind spot.
- **Vercel** — excellent DX and Astro support, but **Hobby (free) prohibits commercial use**, so a commercial SaaS like OrderLY starts at **Pro $20/mo/seat**. Against a cost-minimize priority that drops it below the free/near-free options. Cannot host WebSocket servers.
- **Railway** — great co-located DBs (Postgres/Redis one-click) and GA MCP, but co-location is irrelevant here (external Supabase) and there is **no permanent free tier** ($5/mo floor).
- **Fly.io** — strongest persistent-process story, but requires Dockerfile ownership, its first-party Postgres is explicitly **unmanaged**, there's no official `llms.txt`, and rollback is multi-step. Too much operational surface for a solo, after-hours MVP.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on every axis that matters here: **$0 at MVP scale**, all five criteria pass, edge-native
(a free bonus given single-region is fine), and — decisively — **already configured in the repo**,
so there is no adapter swap and no throwaway work. `astro dev` runs the real `workerd` runtime
(Astro 6), giving local fidelity without a separate `wrangler dev` step. The honest caveat is the
free-tier 10ms-CPU ceiling and the `workerd ≠ Node` surface (see risk register), both manageable.

#### 2. Render

The best "escape hatch." If edge constraints (CPU ceiling, `workerd` incompatibilities, no `sharp`)
prove painful, Render runs the same app as a plain Node server (`@astrojs/node`) with no edge limits,
full persistent processes (useful if realtime is ever un-degraded from polling), and a predictable
$7/mo. Gap vs. Cloudflare: not free at always-on, requires an adapter swap, and MCP can't deploy.

#### 3. Netlify

The closest like-for-like serverless alternative — same mental model as Cloudflare, an official GA
MCP server, and a free credit tier. Migration is just an adapter swap to `@astrojs/netlify`. Gap vs.
Cloudflare: rollback is UI-only (no CLI command), which breaks the unattended agent ops loop, and it
has no inherent cost or edge advantage over the recommendation.

## Anti-Bias Cross-Check: Cloudflare

### Devil's Advocate — Weaknesses

1. **The free tier's real ceiling is CPU, not requests.** Free = 100k req/day but only **10ms CPU per invocation**. SSR-rendering a 20+ item menu (React 19 + Astro) on a cold/complex route can exceed 10ms → `1102 Worker exceeded CPU` errors, quietly forcing the $5 plan (50ms) sooner than the "free" headline implies.
2. **`workerd` is not Node.** `@astrojs/cloudflare` v13 (required for Astro 6) **dropped Pages support**, removed `platformProxy`/`Astro.locals.runtime`, and moved env access to `import { env } from 'cloudflare:workers'`. Node-API-assuming deps need `nodejs_compat`; CommonJS-only deps are rejected by the runtime.
3. **Image thumbnails (FR-005) can't use `sharp`** — it doesn't run on `workerd`. Generation must route through **Cloudflare Images (paid)** or **Supabase Storage transforms**, an unplanned dependency the PRD already flagged.
4. **Two moving targets at once.** The .NET→Astro migration is incomplete and uncommitted; debugging edge-runtime quirks while the scaffold is still in flux makes it hard to attribute failures.
5. **MCP servers are unlabeled GA** — usable, but don't build a workflow that depends on their stability guarantees.

### Pre-Mortem — How This Could Fail

The team ships the MVP on Cloudflare's free tier and it works in demos. Then a real lokal loads its
30-item menu with photos: the `@supabase/ssr` cookie-auth path, copied from a Vercel/Node tutorial,
behaves subtly differently on `workerd` — sessions intermittently drop because cookie handling was
wired to Node response semantics. Thumbnail generation, deferred as "we'll just use sharp," turns out
impossible on edge and is hacked in at the last minute via an extra service. As menu-render routes
grow, intermittent `1102` CPU errors surface under load and are hard to reproduce because `astro dev`
doesn't enforce the 10ms ceiling. Each issue is individually solvable, but together they eat the slim
7-week, after-hours budget — and because the .NET→Astro migration was still half-committed when edge
debugging started, nobody can cleanly separate scaffold bugs from runtime bugs.

### Unknown Unknowns

- **Supabase auth on edge is the real risk, not Cloudflare itself.** `@supabase/ssr` cookie/session handling must be adapted to the Workers `Request`/`Response` model; most tutorials assume Node/Vercel.
- **Secrets don't come from `.env` in production.** A deployed Worker reads vars via `wrangler secret` / `vars`, accessed through `cloudflare:workers` (Astro `envField`), **not** `process.env`. Local `.env` working ≠ prod working.
- **No persistent DB connections from edge.** Every SSR→Supabase call is a fresh outbound request; use Supabase's pooler in **transaction mode** or the REST path — never a long-lived `pg` connection.
- **Cloudflare Builds (the chosen CI) is newer than Pages CI** — different build limits/behavior; less battle-tested than the legacy Pages pipeline.
- **`astro dev` now runs real `workerd`** (Astro 6), so `wrangler dev` is largely redundant/legacy — older tutorials will steer you wrong.
- **Config/doc drift:** `tech-stack.md` records `deployment_target: cloudflare-pages`, but the live config is the newer **Workers Static Assets** model (`main: @astrojs/cloudflare/entrypoints/server`). Pages and Workers have converged; treat "Pages" references as legacy.

## Operational Story

- **Preview deploys**: Cloudflare Builds creates a preview URL per branch/PR build (`*.workers.dev` style preview alias) on merge-request branches; for non-production previews you can gate access with **Cloudflare Access**. Locally, `astro dev` runs the real `workerd` runtime, so preview fidelity is high before any cloud build. Manual preview: `wrangler versions upload` produces a preview version URL without promoting it to production.
- **Secrets**: Production secrets live in **Worker secrets**, set with `wrangler secret put SUPABASE_URL` / `wrangler secret put SUPABASE_KEY` (or non-secret `vars` in `wrangler.jsonc`); the app reads them via Astro `envField` → `cloudflare:workers`, never `process.env`. Local dev uses a git-ignored `.dev.vars` file. Rotation = re-run `wrangler secret put` (creates a new version) then `wrangler versions deploy`. Only the account owner / authenticated CLI session can read or set them.
- **Rollback**: `wrangler rollback [VERSION_ID]` reverts to a prior immutable version in seconds (list with `wrangler deployments list` / `wrangler versions list`). Caveat: rollback reverts **code only** — it does not undo Supabase schema migrations, so DB changes must be backward-compatible or rolled back separately.
- **Approval**: A human should approve (a) promoting a version to production (`wrangler versions deploy` / production publish), (b) rotating the primary `SUPABASE_KEY`, and (c) any destructive Supabase migration. An agent may unattended: build, `wrangler versions upload` (preview), `wrangler tail` (read logs), and `wrangler rollback` to a known-good version during an incident.
- **Logs**: Agent reads runtime logs read-only via `wrangler tail [WORKER]` (live) and build/deploy logs via `wrangler deployments list` + the Cloudflare Builds log surface; `observability.enabled: true` is already set in `wrangler.jsonc`, so Workers Logs are queryable. Cloudflare's Observability MCP server exposes the same read-only access as typed tools.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| SSR route exceeds 10ms free-tier CPU → `1102` errors | Devil's advocate / Pre-mortem | M | M | Keep menu-render routes lean (prerender static parts, server islands for dynamic bits); load-test the menu page; budget the $5 paid plan (50ms) as a known, cheap fallback. |
| `@supabase/ssr` cookie auth behaves differently on `workerd` | Pre-mortem / Unknown unknowns | M | H | Use the Workers-adapted Supabase SSR pattern (Request/Response cookies), not a Node/Vercel tutorial; write an auth smoke test that runs against a deployed preview, not just `astro dev`. |
| Thumbnail generation (FR-005) can't use `sharp` on edge | Devil's advocate / Research finding | H | M | Decide up front: Supabase Storage image transforms (preferred — co-located with the photos) or Cloudflare Images; do NOT plan a server-side `sharp` step. Record the choice before building FR-005. |
| Secrets work locally but missing/empty in deployed Worker | Unknown unknowns | M | M | Set every secret via `wrangler secret put`; verify with a deployed health check that reads each env var; keep `.dev.vars` ↔ Worker secrets in sync. |
| Supabase connection exhaustion from per-request edge calls | Unknown unknowns | L | M | Use Supabase pooler in transaction mode or the REST/`@supabase/supabase-js` HTTP path; never a long-lived `pg` connection from a Worker. |
| Scaffold-vs-runtime bug confusion during incomplete migration | Devil's advocate / Pre-mortem | M | M | Finish and commit the .NET→Astro migration to a clean baseline BEFORE deep edge-runtime work; deploy a trivial "hello" Worker first to validate the pipeline end-to-end. |
| Cloudflare Builds (CI) less mature than legacy Pages CI | Unknown unknowns | L | L | Validate the auto-deploy-on-merge flow with a throwaway commit early; keep `wrangler deploy` as a manual fallback path. |
| MCP servers unlabeled GA — stability not guaranteed | Devil's advocate | L | L | Use MCP for convenience, but keep `wrangler` CLI as the authoritative ops path so nothing critical depends on MCP. |

## Getting Started

The repo is already configured for Cloudflare Workers (adapter, `wrangler.jsonc`, secrets schema),
so this is wiring-up, not setup. Commands validated against the pinned versions: `astro ^6.3.1`,
`@astrojs/cloudflare ^13.5.0`, `wrangler ^4.90.0`.

1. **Authenticate the CLI:** `npx wrangler login` (then `npx wrangler whoami` to confirm the account).
2. **Provide local secrets:** create a git-ignored `.dev.vars` with `SUPABASE_URL=…` and `SUPABASE_KEY=…` (mirroring `.env.example`); run `npm run dev` (`astro dev`) — it executes the real `workerd` runtime, so no separate `wrangler dev` is needed.
3. **Set production secrets:** `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`.
4. **Build & deploy:** `npm run build` then `npx wrangler deploy` (uses `main: @astrojs/cloudflare/entrypoints/server` and the `ASSETS` binding already in `wrangler.jsonc`). Confirm the returned `*.workers.dev` URL responds.
5. **Wire CI (optional now):** connect the repo to **Cloudflare Builds** for auto-deploy-on-merge (per `tech-stack.md` hints); validate with one throwaway commit before relying on it. Read logs with `npx wrangler tail`.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (beyond noting Cloudflare Builds as the chosen provider)
- Production-scale architecture (multi-region, HA, DR)
