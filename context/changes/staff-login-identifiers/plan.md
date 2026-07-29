# Per-Venue Staff Login Implementation Plan

## Overview

Separate the login credential from the contact attribute for staff accounts. A
venue gets a short, generated, immutable **code**; a staff member gets a
**login** unique within that venue. The Supabase auth address becomes a
synthetic value derived from the pair, so `profiles.email` stops being a
credential and becomes an optional, repeatable contact field.

Owners are untouched: they keep registering and signing in with their real
email address.

Implements the confirmed problem statement from
`context/changes/staff-login-identifiers/frame.md`.

## Current State Analysis

**From the frame brief (already investigated — not re-litigated here):**

- `auth.users.email` is globally unique via `auth.users_email_partial_key`, a
  unique index in the Supabase-managed `auth` schema. It cannot be scoped and
  does not need to be — the fix routes around it rather than fighting it.
- The PRD Non-Goal "konto odpowiada jednemu lokalowi" (`prd.md:246`) stands.
  No multi-membership, no venue switcher; `profiles` stays 1:1 with `auth.users`.
- A venue identifier is also required by S-07 `table-qr-codes` (FR-011), which
  is unstarted. This change defines it; S-07 will consume it.

**From this planning session's research of the auth path:**

- `/auth/signin` is the only sign-in path in the repo. It is a **native
  `<form method="POST">`**, not JS-driven — `SignInForm.tsx:43`. `SubmitButton`
  relies on `useFormStatus()`, which only reports pending for native
  submissions, so the form must stay a real POST.
- `SignInForm.tsx:18-30` validates the identity field against
  `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` **before the request leaves the browser**. A
  bare login fails here first, and the failure looks like a server problem.
- `src/pages/api/auth/signin.ts` reads `form.get("email")` and
  `form.get("password")` with `as string` — no zod, no trim, no null check. Any
  translation added here is the first validation this route has ever had.
- Error mapping is a single regex on `/invalid login credentials/i` →
  `"Nieprawidłowy e-mail lub hasło."`; everything else leaks `error.message`
  raw into the query string and onto the page via `ServerError`.
- Success redirects to `/`, **not** `/dashboard` (`signin.ts:22`). `/` renders
  `Topbar.astro:11`, which prints `user.email` — so the synthetic address would
  be the first thing a staff member sees after signing in.
- `dashboard.astro:15` also prints `user?.email`.
- `GET /api/staff` sorts by `role` then `email` (`index.ts:30`), and
  `StaffRow.tsx:26` uses `full_name ?? email` as the display name and in its
  `aria-label`s. All three break once `email` is nullable.
- `supabase/config.toml`: `enable_confirmations = false`, no SMTP, **no domain
  allow-list or deny-list**, and `[auth.hook.before_user_created]` is commented
  out. A synthetic address is viable; GoTrue only requires it to be
  syntactically valid (`local@domain.tld`).
- `companies` is `id, name, address, opening_hours, created_at` — no
  human-readable identifier, and `name` is not unique.
- Three real staff accounts exist on the hosted project, created during S-02
  testing, using real addresses as credentials.

## Desired End State

An owner opens **Pracownicy** and sees their venue's code displayed alongside
the roster. Adding a staff member asks for a **login** (not an email), a
temporary password, an optional email for contact, and a role. The owner tells
the new waiter two things: the venue code and their login.

The waiter opens `/auth/signin`, fills in venue code, login and password, and
lands on the dashboard scoped to that venue. Nothing anywhere shows them a
synthetic address.

An owner signs in exactly as before — email and password, venue code left
empty.

Two staff at different venues can hold the same login, and the same email
address may appear on several staff records, or on none.

**Verification:** `npm run test:rls` passes with the new assertions;
`npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` pass; and
the manual walkthrough in Testing Strategy completes for both an owner and a
staff member.

### Key Discoveries:

- **The auth address can be derived, not stored.** Because the venue code is
  immutable and the login is unique within it, `signin.ts` can build the
  synthetic address from `(code, login)` and call `signInWithPassword`
  directly. No lookup, no extra round trip, and the non-enumerating error shape
  falls out for free — a wrong code and a wrong login are indistinguishable
  because both simply produce an address that does not exist.
- **This is why the login must be immutable.** If a login could change, the
  derived address would drift from the stored one. Email is already immutable
  after creation in this codebase (`staff-accounts-roles/plan.md:132`), so this
  matches the existing contract rather than adding a new constraint.
- `profiles_company_email_idx` (`20260727220415_staff_accounts_roles.sql:42`)
  is already per-company, so it never was the source of the cross-tenant 409 —
  it just has to go, to let the address repeat.
- The `handle_new_user()` trigger has now been replaced by four different
  slices. `20260728101449_restore_default_room_seed.sql` is the current
  authoritative body; any replacement must start from it, not from an earlier
  version. This is the S-02 F1 regression and it must not recur.
- `enable_confirmations = false` plus `email_confirm: true` on
  `auth.admin.createUser` means a non-deliverable synthetic domain never blocks
  sign-in.
- **Never run `supabase config push`** — it overwrites the entire remote auth
  config (`archive/2026-07-04-owner-company-registration/plan.md:52`).

## What We're NOT Doing

- **No change to owner registration or owner sign-in.** Owners keep their real
  email as the credential. `/auth/signup` is untouched.
- **No multi-membership, no venue switcher.** The PRD Non-Goal stands;
  `profiles` remains 1:1 with `auth.users`.
- **No new routes.** The venue code is a form field on the existing
  `/auth/signin`; no `/auth/signin/<slug>`, no subdomains.
- **No owner-editable venue code.** It is generated once and immutable —
  that is what makes it safe for S-07's printed QR codes.
- **No login change after creation.** Same contract as email today.
- **No automated deletion of the three existing staff accounts.** They are test
  data and the user chose to recreate them, but a migration that deletes auth
  users is not a safe way to express that. It is a manual step.
- **No password reset, no email verification, no rate limiting.** Rate limiting
  was considered and rejected for this change — it needs KV or a Durable Object
  on Workers, which is its own piece of infrastructure.
- **No QR code generation.** This change defines the venue code that S-07 will
  encode; it does not build S-07.

## Implementation Approach

Three phases in the schema → provisioning → sign-in order, matching every prior
slice in this repo.

The pivotal decision is that the synthetic address is **derived, not looked
up**. `staff-admin.ts` composes it at creation time from the same two inputs
`signin.ts` will later compose it from. Both sides use one shared pure function
so they cannot drift.

The sign-in phase is sequenced last and deliberately isolated, because
`/auth/signin` is the only authentication path in the application. Phases 1 and
2 are additive and cannot lock anyone out; only Phase 3 touches a working login.

## Critical Implementation Details

**Timing — the venue code must exist before any staff can be provisioned.**
`handle_new_user()` generates it for new registrations, and the Phase 1
migration backfills existing companies. If Phase 2 shipped first, staff created
in the gap would have no code to derive an address from.

**State sequencing — the client-side regex is the first thing that breaks.**
`SignInForm.tsx:18-30` rejects a non-email identity field before any request is
sent. Changing `signin.ts` without changing that validation produces a
confusing failure that looks server-side. Change the client validation in the
same commit as the server translation.

**The synthetic domain must be reserved and obviously non-deliverable.** Use a
`.invalid` TLD — RFC 2606 reserves it precisely so it can never resolve, which
guarantees no mail is ever attempted and no real address can collide with a
generated one.

## Phase 1: Venue code and staff login in the schema

### Overview

One migration that introduces both identifiers, relaxes the email constraint,
and teaches the registration trigger to mint a code. Plus the RLS assertions
that prove uniqueness is scoped the way we now want it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260728<HHmmss>_venue_code_and_staff_login.sql`

**Intent**: Give every venue a permanent public code and every staff member a
login unique within their venue, and demote `email` from credential to optional
contact data.

**Contract**: In order:

1. `alter table public.companies add column code text` — then backfill every
   existing row with a generated value, then `set not null`, then
   `create unique index companies_code_idx on public.companies (code)`.
   Backfill before the constraint, as in the S-02 email migration.
2. A `generate_venue_code()` SQL function returning a short random string from
   an **unambiguous alphabet** — exclude `0`, `O`, `1`, `I`, `L` so a code read
   off a printed QR sticker or dictated over the phone cannot be mistyped.
   6 characters from a 31-character alphabet is ~10⁹ combinations; retry on
   collision against the unique index rather than trusting first draw.
   Include a comment stating that S-07 will encode this in printed QR codes and
   that it therefore must never change for a given company (FR-011).
3. `alter table public.profiles add column login text` — nullable, because
   owners do not have one.
4. `create unique index profiles_company_login_idx on public.profiles (company_id, lower(login));`
   — the per-venue uniqueness that is the point of this change. A partial index
   (`where login is not null`) so multiple owner rows with a null login coexist.
5. `drop index profiles_company_email_idx;` and
   `alter table public.profiles alter column email drop not null;` — email may
   now repeat within a venue, or be absent.
6. `create or replace function public.handle_new_user()` — **start from the body
   in `20260728101449_restore_default_room_seed.sql`**, which is the current
   authoritative version (company + owner profile with email + 4 categories +
   1 room). Add the venue-code generation to the `companies` insert. Do not
   touch the `company_name` gate. Do not drop the room seed — that regression
   already happened once (S-02 F1).

No RLS policy changes: `companies_select_same_company` and
`profiles_select_same_company` already cover the new columns, and neither
identifier is readable cross-tenant.

#### 2. RLS isolation assertions

**File**: `supabase/tests/rls_isolation.sql`

**Intent**: Prove the new uniqueness is scoped per venue and that the
registration trigger mints a code.

**Contract**: Append before the `rollback;`, using the established
`set local role` + `request.jwt.claims` + `DO` block idiom, asserting on
`SQLSTATE` rather than `when others` (the convention established by S-02 F9).
Add a `login` to the existing profile fixtures. Assertions:

- The same login in two different companies both insert successfully — the
  core claim of this change.
- A duplicate login within one company raises `23505`.
- The same email on two staff rows in one company now succeeds (it previously
  raised `23505`), and a null email succeeds.
- Extend the existing bootstrap assertion (19) to also check the new company
  received a non-null, unique `code`.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run db:push`
- RLS isolation suite passes, including every pre-existing assertion: `npm run test:rls`
- Linting passes: `npm run lint`

#### Manual Verification:

- Both existing companies have a non-null, distinct `code` after the migration
- Registering a new company at `/auth/signup` still works and produces a code,
  four default categories and one default room
- Existing `/menu` and `/staff` pages still load for an owner

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that the
manual testing was successful before proceeding to the next phase.

---

## Phase 2: Synthetic auth address and provisioning

### Overview

Staff accounts start being created with a login instead of an email. The auth
address becomes a derived value produced by one shared function.

### Changes Required:

#### 1. Shared address derivation

**File**: `src/lib/staff-identity.ts`

**Intent**: One pure function used by both provisioning and sign-in, so the two
sides cannot drift. This is the contract the whole change rests on.

**Contract**: Export `staffAuthEmail(venueCode: string, login: string): string`,
normalising both inputs to lower case and composing a syntactically valid,
permanently non-resolvable address. Use the RFC 2606 reserved `.invalid` TLD so
no real address can ever collide and no mail can be attempted:

```
`${login}@${venueCode}.staff.orderly.invalid`
```

Also export the login validation rule so the schema and any future caller share
it: lowercase letters, digits, dot, hyphen and underscore only, 3–32 chars. The
character set must exclude `@` and anything that would make the composed string
an invalid address.

#### 2. Schemas

**File**: `src/lib/schemas/staff.ts`

**Intent**: The create payload takes a login; email becomes optional contact
data.

**Contract**: Replace the required `email` in `staffCreateInputSchema` with a
required `login` validated against the shared rule from `staff-identity.ts`,
plus an optional `email` (`.nullish()` → `null`, still `z.email()` when
present, still trimmed and lowercased). `staffUpdateInputSchema` gains an
optional `email` and does **not** gain `login` — logins are immutable, matching
the existing email contract. Keep every message Polish, as elsewhere in the file.

#### 3. Provisioning module

**File**: `src/lib/staff-admin.ts`

**Intent**: Create the auth user under the derived address rather than the
owner-supplied one.

**Contract**: `createStaffAuthUser` takes `{ venueCode, login, password, fullName }`
and calls `auth.admin.createUser` with `email: staffAuthEmail(venueCode, login)`.
Keep `email_confirm: true`, keep the metadata free of `company_name`, and keep
the try/catch and the boolean-returning `deleteStaffAuthUser` added by the S-02
review. The duplicate-detection helper still applies — a duplicate now means the
login is taken within the venue, so the caller's message changes accordingly.

#### 4. API routes

**File**: `src/pages/api/staff/index.ts`

**Intent**: Provision by login; return the login in the roster; stop sorting by
a column that may now be null.

**Contract**: `POST` reads the venue code from the caller's own company — it
must **not** come from the request body — then derives the address. Insert
`login` alongside `company_id`, `role`, `full_name`, `email`. Map a duplicate to
409 `"Ten login jest już zajęty w Twoim lokalu"`, which is now truthful and
tenant-scoped, unlike the deliberately vague message S-02 had to use. `GET`
adds `login` to `COLUMNS` and orders by `role` then `login`.

**File**: `src/pages/api/staff/[id].ts`

**Contract**: Add `email` to the patch builder; `login` is absent from the
update schema and must not be writable.

**File**: `src/types.ts`

**Contract**: Append `login: string | null` to `StaffMember` and make `email`
`string | null`.

#### 5. Schema unit tests

**File**: `src/lib/schemas/staff.test.ts`

**Contract**: Cover the login rule (valid, too short, too long, rejected
characters, uppercase normalised), optional email (absent → null, present and
valid, present and malformed → rejected), and that `staffUpdateInputSchema`
rejects a `login` key. Add a test file for `staffAuthEmail` asserting it is
stable, lowercased, and identical for inputs differing only in case — the
derivation being deterministic is what makes sign-in work without a lookup.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Creating a staff member with a login succeeds and the roster shows the login
- The same login in a second venue is accepted (verify directly against the DB)
- A duplicate login within one venue returns 409 with the new message
- Two staff in one venue may share an email, and a staff member may have none
- No orphaned `auth.users` rows after a failed create

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Sign-in and identity display

### Overview

The venue code reaches the sign-in form, the server translates it, and every
place that showed an email as identity switches to the login. This is the only
phase that touches a working authentication path.

### Changes Required:

#### 1. Sign-in form

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Accept an optional venue code and stop rejecting non-email
identities when one is present.

**Contract**: Add a `venue_code` field above the identity field, with a hint
explaining that owners leave it empty. Make the identity field's label and
validation conditional: with a venue code present, the field is a login and the
email regex must not run; with it empty, current behaviour is unchanged. The
form must remain a native `<form method="POST">` — `SubmitButton` depends on
`useFormStatus()`, which reports nothing for a JS-driven submit. Note that
`FormField` derives `name` from `id`, so the new field's `id` becomes its
formData key.

#### 2. Sign-in endpoint

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Translate `(venue code, login)` into the derived address before
authenticating; leave the owner path exactly as it is.

**Contract**: Read the new `venue_code` key. When non-empty, pass
`staffAuthEmail(code, identity)` to `signInWithPassword`; when empty, pass the
identity through unchanged. **No database lookup** — the derivation is
deterministic, so a nonexistent venue code simply produces an address that does
not exist and fails identically to a wrong password. Widen the existing error
mapping so the single generic message covers all three failure modes:
`"Nieprawidłowy kod lokalu, login lub hasło."` Keep mapping only the known
Supabase error and continue to avoid leaking `error.message`.

#### 3. Identity display

**File**: `src/components/staff/StaffRow.tsx`

**Intent**: The login becomes the identity shown; email becomes secondary and
may be absent.

**Contract**: Display name falls back to `login` rather than `email`, in both
the visible text and the `aria-label`s. Render the email line only when present.

**File**: `src/components/staff/StaffManager.tsx`

**Contract**: The confirm-dialog name falls back to `login`.

**File**: `src/components/staff/StaffDialog.tsx`

**Contract**: Create mode asks for a login (required) and an email (optional);
edit mode shows neither — both are immutable. Keep `autoComplete="new-password"`
on the password field and `autoComplete="off"` on the login field.

**Files**: `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Never show a staff member their synthetic address.

**Contract**: Both currently print `user.email` from the session. Prefer the
profile identity — `full_name`, then `login`, then `email` — reading from
`Astro.locals`. This requires the middleware to carry one more field; add it to
the existing `profiles` select rather than issuing a second query.

**File**: `src/middleware.ts`, `src/env.d.ts`

**Contract**: Add the display identity to the existing `.maybeSingle<>()` select
and to `App.Locals`. Shared append-only file — keep the diff minimal.

#### 4. Venue code visibility

**File**: `src/pages/staff.astro`

**Intent**: The owner cannot tell staff a code they cannot see.

**Contract**: Read the company's `code` server-side in the frontmatter (owner is
already guaranteed by middleware) and render it near the heading, with one line
of copy explaining that staff need it to sign in. No top-level `return` in the
frontmatter (`settings.astro:6-7`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- Production build succeeds: `npm run build`

#### Manual Verification:

- An owner signs in with email and an empty venue code, exactly as before
- A staff member signs in with venue code, login and password, and reaches the
  dashboard scoped to the right venue
- A wrong venue code, a wrong login and a wrong password all produce the same
  message
- Neither `/` nor `/dashboard` shows a synthetic `.invalid` address anywhere
- The staff roster shows logins and is ordered by role then login
- The venue code is visible to the owner on `/staff`
- A staff member of venue A cannot reach venue B's data
- Layout holds at mobile width

**Implementation Note**: Pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `src/lib/staff-identity.test.ts` — determinism and case-insensitivity of
  `staffAuthEmail`, and the login validation rule at its boundaries.
- `src/lib/schemas/staff.test.ts` — login required and validated on create,
  email optional, `login` rejected on update.

### Integration Tests:

- `supabase/tests/rls_isolation.sql` — same login in two venues both succeed;
  duplicate login in one venue raises `23505`; duplicate and null emails now
  succeed; the registration trigger mints a venue code.
- Run with `npm run test:rls` against the **linked remote** project.

### Manual Testing Steps:

1. As owner, open `/staff` and note the venue code.
2. Create a waiter with login `anna`, no email.
3. Sign out. Sign in with the venue code, `anna`, and the password → dashboard,
   no `/menu` or `/staff` links, no `.invalid` address visible anywhere.
4. Sign in as the owner with email and an empty venue code → unchanged.
5. Try a wrong venue code with a correct login, then a correct code with a wrong
   login → identical message both times.
6. Create a second waiter with the same login `anna` in the same venue → 409.
7. Create two staff sharing one email → both succeed.
8. Register a second company, create a waiter with login `anna` there → succeeds,
   and each `anna` signs in to their own venue only.

## Performance Considerations

Negligible, and slightly better than today on the sign-in path: deriving the
address adds no query, where a lookup-based design would have added one to
every sign-in attempt. The two new unique indexes are small. Phase 3 adds one
column to the `profiles` select the middleware already runs.

## Migration Notes

- The venue-code backfill must complete before the `NOT NULL` and the unique
  index, all inside the migration transaction.
- **`handle_new_user()` must be replaced starting from
  `20260728101449_restore_default_room_seed.sql`**, the current authoritative
  body. Replacing it from an older version is exactly the S-02 F1 regression;
  assertion 19 in the RLS suite will catch it, and that assertion must stay
  green.
- **The three existing staff accounts on the hosted project are not migrated.**
  They keep working through the owner path (their real address is still a valid
  credential) but have no login. Delete them via the Supabase dashboard and
  recreate them through `/staff` after Phase 2. This is deliberately manual —
  see "What We're NOT Doing".
- Rollback: dropping the two indexes and the two columns reverts the schema;
  restoring `profiles.email` to `NOT NULL` would fail if any null rows exist by
  then, so a rollback after real use needs a backfill first.
- Never run `supabase config push`.
- Coordinate with S-06/S-07 on `src/middleware.ts`, `src/types.ts`,
  `src/env.d.ts` and `supabase/tests/rls_isolation.sql`.

## References

- Frame brief: `context/changes/staff-login-identifiers/frame.md`
- Origin: `context/changes/staff-accounts-roles/reviews/impl-review.md:93-105` (F4)
- PRD Non-Goal: `context/foundation/prd.md:246`
- FR-011 (QR permanence, the constraint the venue code is designed for): `context/foundation/prd.md:155`
- Current authoritative trigger body: `supabase/migrations/20260728101449_restore_default_room_seed.sql`
- Sign-in path: `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx:18-30`
- Identity display: `src/components/Topbar.astro:11`, `src/pages/dashboard.astro:15`
- Staff list ordering and display: `src/pages/api/staff/index.ts:30`, `src/components/staff/StaffRow.tsx:26`
- Provisioning precedent: `src/lib/staff-admin.ts`
- Config constraints: `supabase/config.toml` `[auth]`, `[auth.email]`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Venue code and staff login in the schema

#### Automated

- [x] 1.1 Migration applies cleanly: `npm run db:push` — 58be1f9
- [x] 1.2 RLS isolation suite passes, including every pre-existing assertion: `npm run test:rls` — 58be1f9
- [x] 1.3 Linting passes: `npm run lint` — 58be1f9

#### Manual

- [x] 1.4 Both existing companies have a non-null, distinct `code` — 58be1f9
- [x] 1.5 New company registration produces a code, four categories and one room — 58be1f9
- [x] 1.6 Existing `/menu` and `/staff` pages still load for an owner — 58be1f9

### Phase 2: Synthetic auth address and provisioning

#### Automated

- [x] 2.1 Unit tests pass: `npm run test`
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 2.5 Creating a staff member with a login succeeds and the roster shows it
- [ ] 2.6 The same login in a second venue is accepted
- [ ] 2.7 A duplicate login within one venue returns 409 with the new message
- [ ] 2.8 Two staff in one venue may share an email; a staff member may have none
- [ ] 2.9 No orphaned `auth.users` rows after a failed create

### Phase 3: Sign-in and identity display

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Unit tests pass: `npm run test`
- [ ] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 An owner signs in with email and an empty venue code, as before
- [ ] 3.6 A staff member signs in with venue code, login and password
- [ ] 3.7 Wrong venue code, wrong login and wrong password give the same message
- [ ] 3.8 No synthetic `.invalid` address is visible anywhere in the UI
- [ ] 3.9 The staff roster shows logins and is ordered by role then login
- [ ] 3.10 The venue code is visible to the owner on `/staff`
- [ ] 3.11 A staff member of venue A cannot reach venue B's data
- [ ] 3.12 Layout holds at mobile width
