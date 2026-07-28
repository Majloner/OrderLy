# Staff Accounts and Roles (S-02) — Plan Brief

> Full plan: `context/changes/staff-accounts-roles/plan.md`
> Change notes: `context/changes/staff-accounts-roles/change.md`

## What & Why

The owner needs to hand day-to-day work to their team without giving everyone their own
login credentials. This slice lets the owner provision waiter and kitchen accounts from a
`/staff` panel, assign and change roles, and deactivate people who leave — with no
self-registration path for staff. Implements PRD FR-003 and the Access Control section;
roadmap slice S-02, prerequisite S-01 is done.

## Starting Point

The F-01 tenancy foundation already has the `staff_role` enum, a `profiles` table keyed
to `auth.users`, and two SECURITY DEFINER resolvers (`current_company_id()`,
`current_staff_role()`) that every RLS policy in the schema calls. `profiles` has only
SELECT and UPDATE policies — INSERT and DELETE were **deliberately withheld** as a
tenancy safeguard. The signup trigger `handle_new_user()` is gated on a `company_name`
metadata key specifically so that staff creation in this slice would not spawn stray
companies. `profiles` has no email and no deactivation column, and `auth.admin.*` has
never been called anywhere in this codebase.

## Desired End State

An owner opens **Panel → Pracownicy**, adds a staff member with an email, a temporary
password they choose, and a role (kelner or kuchnia), and hands over the credentials in
person. That person signs in immediately and reaches `/dashboard` with no access to
`/menu` or `/settings`. The owner can rename them, switch their role, deactivate them,
and reactivate them later. A deactivated account is denied at the database level, not
just in the UI.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Credential delivery | Owner sets a temporary password; `auth.admin.createUser` with `email_confirm: true` | No SMTP is configured, so `inviteUserByEmail` would fail silently, and owner and staff are physically co-located in a small restaurant. |
| Removal semantics | Soft `deactivated_at`, reactivatable | Mirrors the soft-delete already chosen for menu items and preserves who-did-what once orders arrive in S-09. |
| Staff identity | Denormalized `email` column on `profiles` | `auth.users.email` is unreadable under RLS, and this keeps the list a plain RLS-scoped SELECT like every other feature here. |
| Authorization boundary | Real `profiles_insert_owner` / `profiles_delete_owner` policies; service role only for the `auth.users` row | Keeps RLS as the enforcement boundary so the isolation suite can prove a waiter cannot self-provision. |
| Lockout guards | Self-demotion and self-deactivation blocked by a `BEFORE UPDATE` trigger | An RLS `with check` cannot see `OLD`, and an accidental self-demotion is unrecoverable without DB access. |
| Assignable roles | `waiter` and `kitchen` only | Matches FR-003 verbatim, and one-owner-per-company makes the lockout guard trivially complete. |
| Deactivation enforcement | Both resolvers return `NULL` when `deactivated_at is not null` | One change makes deactivation real across every existing table and every table S-05→S-11 will add. |
| Editable fields | Role, full name, and reactivate | Covers the realistic day-to-day cases using only the existing UPDATE policy. |

## Scope

**In scope:** `profiles.email` + `profiles.deactivated_at`; owner INSERT/DELETE policies;
resolver-level deactivation; self-harm trigger; `src/lib/staff-admin.ts` service-role
module; `GET`/`POST /api/staff` and `PUT /api/staff/[id]`; `/staff` page with a React
island; middleware route gating and stale-session eviction; RLS assertions and zod unit
tests.

**Out of scope:** SMTP and email invitations; password reset or "forgot password"; email
changes after creation; promoting anyone to `owner`; hard delete in the UI; an
"at least one active owner" count trigger; instant session revocation; any change to what
waiter and kitchen roles can actually *do* (that is S-05 and S-11); refactoring
`guardMenuRequest` into a shared helper (forbidden while S-06 is in flight).

## Architecture / Approach

Schema → API → UI, the order every prior slice in this repo used.

The pivotal choice is **where authorization lives**. Creating an `auth.users` row is
inherently privileged, so that single call escalates to the service-role key, following
the `src/lib/storage.ts` precedent. Everything else — the `profiles` insert, role
changes, deactivation — goes through the ordinary user-scoped client so RLS stays the
real enforcement boundary. That split is deliberate and is what makes the isolation suite
able to prove tenant safety.

It also creates the one ordering hazard in the plan: the auth user exists before the
profile row does, so a failed insert must trigger a compensating
`auth.admin.deleteUser`, or the email is permanently burned.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema, resolvers & RLS | Migration + isolation assertions: two columns, two policies, the self-harm trigger, deactivation-aware resolvers | The resolvers back **every** RLS policy in the schema — a mistake silently disables tenancy everywhere. Mitigated by re-running all eight pre-existing assertions. |
| 2. Admin module & staff API | `staff-admin.ts`, zod schemas, `guardStaffRequest`, the endpoints | First-ever `auth.admin` use here, with no test double; the orphaned-auth-user window on insert failure. |
| 3. Staff panel UI & wiring | `/staff` page, island, hook, middleware and nav wiring | Middleware is a shared file with S-06 and the stale-session eviction must not create a redirect loop. |

**Prerequisites:** S-01 done (it is). `SUPABASE_SERVICE_ROLE_KEY` present in `.dev.vars`
locally — and worth confirming it was actually set as a Worker secret during S-04, since
`deploy-plan.md` only documents `SUPABASE_URL` and `SUPABASE_KEY`. Supabase CLI linked
for `npm run test:rls`.

**Estimated effort:** ~3 sessions, one per phase, with a manual-verification pause after
each.

## Open Risks & Assumptions

- `npm run test:rls` runs against the **linked remote** project, not a local container.
  Phase 1 changes two functions the live app depends on — apply and test when nobody is
  relying on the dev environment.
- The temporary password is handed over verbally or on paper and never rotated. Acceptable
  for MVP; the absence of any reset path becomes a real support burden the first time
  someone forgets it.
- `profiles.email` is a display copy, not the source of truth — it drifts if someone edits
  the email in the Supabase dashboard.
- `profiles_delete_owner` ships tested but is not wired to any UI. Justified as the
  DB-level counterpart to the INSERT policy; flagged so it does not read as an oversight.
- Deactivation takes effect on the deactivated user's *next* request; a staff member with
  an open tab keeps their current page until they navigate.
- Four files are shared append-only with the parallel S-06 branch: `src/middleware.ts`,
  `src/pages/dashboard.astro`, `src/types.ts`, `supabase/tests/rls_isolation.sql`.

## Success Criteria (Summary)

- An owner can provision a working waiter or kitchen account in under a minute, without
  touching the Supabase dashboard.
- A waiter cannot create accounts, cannot reach `/staff` or `/menu`, and cannot promote
  themselves — proven by the RLS suite, not just the UI.
- Deactivating someone actually denies them at the database level, and reactivating
  restores them.
