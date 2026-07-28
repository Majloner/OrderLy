# Staff Accounts and Roles (S-02) Implementation Plan

## Overview

Give the owner a `/staff` panel that provisions waiter and kitchen accounts with an
owner-chosen temporary password, lists them, lets the owner change role and display
name, and deactivates/reactivates them. Deactivation is enforced inside the two SQL
resolver functions that back every RLS policy in the schema, so it applies to menu,
storage, and every table S-05 through S-11 will add — without those slices needing
to know it exists.

Implements PRD FR-003 and the Access Control section ("konta kelnera i kuchni
tworzy/zaprasza właściciel i przypisuje im role. Brak samodzielnej rejestracji
personelu"). Roadmap slice S-02; prerequisite S-01 is done.

## Current State Analysis

**What exists.** The tenancy foundation from F-01 is complete and this change slots
into it rather than extending it:

- `public.staff_role` enum `('owner','waiter','kitchen')` —
  `supabase/migrations/20260705212949_tenancy_core.sql:15`.
- `public.profiles (user_id pk → auth.users on delete cascade, company_id not null →
  companies on delete cascade, role staff_role not null, full_name text, created_at)`
  — `20260705212949_tenancy_core.sql:28-36`. No `email`, no `deactivated_at`, no
  `updated_at`, no triggers.
- Two SECURITY DEFINER resolvers with `set search_path = ''`, `current_company_id()`
  and `current_staff_role()` — `20260705212949_tenancy_core.sql:44-66`. Every RLS
  policy in the schema calls one or both.
- Exactly two policies on `profiles`: `profiles_select_same_company` (SELECT,
  authenticated, `company_id = current_company_id()`) and `profiles_update_owner`
  (UPDATE, owner-only) — `20260705212949_tenancy_core.sql:90-99`.
- `handle_new_user()` on `auth.users` insert, gated on
  `raw_user_meta_data ? 'company_name'` — current version at
  `20260708124756_menu_categories_items.sql:146-173`, trigger at
  `20260705232213_owner_registration_trigger.sql:31-34`.
- Middleware resolves `locals.user` / `locals.company_id` / `locals.role` per request
  and gates `PROTECTED_ROUTES` + `OWNER_ROUTES` — `src/middleware.ts:4-56`.
- Service-role client precedent: private lazy `admin()` factory reading
  `astro:env/server`, returning `null` on missing key — `src/lib/storage.ts:14-21`.
- API conventions: `guardMenuRequest` / `jsonData` / `jsonError` / `parseBody` /
  `isUniqueViolation` — `src/lib/api.ts:7-91`. Shared zod in `src/lib/schemas/menu.ts`,
  consumed by both routes and islands.
- UI conventions: `useMenu` hook + `callMenuApi` (`src/components/hooks/useMenu.ts`),
  `MenuManager` container with refetch-after-mutation, two-component dialog split
  (`CategoryDialog.tsx:23-24`), `<ul>/<li>` rows with icon-only ghost buttons.
- RLS test harness: hand-rolled transactional SQL, `set local role` +
  `set local request.jwt.claims` + `DO` blocks that `raise exception` —
  `supabase/tests/rls_isolation.sql`. Run with `npm run test:rls` against the
  **linked remote** project. A waiter fixture (`dddddddd-…`) is already seeded at `:36`.

**What is missing, and why each gap is load-bearing:**

1. **No INSERT and no DELETE policy on `profiles`.** Withheld deliberately —
   `20260705212949_tenancy_core.sql:5-10` warns that a permissive INSERT would let any
   user self-assign into another company or set their own role to owner.
2. **No identity column.** A staff list must show who each account is, but
   `auth.users.email` is unreadable from the anon-key client under RLS.
3. **No deactivation concept.** `profiles` has no flag, and the resolvers would happily
   keep returning a company and role for a "removed" employee.
4. **`handle_new_user()` no-ops for staff.** It is gated on `company_name`, which admin
   -created staff will not pass — deliberately, per the comment at
   `20260705232213_owner_registration_trigger.sql:5-7`. So the `profiles` row for a new
   staff member has to be inserted by this feature.
5. **`profiles_update_owner` permits self-demotion.** An owner can set their own role to
   `waiter`; `current_staff_role()` then returns `waiter` and the company has nobody who
   can write anything. Unrecoverable without direct DB access.
6. **`auth.admin.*` has never been called in this repo.** Verified by grep: the only
   service-role usage anywhere is `src/lib/storage.ts`. No precedent, no test double.
7. **No SMTP.** `[auth.email.smtp]` is entirely commented out in
   `supabase/config.toml:220-227`, `enable_confirmations = false` (`:209`), and the
   `email_sent = 2` per-hour rate limit (`:184`) requires SMTP to be enabled anyway.
   `inviteUserByEmail` would fail silently.

## Desired End State

A signed-in owner opens **Panel → Pracownicy** (`/staff`) and sees a list of their
company's staff: display name, email, a role badge, and deactivated accounts visibly
dimmed. "Dodaj pracownika" opens a dialog taking email, temporary password, optional
full name, and a role (kelner / kuchnia only). On save the account exists and the staff
member can sign in immediately with those credentials and land on `/dashboard` — with
no access to `/menu` or `/settings`.

The owner can edit an existing account's role and full name, deactivate it, and
reactivate it. The owner's own row shows role and deactivation controls disabled.

A deactivated staff member who still holds a session cookie is signed out on their next
request to any protected route, and — critically — any query they could otherwise make
returns zero rows, because `current_company_id()` and `current_staff_role()` both
return `NULL` for them.

**Verification:** `npm run test:rls` passes with the new assertions (waiter cannot
provision staff, cross-tenant provisioning denied, self-demotion rejected, deactivated
staff sees nothing, and all eight pre-existing assertions still hold);
`npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass; and the
manual walkthrough in Testing Strategy completes.

### Key Discoveries:

- The signup trigger's `company_name` gate was written **for this slice** —
  `20260705232213_owner_registration_trigger.sql:5-7` names S-02 explicitly. Admin-created
  staff must not pass `company_name` in metadata; the trigger then no-ops and we insert
  the profile ourselves.
- `handle_new_user()` inserts the owner's `profiles` row
  (`20260708124756_menu_categories_items.sql:159-160`) and must be updated in the same
  migration that adds `profiles.email`, or every future owner registration writes a NULL
  email.
- `profiles_select_same_company` filters on the **caller's** company, not the row's
  state — so an owner keeps seeing deactivated rows even after the resolver change.
  That is exactly what the reactivate flow needs; no extra policy required.
- Making the resolvers return `NULL` for a deactivated profile means the deactivated
  user's own `profiles` SELECT in `src/middleware.ts:34-38` returns nothing, so
  `locals.role` and `locals.company_id` are already `null` with no extra query.
- `menu_categories` uses a case-insensitive functional unique index
  (`20260708124756_menu_categories_items.sql:35-36`) which surfaces as PostgREST `23505`
  and is mapped to HTTP 409 by `isUniqueViolation` (`src/lib/api.ts:89`). The same shape
  gives us duplicate-email handling for free.
- Every shadcn primitive this UI needs already exists in `src/components/ui/`
  (`dialog`, `alert-dialog`, `select`, `input`, `label`, `badge`, `button`, `checkbox`).
  No `npx shadcn add` is required. There is no `table.tsx`; rows are `<ul>/<li>`.
- `src/types.ts` is menu-only today; the role union is hand-duplicated in
  `src/env.d.ts:5` and `src/middleware.ts:38`.
- Type-aware ESLint (`strictTypeChecked` + `stylisticTypeChecked`,
  `eslint.config.js:15`) means untyped Supabase responses trip the `no-unsafe-*` family.
  Follow `middleware.ts:38` and pass an explicit generic to `.maybeSingle<T>()`.

## What We're NOT Doing

- **No SMTP, no email invitations, no `inviteUserByEmail`, no `generateLink`.**
  Credentials are handed over out-of-band by the owner.
- **No password reset or "forgot password" flow.** A staff member who loses their
  password must be deleted and recreated by the owner. Explicitly deferred.
- **No email change after creation.** `profiles.email` is written once at provisioning.
- **No promoting anyone to `owner`.** The role picker offers `waiter` and `kitchen`
  only; `owner` stays exclusive to the account that registered the company.
- **No hard delete in the UI.** `profiles_delete_owner` is added and covered by RLS
  tests as the DB-level counterpart to the INSERT policy — see the note in Phase 1 —
  but no route or button invokes it in this slice.
- **No "at least one active owner" count trigger.** With `owner` unassignable there is
  exactly one owner per company, and self-demotion/self-deactivation are blocked, so the
  count guard has no reachable failure case yet. Revisit if multi-owner is ever allowed.
- **No refactor of `guardMenuRequest` into a shared helper.** Per
  `change.md:20-21`, S-06 runs in parallel on the same file; we add a sibling
  `guardStaffRequest` instead.
- **No changes to what waiter/kitchen roles can actually *do*.** This slice provisions
  accounts and enforces deactivation; the waiter availability toggle is S-05 and the
  kitchen display is S-11.
- **No session revocation on deactivation.** Deactivation takes effect on the
  deactivated user's next request, not instantly.

## Implementation Approach

Three phases in the schema → API → UI order this repo has used for every prior slice.

The load-bearing choice is **where authorization lives**. Creating an `auth.users` row
is inherently privileged and can only be done with the service-role key, so that one
call escalates. Everything else — the `profiles` insert, the role update, the
deactivation — runs through the ordinary user-scoped client so that RLS remains the real
enforcement boundary and the isolation suite can actually prove a waiter cannot
self-provision. This is a deliberate departure from `src/lib/storage.ts`, where the
whole operation is service-role because Storage leaves no alternative.

That split creates one ordering hazard: the `auth.users` row is created before the
`profiles` row, so a failed insert leaves an orphaned auth user whose email is now taken
with nothing to show for it. Phase 2 handles it with an explicit compensating delete.

## Critical Implementation Details

**State sequencing — staff creation is a two-step write with a compensating action.**
The order is fixed: `auth.admin.createUser` first (service role), then the `profiles`
insert (user client, RLS-enforced). It cannot be reversed, because `profiles.user_id`
is a FK to `auth.users`. If the insert fails for any reason — RLS denial, duplicate
email index, network — the route must call `auth.admin.deleteUser(userId)` before
returning the error, otherwise the email is permanently unusable. The compensating
delete is best-effort and must not mask the original error.

**Timing — the resolver change has schema-wide blast radius.** `current_company_id()`
and `current_staff_role()` are called by every RLS policy on `companies`, `tables`,
`menu_categories`, `menu_items`, and `storage.objects`. Adding the
`deactivated_at is null` predicate is a one-line change to each, but it must be verified
by re-running the *whole* existing isolation suite, not just the new assertions. Keep
both functions `security definer` with `set search_path = ''` and fully-qualified names.

**Self-demotion cannot be expressed in an RLS policy.** A `with check` clause sees only
the new row, so it cannot tell "owner demoted themselves" from "owner was already a
waiter". This needs a `BEFORE UPDATE` trigger on `profiles` comparing `OLD` and `NEW`
against `auth.uid()`.

## Phase 1: Schema, Resolvers & RLS

### Overview

One migration that adds the two missing columns, makes deactivation real at the resolver
level, opens the two missing policies with tenant-safe predicates, and blocks privilege
self-harm with a trigger. Plus the isolation assertions that prove all of it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260727<HHmmss>_staff_accounts_roles.sql`

**Intent**: Extend `profiles` with the identity and lifecycle columns the staff panel
needs, make deactivation enforceable schema-wide, and grant the owner the INSERT/DELETE
rights that F-01 deliberately withheld — with predicates narrow enough that they cannot
become the tenancy hole `tenancy_core.sql:5-10` warns about.

**Contract**: Follow the four-policy-block style of
`20260708124756_menu_categories_items.sql:38-72`. The migration must contain, in order:

1. `alter table public.profiles add column email text` and
   `add column deactivated_at timestamptz`.
2. Backfill `profiles.email` from `auth.users.email` for every existing row, then
   `alter column email set not null`. The backfill must run before the NOT NULL.
3. `create unique index profiles_company_email_idx on public.profiles (company_id, lower(email));`
   — mirrors `menu_categories_company_name_idx`, giving a `23505` that
   `isUniqueViolation` maps to HTTP 409.
4. `create or replace function public.handle_new_user()` — same body as
   `20260708124756_menu_categories_items.sql:146-173`, with `email` added to the
   `profiles` insert column list, sourced from `new.email`. Do not touch the
   `company_name` gate.
5. `create or replace` both resolvers with the deactivation predicate added. This is the
   only snippet in the plan, because getting it wrong silently disables tenancy for
   everyone:

   ```sql
   create or replace function public.current_company_id()
   returns uuid language sql stable security definer set search_path = '' as $$
     select p.company_id
     from public.profiles p
     where p.user_id = auth.uid()
       and p.deactivated_at is null;
   $$;
   ```

   `current_staff_role()` takes the identical `and p.deactivated_at is null` addition.
6. `profiles_insert_owner` — `for insert to authenticated with check (company_id =
   public.current_company_id() and public.current_staff_role() = 'owner' and role <>
   'owner')`. The `role <> 'owner'` term is what keeps `owner` unassignable; it does not
   affect owner registration, because `handle_new_user()` is `security definer` and
   bypasses RLS.
7. `profiles_delete_owner` — `for delete to authenticated using (company_id =
   public.current_company_id() and public.current_staff_role() = 'owner' and user_id <>
   auth.uid())`. **Note:** no route in this slice calls DELETE. It is added as the
   DB-level counterpart to the INSERT policy and is covered by assertions in change 2
   below, so it ships tested rather than as dead code.
8. A `before update on public.profiles for each row` trigger function (plpgsql,
   `security definer`, `set search_path = ''`) that raises an exception when
   `auth.uid() = old.user_id` and either `new.role is distinct from old.role` or
   `new.deactivated_at is distinct from old.deactivated_at`, and also when
   `new.role = 'owner' and old.role <> 'owner'`. Raise with a distinguishable
   `errcode` (e.g. `'42501'` insufficient_privilege) so the API layer can map it to a
   403 rather than a generic 500. The trigger must allow an owner to edit their own
   `full_name`.

Header comment: state why the INSERT policy is now safe (three-term predicate) and why
the trigger exists (RLS `with check` cannot see `OLD`), matching the documentation
density of `tenancy_core.sql:1-13`.

#### 2. RLS isolation assertions

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: Prove the new policies are tenant-safe, prove deactivation actually denies,
and confirm the resolver change did not weaken any existing assertion.

**Contract**: Append new assertions immediately before the `rollback;` at `:239`,
following the existing idiom exactly — `set local role authenticated;` +
`set local request.jwt.claims = '{"sub":"…","role":"authenticated"}';` + a `DO` block
that `raise exception` on failure + `reset role;`. Use the expected-error nested
`begin … exception when others then leaked := false; end;` shape (`:123-129`) for denied
writes and the `get diagnostics n = row_count` shape (`:131-137`) for silently-filtered
ones. Reuse the seeded waiter `dddddddd-…` (`:36`) and add one deactivated-waiter fixture
to the fixture block at `:32-36`.

Assertions to add:
- Owner A can insert a `waiter` profile into company A.
- Owner A **cannot** insert a profile carrying company B's `company_id`.
- Owner A **cannot** insert a profile with `role = 'owner'`.
- Waiter A **cannot** insert any profile (self-provisioning denied).
- Waiter A **cannot** update their own `role` to `owner` (self-promotion denied).
- Owner A **cannot** update their own `role` (self-demotion denied, trigger).
- Owner A **cannot** set their own `deactivated_at` (self-deactivation denied, trigger).
- Owner A **can** update their own `full_name` (trigger does not over-block).
- Owner A can set and clear `deactivated_at` on waiter A.
- A deactivated waiter sees zero `companies`, zero `menu_items`, zero `profiles`
  (resolvers return NULL → default-deny), mirroring the orphan-user assertion at
  `:183-193`.
- Owner A can delete a same-company non-self profile; waiter A cannot delete any.

Note the file's own convention (`:153-155`) of scoping counts to the fixture company ids,
because the suite runs against the linked remote DB which may hold real dev rows.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:push`
- RLS isolation suite passes, including all eight pre-existing assertions: `npm run test:rls`
- Linting passes: `npm run lint`

#### Manual Verification:

- After `db:push`, existing owner profiles have a non-null `email` matching `auth.users`
- Registering a brand-new company through `/auth/signup` still works end-to-end and the
  resulting owner profile has `email` populated
- Existing `/menu` CRUD as owner still works — the resolver change did not break it
- Signing in as the pre-existing dev waiter account still resolves a role

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase. The resolver change is the highest-risk
edit in this plan; do not stack Phase 2 on top of an unverified Phase 1.

---

## Phase 2: Admin Module & Staff API

### Overview

The service-role module that creates `auth.users`, the shared zod contract, the staff
request guard, and four JSON endpoints following the `/api/menu/*` conventions exactly.

### Changes Required:

#### 1. Service-role admin module

**File**: `src/lib/staff-admin.ts`

**Intent**: Isolate the only privileged operation in this feature — creating and, on
rollback, deleting an `auth.users` row — behind two narrow functions, so that no route
holds a service-role client directly.

**Contract**: Copy the shape of `src/lib/storage.ts:14-21` verbatim: module-private lazy
`admin()` factory, `createClient` from `@supabase/supabase-js` (not `@supabase/ssr`),
keys from `astro:env/server`, `{ auth: { persistSession: false, autoRefreshToken: false } }`,
`null` when either env var is missing. Export exactly two functions:

- `createStaffAuthUser({ email, password, fullName })` → `{ userId: string }` on
  success, or a discriminated error carrying enough information for the route to
  distinguish "email already registered" (→ 409) from everything else (→ 500).
  Calls `auth.admin.createUser` with `email_confirm: true` (there is no SMTP to confirm
  through) and `user_metadata: { full_name }`. **Must not pass `company_name`** — that
  key is what triggers `handle_new_user()` to spawn a company.
- `deleteStaffAuthUser(userId)` → `Promise<void>`, best-effort, swallowing errors like
  `removePhotoObjects` (`storage.ts:40-46`) does. This is the compensating action.

Header comment in the style of `storage.ts:4-10`: state that the service role is
required because creating an auth user is inherently privileged, that the caller
authorizes first (owner guard), and that the `profiles` row is deliberately **not**
written here so RLS stays the enforcement boundary.

#### 2. Shared zod schemas

**File**: `src/lib/schemas/staff.ts`

**Intent**: One validation contract for the create and update payloads, imported by both
the API routes and the React island, exactly as `menu.ts` is.

**Contract**: Mirror `src/lib/schemas/menu.ts` conventions — zod v4 top-level API
(`z.uuid()`, `z.email()`), a Polish message on **every** validator including the
type-error message in the first position, `.trim()` before `.min(1)`, optional fields as
`.nullish().transform((v) => v ?? null)`, and types exported via `z.output<>`.

- `staffCreateInputSchema` — `email`, `password` (min 8; stricter than the Supabase floor
  of 6 at `config.toml:175`), `full_name` nullish, `role` restricted to a
  `STAFF_ASSIGNABLE_ROLES` tuple from `src/types.ts` (`waiter` | `kitchen`).
- `staffUpdateInputSchema` — `role` (same restricted tuple), `full_name` nullish,
  `active` boolean. One PUT handles rename, role change, deactivate and reactivate.

#### 3. Shared types

**File**: `src/types.ts`

**Intent**: Give the role union a single home and add the staff row type, following the
`AVAILABILITY` / `ALLERGEN_LABELS` pattern already in this file.

**Contract**: Append (the file is shared append-only with S-06 per `change.md:22` —
append, do not reorder): `STAFF_ROLES` const tuple `['owner','waiter','kitchen']`,
`STAFF_ASSIGNABLE_ROLES` const tuple `['waiter','kitchen']`, derived `StaffRole` /
`AssignableStaffRole` types, `STAFF_ROLE_LABELS` Polish record, and a `StaffMember`
interface matching the `profiles` row shape returned by the API (`user_id`,
`company_id`, `email`, `full_name`, `role`, `deactivated_at`, `created_at`).

**File**: `src/env.d.ts`

**Intent**: Stop hand-duplicating the role union.

**Contract**: Change `role: "owner" | "waiter" | "kitchen" | null` at `:5` to
`role: import("@/types").StaffRole | null`. One-line edit.

#### 4. Staff request guard

**File**: `src/lib/api.ts`

**Intent**: An owner guard for the staff endpoints that is a sibling of, not a refactor
of, `guardMenuRequest` — `change.md:20-21` forbids the shared-helper refactor while S-06
is in flight on this file.

**Contract**: Add `guardStaffRequest(context, options: { write: boolean })` returning the
same `{ error: Response } | { supabase, companyId }` discriminated union, with the same
check order as `guardMenuRequest` (401 no user → 403 role → 403 no company → 500 no
client) and a staff-specific Polish message for the 403. Also add
`profileExistsInCompany(supabase, userId)` following `itemExistsInCompany`
(`src/lib/api.ts:65-68`) — an RLS-scoped SELECT by id only, where "not found" means "not
in my company". Add `isInsufficientPrivilege(error)` alongside `isUniqueViolation`
(`:89-91`), checking for the trigger's `42501` errcode.

Reads are owner-only here, unlike menu: the staff roster is not something a waiter needs.
Call both GET and the mutations with `{ write: true }`, or simply always require owner —
state which in the guard's comment.

#### 5. API routes

**File**: `src/pages/api/staff/index.ts`

**Intent**: List the company's staff, and provision a new account.

**Contract**: `export const prerender = false`. `GET` returns
`jsonData(StaffMember[])` from an RLS-scoped `.select(...)` ordered by `role` then
`full_name`/`email`, including deactivated rows so the UI can render and reactivate them.
`POST` is the two-step write: guard → `parseBody(staffCreateInputSchema)` →
`createStaffAuthUser` → insert `profiles` with `company_id: guard.companyId` and the
returned `user_id` via the **user-scoped** client → on insert failure call
`deleteStaffAuthUser` then return the mapped error → on success
`jsonData(row, 201)`. Map `23505` → 409 "Pracownik z tym adresem e-mail już istnieje";
map the admin-API duplicate-email error to the same 409; everything else → 500 with a
fixed Polish string (never surface a raw Supabase message — see `items.ts:47-52`).

**File**: `src/pages/api/staff/[id].ts`

**Intent**: Change role, rename, deactivate and reactivate an existing account.

**Contract**: `export const prerender = false`. Module-level `const idSchema = z.uuid();`
validating `context.params.id` → 400 on failure, as in
`src/pages/api/menu/items/[id].ts:15,23-26`. `PUT` guards, parses
`staffUpdateInputSchema`, then updates `role`, `full_name`, and `deactivated_at`
(`null` when `active`, `new Date().toISOString()` otherwise) with `.select("...")`
**without** `.single()`, so a zero-row result becomes a clean 404 rather than a PostgREST
error (the `items/[id].ts:50,58-60` idiom). Map the trigger's `42501` to 403 with a
message naming the self-edit rule. No `DELETE` export in this slice.

#### 6. Schema unit tests

**File**: `src/lib/schemas/staff.test.ts`

**Intent**: Cover the validation contract, the only layer this repo unit-tests.

**Contract**: Vitest, mirroring `src/lib/schemas/menu.test.ts`. Cover: valid create
payload; rejected short password; rejected malformed email; rejected `role: "owner"`;
`full_name: undefined` normalising to `null`; valid update payloads for each of rename /
role change / deactivate / reactivate.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- `POST /api/staff` as owner creates an account; the new user can sign in
- `POST /api/staff` with an email that already exists returns 409 and leaves **no**
  orphaned `auth.users` row (verify in the Supabase dashboard)
- `POST /api/staff` as a waiter returns 403
- `PUT /api/staff/<own-user-id>` changing the owner's own role returns 403
- `PUT /api/staff/<id>` with `active: false` then `active: true` round-trips
- A deactivated staff member's API calls return no data

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful before proceeding to the next phase.

---

## Phase 3: Staff Panel UI & Wiring

### Overview

The `/staff` page and its React island, plus the two middleware edits that gate the route
and eject a deactivated user's stale session.

### Changes Required:

#### 1. Middleware

**File**: `src/middleware.ts`

**Intent**: Gate `/staff` as owner-only, and stop a deactivated (or orphaned) user from
sitting on a protected page with a null role.

**Contract**: Add `"/staff"` to **both** `PROTECTED_ROUTES` (`:4`) and `OWNER_ROUTES`
(`:7`) — a route in only the latter would send anon users to `/dashboard` first. Then, in
the protected-route branch (`:46-50`), extend the condition: when a `user` exists on a
protected route but the `profiles` lookup produced no row, `await supabase.auth.signOut()`
and redirect to `/auth/signin` with an error query param. This covers both the
deactivated-staff case and the pre-existing orphan-user case. Without the `signOut`, the
cookie survives and the user can loop straight back. Update the `.maybeSingle<>` generic
at `:38` to use the new `StaffRole` type.

This file is shared append-only with S-06 (`change.md:22`) — keep the diff to these three
touch points.

#### 2. Data hook

**File**: `src/components/hooks/useStaff.ts`

**Intent**: The fetch client and state hook for the staff list.

**Contract**: Mirror `src/components/hooks/useMenu.ts` exactly. Export
`callStaffApi<T>(method, url, body?, signal?)` unwrapping the `{ data }` / `{ error }`
envelope and throwing the Polish `error` string, and `useStaff()` returning
`{ staff, setStaff, loadError, refetch, reload }` where `refetch` **throws** by design
(`useMenu.ts:42-43`) and `reload` swallows into `loadError`. Same `let cancelled = false`
effect guard. No polling.

#### 3. React island

**File**: `src/components/staff/StaffManager.tsx`

**Intent**: The container: list, empty state, dialog orchestration, confirm flow, error
surfaces.

**Contract**: Default export, mirroring `MenuManager.tsx`. Refetch after every mutation —
no optimistic updates (the reorder exception in `MenuManager.tsx:153` does not apply
here). Keep the two deliberate error channels: dialog submit rejections propagate to the
dialog and render inline keeping it open; confirm/destructive failures land in an
`actionError` banner. Full-screen gate only while `staff` is still `null`
(`MenuManager.tsx:47-59`). Deactivate/reactivate confirmation uses `AlertDialog`. The
owner's own row must render its role and deactivation controls disabled — the API and
trigger both reject those edits, and the UI should not offer them.

**File**: `src/components/staff/StaffDialog.tsx`

**Intent**: One dialog serving both create and edit.

**Contract**: The two-component split from `CategoryDialog.tsx:23-24` — an outer
`StaffDialog` rendering `Dialog`/`DialogContent`/`DialogHeader` and an inner form
component, so Radix unmounting on close resets form state with no effect. Props
`{ open, member: StaffMember | null, onOpenChange, onSubmit }` where `null` means create
mode and switches the title. Plain `useState` per field + `schema.safeParse()` on submit;
no react-hook-form, no toast library. Create mode shows email + password + full name +
role `Select`; edit mode shows full name + role only (email and password are immutable).
Error line as `<p className="text-sm text-red-400">`; footer is outline "Anuluj" +
`<Button type="submit" disabled={saving}>` with a "Zapisywanie…" label.

**File**: `src/components/staff/StaffRow.tsx`

**Intent**: One list row.

**Contract**: `<li>` following `MenuItemRow.tsx`. Role rendered as `<Badge
variant="outline">` with a per-role class map (`MenuItemRow.tsx:15-19`), display name
falling back to email when `full_name` is null, deactivated rows visually dimmed with a
"Nieaktywny" badge. Row actions are icon-only `<Button variant="ghost" size="icon">` with
Polish `aria-label`s naming the member (`MenuItemRow.tsx:87-110`).

#### 4. Page and navigation

**File**: `src/pages/staff.astro`

**Intent**: The route shell.

**Contract**: Clone `src/pages/menu.astro` — four-line frontmatter, no data fetching, a
comment noting that auth and the owner role are enforced by middleware, then
`<Layout title="Pracownicy">` → `bg-cosmic min-h-screen` wrapper → `max-w-3xl` container
→ gradient `<h1>` + "← Powrót do panelu" link → `<StaffManager client:load />`. No
`supabaseUrl` prop is needed (no Storage involvement). Do not put a top-level `return` in
the frontmatter (`settings.astro:6-7`).

**File**: `src/pages/dashboard.astro`

**Intent**: Make the panel reachable.

**Contract**: Add a "Pracownicy" nav pill inside the existing `{isOwner && (…)}` block at
`:19-28`, matching the `/menu` link's markup. Shared append-only file — append the link,
do not restructure the nav.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Owner sees the "Pracownicy" pill on `/dashboard`; a waiter does not
- A waiter navigating directly to `/staff` is redirected to `/dashboard`
- A signed-out visitor navigating to `/staff` is redirected to `/auth/signin`
- Creating a waiter from the UI succeeds; the new account signs in and lands on
  `/dashboard` with no `/menu` link
- Editing role and full name persists after a page reload
- Deactivating a member dims the row; the deactivated member is signed out on their next
  request and cannot sign back in to anything useful
- Reactivating restores access
- The owner's own row has its role and deactivation controls disabled
- Layout holds at mobile width (the client path is mobile-first per PRD NFR)

**Implementation Note**: After completing this phase and all automated verification
passes, pause here for manual confirmation from the human that the manual testing was
successful.

---

## Testing Strategy

### Unit Tests:

- `src/lib/schemas/staff.test.ts` — the create/update validation contract, including the
  rejection of `role: "owner"` and short passwords, and `nullish → null` normalisation.
- This repo unit-tests schemas only; routes and components have no test precedent and
  none is introduced here.

### Integration Tests:

- `supabase/tests/rls_isolation.sql` is the integration suite. The new assertions listed
  in Phase 1 change 2 cover tenant-safety of the INSERT/DELETE policies, the
  self-demotion and self-promotion trigger, and deactivated-user denial. The eight
  pre-existing assertions serve as the regression check on the resolver change.
- Run with `npm run test:rls`. Note it targets the **linked remote** project and wraps
  everything in a transaction it rolls back.

### Manual Testing Steps:

1. Sign in as owner → `/staff` → create a waiter with a known temporary password.
2. Sign out, sign in as that waiter → confirm `/dashboard` loads, `/menu` and `/staff`
   redirect away, and no owner-only nav appears.
3. Back as owner, change the waiter to `kitchen` and rename them → reload → persisted.
4. Deactivate the waiter. In the waiter's still-open browser session, navigate to
   `/dashboard` → confirm sign-out and redirect to `/auth/signin`.
5. Attempt to sign in as the deactivated waiter → confirm they cannot reach anything.
6. Reactivate → confirm the waiter can sign in again.
7. Attempt to create a second account with the same email → 409 message, and verify in
   the Supabase dashboard that no orphaned `auth.users` row was left behind.
8. On the owner's own row, confirm the role and deactivate controls are disabled.
9. Register a brand-new company via `/auth/signup` → confirm the owner profile gets a
   populated `email` and the four default menu categories still seed.

## Performance Considerations

Negligible. The staff list is a single RLS-scoped SELECT over a table with a handful of
rows per tenant. The resolver change adds one indexed-column predicate to two functions
that were already executed per policy evaluation. No new per-request work is added to the
middleware hot path — the deactivated-user check reuses the `profiles` SELECT that
already runs at `src/middleware.ts:34-38`.

## Migration Notes

- The `profiles.email` backfill must complete before the `NOT NULL` constraint in the
  same migration; both run inside the migration's transaction, so a mismatch aborts the
  whole thing rather than leaving a half-applied state.
- `handle_new_user()` is replaced with `create or replace`, not dropped — the
  `on_auth_user_created` trigger created in `20260705232213_owner_registration_trigger.sql:31-34`
  keeps pointing at the new body and is not re-created.
- The resolver change is not backwards-incompatible: with no rows carrying a non-null
  `deactivated_at` at apply time, behaviour is identical to today. The risk is in the
  function bodies being rewritten, not in the data.
- Rollback: a `create or replace` restoring the pre-change resolver bodies plus
  `drop policy` / `drop trigger` reverts the enforcement without touching data. The two
  new columns can be left in place.
- Coordinate with the S-06 branch on `src/middleware.ts`, `src/pages/dashboard.astro`,
  `src/types.ts` and `supabase/tests/rls_isolation.sql` — all four are append-only shared
  files per `change.md:22-23`.

## References

- Change notes: `context/changes/staff-accounts-roles/change.md`
- Roadmap slice S-02: `context/foundation/roadmap.md:107-117`
- PRD FR-003 and Access Control: `context/foundation/prd.md:133`, `:210-232`
- Lessons (service-role rule, anon RLS scoping): `context/foundation/lessons.md`
- Tenancy foundation and the withheld policies: `supabase/migrations/20260705212949_tenancy_core.sql:5-10,28-36,44-66,90-99`
- The trigger comment that anticipated this slice: `supabase/migrations/20260705232213_owner_registration_trigger.sql:5-7`
- Service-role precedent: `src/lib/storage.ts:14-21`
- API guard and envelope conventions: `src/lib/api.ts:7-91`
- CRUD route reference: `src/pages/api/menu/items.ts`, `src/pages/api/menu/items/[id].ts`
- Island reference: `src/components/menu/MenuManager.tsx`, `src/components/menu/CategoryDialog.tsx`
- RLS test idiom: `supabase/tests/rls_isolation.sql:57-77`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, Resolvers & RLS

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:push` — cfffeb2
- [x] 1.2 RLS isolation suite passes, including all eight pre-existing assertions: `npm run test:rls` — cfffeb2
- [x] 1.3 Linting passes: `npm run lint` — cfffeb2

#### Manual

- [x] 1.4 Existing owner profiles have a non-null `email` matching `auth.users` — cfffeb2
- [x] 1.5 New company registration via `/auth/signup` works and populates owner `email` — cfffeb2
- [x] 1.6 Existing `/menu` CRUD as owner still works — cfffeb2
- [x] 1.7 Pre-existing dev waiter account still resolves a role (N/A — the dev DB holds only two profiles, both `owner`; no waiter account exists. The non-owner resolver path is covered by 1.2, assertions 4/10/14, which run as an active waiter. The first real waiter is created by Phase 2.) — cfffeb2

### Phase 2: Admin Module & Staff API

#### Automated

- [x] 2.1 Unit tests pass: `npm run test` — 9d11795
- [x] 2.2 Type checking passes: `npm run typecheck` — 9d11795
- [x] 2.3 Linting passes: `npm run lint` — 9d11795
- [x] 2.4 Production build succeeds: `npm run build` — 9d11795

#### Manual

- [x] 2.5 `POST /api/staff` as owner creates an account the new user can sign in with
- [x] 2.6 Duplicate email returns 409 and leaves no orphaned `auth.users` row
- [x] 2.7 `POST /api/staff` as a waiter returns 403
- [x] 2.8 `PUT /api/staff/<own-user-id>` changing the owner's own role returns 403
- [x] 2.9 `PUT /api/staff/<id>` deactivate then reactivate round-trips
- [x] 2.10 A deactivated staff member's API calls return no data

### Phase 3: Staff Panel UI & Wiring

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 Unit tests pass: `npm run test`
- [x] 3.4 Production build succeeds: `npm run build`

#### Manual

- [x] 3.5 Owner sees the "Pracownicy" pill on `/dashboard`; a waiter does not
- [x] 3.6 A waiter navigating directly to `/staff` is redirected to `/dashboard`
- [x] 3.7 A signed-out visitor navigating to `/staff` is redirected to `/auth/signin`
- [x] 3.8 Creating a waiter from the UI succeeds and the account signs in correctly scoped
- [x] 3.9 Editing role and full name persists after reload
- [x] 3.10 Deactivating signs the member out on their next request
- [x] 3.11 Reactivating restores access
- [x] 3.12 The owner's own row has role and deactivation controls disabled
- [x] 3.13 Layout holds at mobile width
