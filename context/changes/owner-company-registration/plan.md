# Owner Company Registration (S-01) Implementation Plan

## Overview

Let a venue owner register a company, log in, and edit the venue profile. Registration signs up
the owner and — via a `SECURITY DEFINER` trigger reading signup metadata — atomically creates the
`companies` row and the owner `profiles` row (F-01's tables). Email confirmations are off for MVP,
so registration yields a session immediately and the owner lands on the dashboard with tenant
context already resolved by the F-01 middleware. A settings page lets the owner edit venue
name/address/opening hours.

## Current State Analysis

- **F-01 is done**: `companies`, `profiles` (1:1 `auth.users`, role enum), `tables`, `menu_items` exist on hosted with RLS default-deny. `companies`/`profiles` have **no authenticated INSERT** — creation must be privileged (F-01's "bootstrap = S-01" note). `companies_update_owner` already allows an owner to UPDATE their company. Middleware ([src/middleware.ts](../../../src/middleware.ts)) resolves `locals.company_id`/`role` from `profiles`.
- **Existing auth**: [signup.ts](../../../src/pages/api/auth/signup.ts) does only `auth.signUp({email,password})` → redirect `/auth/confirm-email`; it does NOT create a company/profile. [signin.ts](../../../src/pages/api/auth/signin.ts) works → `/`. [SignUpForm.tsx](../../../src/components/auth/SignUpForm.tsx) is a React form (email+password). [dashboard.astro](../../../src/pages/dashboard.astro) shows `user.email` + signout.
- **Email confirmations**: `supabase/config.toml` `[auth.email] enable_confirmations = false` (local). Hosted auth config is separate and must be aligned.
- **Migrations tooling** (from F-01): `db:new`/`db:push`/`test:rls`; project linked; `supabase db query --linked` runs privileged SQL for sims.

### Key Discoveries:

- Passing `options.data` to `auth.signUp` stores it in `auth.users.raw_user_meta_data` — a trigger can read `company_name`/`full_name` from there. This is the idiomatic Supabase "handle_new_user" pattern and needs **no `service_role` key on the edge Worker**.
- A `SECURITY DEFINER` trigger bypasses RLS, so it can INSERT into `companies`/`profiles` even though `authenticated` cannot.
- With confirmations off, `auth.signUp` returns a live session (`@supabase/ssr` sets the cookie), so the flow is one step: register → `/dashboard`.

## Desired End State

Registering with email + password + venue name creates the auth user, the company, and the owner
profile; the owner is logged in and lands on `/dashboard`. The owner can open a settings page and
edit venue name/address/opening hours, persisted to `companies`. Non-owners/anon cannot access or
mutate another company's profile.

**Verify:** register via the UI → `/dashboard`, `locals.company_id`/`role` populated, `companies`+`profiles` rows exist; edit the venue profile → values persist; a second company's owner cannot see/edit the first's data.

## What We're NOT Doing

- **Staff accounts / roles provisioning** (FR-003) — that is S-02. Note: the `handle_new_user` trigger is **conditional on `company_name` metadata**, so S-02's staff creation (no `company_name`) will not spuriously create a company; S-02 owns staff-profile creation.
- **Menu / tables / QR / ordering** — S-03…S-08.
- **Orphan handling** (a logged-in user with no company) — explicitly out of scope (assume registration always creates the company; no guard/redirect added).
- **Email verification & registration abuse guard** — confirmations off for MVP is a **project-wide** auth downgrade (affects all auth, not just registration), and open signup lets anyone create unlimited companies (each `company_name` signup = a new company). Accepted MVP debt: re-enable confirmations and add a registration/abuse guard in phase 2.
- **`service_role` key on the Worker** — avoided by using the trigger.

## Implementation Approach

Backend-first: add the trigger + align email config so the creation path works, verified by a
rolled-back SQL simulation. Then wire the registration flow (endpoint metadata + form field) so a
real signup exercises the trigger. Finally add the owner-only settings page + update endpoint for
FR-002. Every DB change is an additive migration pushed to hosted.

## Critical Implementation Details

- **Trigger must be conditional on `company_name`.** Fire the company+owner creation only when `new.raw_user_meta_data ? 'company_name'`. Otherwise S-02 staff signups (and any non-owner `auth.users` insert) would each spawn a stray company. Owner registration always sends `company_name` (endpoint validates it required).
- **Email confirmations must be OFF on hosted**, not just locally. If left on, `auth.signUp` returns no session and the owner can't land on `/dashboard` authenticated — the whole one-step flow breaks. Align via the **dashboard Auth toggle** (NOT `supabase config push`, which overwrites the entire remote auth config) and verify.
- **A trigger error aborts signup.** Keep `handle_new_user` minimal and defensive; a failure inside it surfaces as a signup error to the user.

## Phase 1: Backend company creation (trigger + email config)

### Overview

Add the `handle_new_user` trigger that creates a company + owner profile from signup metadata, and
turn off email confirmations on hosted.

### Changes Required:

#### 1. Registration trigger migration

**File**: `supabase/migrations/<ts>_owner_registration_trigger.sql`

**Intent**: On a new auth user carrying `company_name` metadata, atomically create the company and the owner profile, bypassing RLS.

**Contract**: `SECURITY DEFINER`, `search_path = ''` function + `after insert` trigger on `auth.users`:

```sql
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare new_company_id uuid;
begin
  if new.raw_user_meta_data ? 'company_name' then
    insert into public.companies (name)
      values (new.raw_user_meta_data->>'company_name')
      returning id into new_company_id;
    insert into public.profiles (user_id, company_id, role, full_name)
      values (new.id, new_company_id, 'owner', new.raw_user_meta_data->>'full_name');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
```

#### 2. Disable email confirmations on hosted

**File**: `supabase/config.toml` (+ apply to linked project)

**Intent**: One-step registration — `auth.signUp` returns a session immediately.

**Contract**: `[auth.email] enable_confirmations = false` (already set locally). Apply to hosted by toggling **Authentication → Providers → Email → "Confirm email" OFF in the Supabase dashboard** (surgical). Do NOT use `supabase config push` for this — it overwrites the *entire* remote auth config from the local starter `config.toml` and can clobber Site URL / redirect URLs / providers. Verify confirmations are off on hosted.

### Success Criteria:

#### Automated Verification:

- `npm run db:push` applies the trigger migration cleanly
- Trigger `on_auth_user_created` + function `handle_new_user` exist and the function is `SECURITY DEFINER`
- Simulation (rolled back): inserting an `auth.users` row **with** `company_name` metadata creates exactly 1 company + 1 owner profile; **without** `company_name` creates neither
- `npm run lint` passes

#### Manual Verification:

- Email confirmations are OFF on the hosted project (Auth settings / `config push` applied)

---

## Phase 2: Registration flow (endpoint + form)

### Overview

Wire the signup endpoint to pass venue name + owner name as metadata (exercising the trigger) and
add the venue-name field to the form.

### Changes Required:

#### 1. Signup endpoint

**File**: `src/pages/api/auth/signup.ts`

**Intent**: Collect `company_name` (required) + `full_name`, pass them as `auth.signUp` metadata, and land the owner on the dashboard.

**Contract**: Read `company_name`/`full_name` from the form; if `company_name` is blank, redirect back to `/auth/signup?error=...`. Call `auth.signUp({ email, password, options: { data: { company_name, full_name } } })`. On error (e.g. duplicate email), redirect back with `error.message`. **Then check `data.session`:** with confirmations off, an existing/obfuscated email can return `{ session: null, error: null }` (Supabase enumeration-safe behavior) — if there's no session, redirect back to `/auth/signup` with a generic message ("nie udało się utworzyć konta / e-mail może być zajęty"). Only when a session exists, redirect to `/dashboard`.

#### 2. Registration form

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Collect the venue name (required) and owner full name (optional).

**Contract**: Add a required "Nazwa lokalu" (`company_name`) input and an optional "Imię i nazwisko" (`full_name`) input to the existing email/password form; submit as form fields.

### Success Criteria:

#### Automated Verification:

- `npx astro sync` + `npm run build` pass
- `npm run lint` passes

#### Manual Verification:

- Registering via the UI with a venue name lands on `/dashboard`, authenticated; `companies` + owner `profiles` rows exist; `locals.company_id`/`role` populate on the next request
- Duplicate email shows a clear error on the form; empty venue name is rejected before signup

---

## Phase 3: Venue profile settings (FR-002)

### Overview

An owner-only settings page to edit venue name/address/opening hours, backed by an update endpoint.

### Changes Required:

#### 1. Settings page

**File**: `src/pages/settings.astro`

**Intent**: Owner edits the venue profile; form prefilled from the company row.

**Contract**: Server-render: redirect to `/auth/signin` if unauthenticated; guard owner-only (`locals.role === 'owner'`, else redirect/403). Query the `companies` row for `locals.company_id` and prefill a form (name/address/opening_hours) posting to the update endpoint. Surface success/error from query params.

#### 2. Profile update endpoint

**File**: `src/pages/api/company/profile.ts`

**Intent**: Persist venue profile edits, scoped to the owner's company.

**Contract**: `POST` — validate `name` non-empty; `update public.companies set name/address/opening_hours where id = <locals.company_id>` via the request-scoped Supabase client (RLS `companies_update_owner` enforces owner + same company). Redirect back to `/settings` with success/error.

#### 3. Dashboard link

**File**: `src/pages/dashboard.astro`

**Intent**: Discoverable entry to settings.

**Contract**: Add a link to `/settings`.

### Success Criteria:

#### Automated Verification:

- `npm run build` passes
- `npm run lint` passes

#### Manual Verification:

- As the owner, editing name/address/opening hours on `/settings` persists (reload shows new values)
- Anonymous/non-owner cannot access `/settings` (redirected); a cross-company update is blocked by RLS

---

## Testing Strategy

### Unit Tests:

- None new; the trigger is validated by a rolled-back SQL simulation (extends the F-01 `supabase db query --linked` approach).

### Integration Tests:

- Trigger simulation: insert `auth.users` (+/- `company_name` metadata) → assert company/profile creation, rolled back.
- `supabase/tests/rls_isolation.sql` remains green (no policy changes here).

### Manual Testing Steps:

1. Register with email + password + venue name → land on `/dashboard`; confirm company + owner profile via `supabase db query --linked`.
2. Attempt duplicate-email registration → clear error; empty venue name → rejected.
3. Edit venue profile on `/settings` → persists; sign out, hit `/settings` → redirected; confirm RLS blocks another company's row.

## Performance Considerations

Registration adds one trigger execution (two inserts) inside the signup transaction — negligible.
No new per-request cost beyond F-01's middleware profile lookup.

## Migration Notes

The trigger migration is additive. Email-confirmation config is a project setting (not a schema
migration) — applied via `config push`/dashboard. After the flow works, `wrangler deploy` publishes
the updated endpoint/form to the production Worker (the DB trigger is already live once pushed).

## References

- Roadmap item: `context/foundation/roadmap.md` → S-01 `owner-company-registration`
- Foundation: `context/changes/multitenant-rls-foundation/plan.md` (companies/profiles/RLS, bootstrap = S-01)
- PRD: FR-001 (register company + login), FR-002 (edit venue profile), Access Control (owner)
- Existing auth: `src/pages/api/auth/signup.ts`, `src/components/auth/SignUpForm.tsx`, `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Backend company creation (trigger + email config)

#### Automated

- [x] 1.1 `npm run db:push` applies the trigger migration cleanly
- [x] 1.2 Trigger `on_auth_user_created` + `handle_new_user` exist; function is `SECURITY DEFINER`
- [x] 1.3 Sim (rolled back): with `company_name` → 1 company + 1 owner profile; without → neither
- [x] 1.4 `npm run lint` passes

#### Manual

- [x] 1.5 Email confirmations are OFF on the hosted project

### Phase 2: Registration flow (endpoint + form)

#### Automated

- [ ] 2.1 `npx astro sync` + `npm run build` pass
- [ ] 2.2 `npm run lint` passes

#### Manual

- [ ] 2.3 UI registration with venue name → `/dashboard` authed; company + owner profile exist; locals populated
- [ ] 2.4 Duplicate email → clear error; empty venue name → rejected before signup

### Phase 3: Venue profile settings (FR-002)

#### Automated

- [ ] 3.1 `npm run build` passes
- [ ] 3.2 `npm run lint` passes

#### Manual

- [ ] 3.3 Owner edits name/address/opening hours on `/settings` → persists
- [ ] 3.4 Anonymous/non-owner cannot access `/settings`; cross-company update blocked by RLS
