# OrderLY

> _Keep your orders orderly._

OrderLY is a multi-tenant SaaS for small and medium restaurants. It replaces scattered menu management (paper, files, phone calls) and waiter-dependent ordering with one simple tool: an active menu with photos, permanent QR codes at every table, anonymous client ordering, and role-based staff panels.

**What the MVP does:**

- **Company accounts with roles** — owner, waiter, and kitchen, each with its own scope; the kitchen gets a dedicated kitchen-display view (prep queue, status sorting, mark-as-ready).
- **Active menu management** — categories, items, prices, photos, ingredients and allergen labels.
- **Multilingual menu with AI translation** — translations are generated on demand for missing languages, then cached in the database and served without further AI calls.
- **Availability module** — items toggle between available / unavailable / sold out; clients and panels pick changes up via short-interval polling (~3–5 s, a deliberate MVP simplification — no WebSockets).
- **Room editor and permanent QR codes** — tables identified as venue name + number (optional description), activated/deactivated (e.g. seasonal), each with a permanent QR code that survives menu edits.
- **Ordering by clients and staff** — clients order anonymously after scanning the QR (session bound to the table, no registration); staff order from their panel. Order lifecycle: received → preparing → in progress → completed; once an order is "in progress", only staff may edit it.
- **Settlement summary** — amount and items visible in the system; payment happens at the register (online payments are phase 2).

Out of MVP scope: online payments, fiscalization/POS, inventory, reservations, native mobile apps, advanced analytics, multi-location chains. Product scope and decisions live in [OrderLY-MVP.md](OrderLY-MVP.md) — treat it as the source of truth. Contributor rules (hard rules, conventions, commands) live in [AGENTS.md](AGENTS.md).

## Tech Stack

- [Astro](https://astro.build/) v6 — server-first rendering (`output: "server"`)
- [React](https://react.dev/) v19 — islands for interactive components only
- [TypeScript](https://www.typescriptlang.org/) v5 — strict mode
- [Tailwind CSS](https://tailwindcss.com/) v4 + [shadcn/ui](https://ui.shadcn.com/) (new-york)
- [Supabase](https://supabase.com/) — Postgres (with Row Level Security enforcing per-`company_id` tenant isolation), Auth, Storage for dish photos
- [Cloudflare Workers](https://workers.cloudflare.com/) — edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)
- [Docker](https://www.docker.com/) for the local Supabase stack (~7 GB RAM)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/Majloner/OrderLy.git
cd OrderLy
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` — start the dev server (Cloudflare workerd runtime)
- `npm run build` / `npm run preview` — production build / preview
- `npm run deploy` — build **and** deploy to Cloudflare (see [Deployment](#deployment))
- `npm run lint` / `lint:fix` / `format` — ESLint 9 (type-checked) + Prettier
- `npm run typecheck` — `astro check`
- `npm run test` — unit tests (DB-free)
- `npm run test:integration` — integration tests (needs `npx supabase start` + `.env.test`)
- `npm run test:rls:local` — SQL RLS isolation suite against the local stack
- `npm run test:e2e` — Playwright end-to-end tests
- `npm run db:new` / `db:push` / `db:reset` — Supabase migration helpers

Before adding tests, read `context/foundation/test-plan.md` §6 — it carries the cookbook, fixtures, and traps.

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro routes: dashboard, menu, room, staff, settings
│ │ ├── api/ # API endpoints (auth, company, menu, room, staff)
│ │ └── auth/ # signin, signup, confirm-email
│ ├── components/ # UI components (Astro & React, shadcn ui/, hooks/)
│ ├── lib/ # services & helpers (supabase.ts, utils.ts)
│ ├── middleware.ts # auth → context.locals.user, PROTECTED_ROUTES
│ └── types.ts # shared types
├── supabase/migrations/ # database schema + RLS policies
├── tests/ # unit, integration and e2e suites
├── tools/ # AI tooling packages (see AGENTS.md → "AI Tooling")
├── context/ # 10x-cli working area (plans, research, foundation docs)
├── public/ # public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for the database, authentication and photo storage. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

3. Apply the database schema (migrations + RLS policies from `supabase/migrations/`):

```bash
npx supabase db reset
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

Then push the schema with `npm run db:push`.

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                   |
| --------------------- | ------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                   |
| `/auth/signup`        | Company + owner sign-up form                                  |
| `/auth/confirm-email` | Post-signup "check your inbox" page                           |
| `/dashboard`          | Protected panel (redirects to `/auth/signin` when logged out) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## AI Tooling

The repo ships its own AI tooling under `tools/` (not app code): a scripted **code-review agent** that gates every PR via `.github/workflows/code-review.yml`, and the **`@majloner/ai-toolkit`** npm package that distributes team skills and rules through GitHub Packages. Details and conventions: [AGENTS.md → AI Tooling](AGENTS.md#ai-tooling-tools).

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/):

```bash
npm run deploy
```

Always deploy through that script, **not** a bare `wrangler deploy` — `astro build` writes `.wrangler/deploy/config.json`, which points wrangler at the adapter-generated worker config; without the build step wrangler falls back to the root `wrangler.jsonc` and fails (details in [AGENTS.md](AGENTS.md)).

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions on every PR to `main`:

- **CI** (`ci.yml`) — `lint · typecheck · unit` and `integration · rls` (spins up local Supabase)
- **AI Code Review** (`code-review.yml`) — the code-review agent posts a verdict comment and fails the check on `request_changes`
- **Publish AI Toolkit** (`publish-ai-toolkit.yml`) — validates the toolkit package on PR and publishes it to GitHub Packages on push to `main` (paths-filtered)

Configure `SUPABASE_URL`/`SUPABASE_KEY` (integration tests) and `CLAUDE_CODE_OAUTH_TOKEN` (AI review) as repository secrets.

## License

MIT
