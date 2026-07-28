# Frame Brief: Per-venue staff login

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

An owner cannot create a staff account with an email address that is already
registered anywhere in OrderLY — the 409 fires across tenant boundaries.
Consequences: one person cannot hold accounts at two venues, and a departed
employee's address never returns to the pool. Surfaced as finding F4 of the
S-02 implementation review.

## Initial Framing (preserved)

- **User's stated cause or approach**: email being the login identifier, and
  globally unique, is the wrong identity model for staff.
- **User's proposed direction**: give staff a login unique within the venue,
  plus a venue identifier at sign-in (a venue code field, or a per-company URL).
- **Pre-dispatch narrowing**: neither consequence is a live pain — an accidental
  duplicate is unrealistic, and a person working at two OrderLY venues "can
  happen and we don't have to block it". The stated principle: *"pula adresów i
  jej weryfikacja ma odbywać się w obrębie jednej firmy, nie całej aplikacji."*
  Scope is staff only. Identity model initially answered as **one account, many
  venues**, then reversed mid-investigation to **"jeden login, jeden lokal. mail
  może się powtórzyć"** — one login belongs to one venue; the email is data and
  may repeat. Final narrowing: the login is unique **within the venue only**.

## Dimension Map

1. **Auth identity layer** — `auth.users.email` is globally unique and is the
   credential `signInWithPassword` resolves on. ← initial framing
2. **Membership model** — `profiles.user_id` is the PRIMARY KEY, so one person
   maps to exactly one company by construction.
3. **Request-time tenant resolution** — `current_company_id()` /
   `current_staff_role()` return a single company from `auth.uid()`; middleware
   stores one scalar `company_id`.
4. **Venue-ownership model** — PRD Non-Goal: "konto odpowiada jednemu lokalowi".

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Auth layer is where it breaks | `auth.users_email_partial_key` — `CREATE UNIQUE INDEX ... ON auth.users (email) WHERE (is_sso_user = false)`, verified live in the Supabase-managed `auth` schema. The 409 is raised at `src/pages/api/staff/index.ts:69` from this constraint, before any tenant scoping. | **STRONG** — this is the mechanism |
| 2. Membership 1:1 is the real blocker | `tenancy_core.sql:29` — `user_id uuid primary key`. Real, but a *second, independent* blocker behind #1. Relaxing it fails **silently**: the resolvers are non-set SQL functions, so >1 row returns an arbitrary first row with no `ORDER BY` and no error; the two resolvers can independently pick different memberships inside one policy predicate. | **STRONG but out of scope** — user reversed away from it |
| 3. Tenant resolution assumes one company | 24 live RLS policies across 7 tables, 50 resolver invocations. `src/middleware.ts:37-41` uses `.maybeSingle()`, which on >1 row returns `PGRST116` and `data = null`; the error is discarded, so the user is force-signed-out at `:59-65`. 18 read sites of `locals.company_id`/`role` across 5 files; `env.d.ts:4-5` types both as scalars. | **STRONG as blast radius**, not as cause |
| 4. Venue-ownership model | PRD Non-Goal `prd.md:246`, mirrored in `shape-notes.md:277`, `roadmap.md:258`, `OrderLY-MVP.md:41`, `AGENTS.md:3`. F-01 consumed it: *"One user = one company is authoritative → a 1:1 `profiles` table is sufficient; no M:N membership needed"* (`archive/2026-07-04-multitenant-rls-foundation/plan.md:21`). | **STRONG** — and it settles the question |

## Narrowing Signals

- The user's mid-investigation assertions ("one account, many venues"; "an owner
  can have several venues") **directly contradicted an explicit PRD Non-Goal**.
  Presented with the conflict, the user reversed: *"okej to olej — jeden login,
  jeden lokal."* This eliminated hypotheses 2 and 3 as targets and avoided a
  change touching 24 RLS policies and the tenancy foundation.
- Neither stated consequence is a live pain. The motivation is that address
  validation should be a per-company concern, not an application-wide one.
- The login is to be unique **within the venue**, not globally. This is the
  decisive signal: it means the login alone cannot identify an account at
  sign-in, so a venue identifier at sign-in is genuinely required — the initial
  proposed direction stands.

## Cross-System Convention

Venue identification at request time is **entirely absent** in shipped code.
No route segment, no `companies` column (the table is `id, name, address,
opening_hours, created_at` — no slug, no code, `name` not even unique), no
subdomain or route pattern in `wrangler.jsonc`, no company-scoped anon policy.
Every shipped path resolves the tenant one way: `profiles.company_id` of an
authenticated user.

**The load-bearing discovery**: a venue identifier is now on the critical path
of *two* changes that have each deferred designing it.

- **S-07 `table-qr-codes`** owns FR-011, the permanent per-table QR code — the
  product's stated wedge and the dependency of the S-08 north star. Status
  `proposed`, no code, no change folder. Three documents defer the identifier's
  design to it: `20260727120000_room_layout_tables.sql:20-24`,
  `room-layout-tables/plan.md:119`, and `lessons.md:15-18` (anon RLS scoping
  "needs the QR token that S-07 owns").
- **This change** needs the same primitive for sign-in.

FR-011 also constrains it: printed codes must stay valid forever, so the
identifier must be independent of mutable menu/pricing data.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the email field does two jobs at
> once — it is the login credential, which Supabase forces to be globally
> unique, and a per-venue contact attribute the owner wants to be able to
> repeat. Those two roles have to be separated.

The initial proposed direction **held up**: staff need their own login
identifier, scoped to the venue, and a venue identifier at sign-in. What
sharpened is the *cause*. The problem is not that `auth.users.email` is globally
unique — that is a fixed property of the Supabase-managed `auth` schema that
cannot be scoped and does not need to be fought. The problem is that email is
being used as the credential at all. Once staff have their own identifier, the
global constraint becomes irrelevant, because the auth-layer address stops being
something a human chooses.

## Confidence

**HIGH** — the mechanism is verified directly against the live database, the
narrowing signal was decisive, and the conclusion survived a pressure test that
was run without naming the hypothesis.

One sequencing question is unresolved and belongs to planning, not framing: the
venue identifier is a shared primitive that S-07 nominally owns. Designing it
here in isolation risks either building something S-07 replaces, or silently
deciding S-07's design without its QR-permanence constraint in view.

## What Changes for /10x-plan

Plan the separation of credential from contact attribute for **staff accounts
only** — owners keep their real email and self-registration, and the PRD
Non-Goal (account = one venue) stands, so there is no multi-membership, no
venue switcher, and no change to `profiles` being 1:1.

The plan's **first question must be the sequencing one**: does this change
define the venue identifier that S-07 will later consume, or does it wait for
S-07 and consume that? Given S-07 is unstarted, has no folder, and owns the
product's wedge, this is a real decision with real cost either way — it should
be answered explicitly rather than defaulted into.

## References

- Live constraint: `auth.users_email_partial_key` (queried directly, 2026-07-28)
- Origin: `context/changes/staff-accounts-roles/reviews/impl-review.md:93-105` (F4)
- Recorded constraint: `context/changes/staff-accounts-roles/change.md:24-30`
- PRD Non-Goal: `context/foundation/prd.md:246`
- F-01 tenancy decision: `context/archive/2026-07-04-multitenant-rls-foundation/plan.md:21`
- Schema: `supabase/migrations/20260705212949_tenancy_core.sql:20-36`
- Resolvers: `supabase/migrations/20260727220415_staff_accounts_roles.sql:52-76`
- Tenant resolution: `src/middleware.ts:37-45`, `src/lib/api.ts:29-95`
- S-07 deferral: `supabase/migrations/20260727120000_room_layout_tables.sql:20-24`,
  `context/changes/room-layout-tables/plan.md:119`, `context/foundation/lessons.md:15-18`
- Investigation tasks: #5 (membership blast radius), #6 (prior decisions)
