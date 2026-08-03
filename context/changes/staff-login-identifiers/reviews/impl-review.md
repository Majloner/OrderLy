<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-Venue Staff Login

- **Plan**: `context/changes/staff-login-identifiers/plan.md`
- **Scope**: All phases (1–3), commits `58be1f9`, `889d529`, `8291fc5`, `2818e46`
- **Date**: 2026-07-29
- **Verdict**: REJECTED at review time → F1 and F2 fixed 2026-08-03; F3–F10 left PENDING by choice
- **Findings**: 1 critical, 6 warnings, 3 observations — 2 FIXED (+F8 partially, as a side effect), 8 PENDING

> **Triage outcome.** The user opted to fix only the critical and the one warning
> with severe consequences. Post-fix state: 121 tests, typecheck 0, lint 0,
> build ok, `test:rls` passes with 23 assertions.
> **Still open and worth scheduling**: F3 (synthetic address shown to a
> deactivated staff member), F4 (`companies.code` under the blanket anon read —
> becomes material when S-08's anonymous QR flow lands), F5 (no sign-in
> throttle), F6 (plan no longer matches what was built), F7 (backfill script
> swallows its own rollback error), F9, F10. Also outstanding from F1's Fix A:
> the `before_user_created` GoTrue hook, a manual dashboard step.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated criteria re-verified on the committed tree: `npm run test` 111 passed,
`npm run typecheck` 0 errors, `npm run lint` exit 0, `npm run build` exit 0 at
commit time, `npm run test:rls` passes with 22 assertions.

**What checked out clean.** The derived-address invariant — the thing the whole
design rests on — holds under adversarial analysis. `staffAuthEmail` is called
at exactly two sites and cannot drift: `toLowerCase()` is locale-independent so
the Turkish-I hazard does not apply; the provisioning regex is ASCII-only so no
Unicode normalization form can ever be stored; and because `@` is excluded from
the login and the composition inserts exactly one, the split point is unique —
`staffAuthEmail(c1,l1) == staffAuthEmail(c2,l2)` iff the pairs match
case-insensitively. No `(code, login)` pair can reach another's address. The
"no database lookup at sign-in" claim is literally true (one GoTrue call, zero
queries). `generate_venue_code()` was checked by hand: the alphabet really is
31 characters, `1 + floor(random()*31)` is uniform over 1..31 with no
off-by-one, and the retry loop terminates. The `handle_new_user` body was
diffed against `20260728101449` and is that version exactly plus `code` — the
S-02 F1 regression is not repeated. No cross-tenant read or write exists in the
application: both `companies.code` selects use the user-scoped client with
`company_id` from `locals`.

## Findings

### F1 — Open signup lets anyone permanently squat another venue's staff logins

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (tenant isolation)
- **Location**: src/pages/api/auth/signup.ts:6,22
- **Detail**: `signup.ts` reads `email` with `form.get("email") as string` and applies **no zod schema, no format check and no domain blocklist** — only `company_name` is validated. `supabase/config.toml` has `enable_signup = true`, `enable_confirmations = false`, no captcha and no `before_user_created` hook, and GoTrue accepts the `.invalid` TLD (proven — the four migrated accounts live there). So an unauthenticated attacker can register `anna@h42nam.staff.orderly.invalid`. **This is not a takeover**: `handle_new_user` requires `company_name`, so the squatter lands in their own new tenant and gains no access to the victim's data. What it does buy is worse in a mundane way — the venue's owner can now *never* create the login `anna`. `createStaffAuthUser` gets `email_exists`, and `api/staff/index.ts:79-81` returns 409 "Ten login jest już zajęty w Twoim lokalu" for a login that does not exist in their venue and that they have no route to reclaim. Repeat over `anna, jan, kelner, kuchnia, szef` × every venue code readable off a QR sticker. Two aggravations: each squat also creates a junk tenant (company + 4 categories + 1 room) from an unauthenticated endpoint, and signup becomes a staff-existence oracle (session returned ⇒ that login is free at that venue). The comment at `staff-admin.ts:34-36` — "the venue code is the caller's own, so there is no cross-tenant reading of this signal any more" — is therefore **false**.
- **Fix A ⭐ Recommended**: Validate the signup email with zod and reject the reserved suffix, plus enable `[auth.hook.before_user_created]` so a direct GoTrue call cannot route around the Astro endpoint.
  - Strength: Closes the namespace entirely and at both layers; the zod half matches how every other input in this repo is handled.
  - Tradeoff: The hook is Supabase config, and `supabase config push` is forbidden here — it must be set in the dashboard, which is a manual step outside the repo.
  - Confidence: HIGH — the absence of validation is verified by reading, and the `.invalid` acceptance is proven by the four accounts already created.
  - Blind spot: Whether the dashboard exposes that hook on this plan tier.
- **Fix B**: Validate in `signup.ts` only.
  - Strength: One file, no infrastructure, ships immediately.
  - Tradeoff: Anyone holding the publishable anon key can call GoTrue's `/signup` directly and bypass the Astro route entirely, so the hole is narrowed rather than closed.
  - Confidence: HIGH — trivially correct as far as it goes.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B (code half of Fix A) — new `src/lib/schemas/auth.ts` validates every signup field and refuses the whole `.staff.orderly.invalid` namespace case-insensitively; `signup.ts` now parses through it, gained the missing `prerender` export, and stopped leaking `error.message` (which also closes F8 for that route). `STAFF_EMAIL_DOMAIN_SUFFIX` is exported from `staff-identity.ts` so validation and composition share one constant. 10 new tests, including one that feeds `staffAuthEmail("H42NAM","anna")` straight back into the schema and expects rejection. **Still outstanding from Fix A**: the `before_user_created` GoTrue hook, which would stop a direct call to GoTrue's own `/signup` bypassing the Astro route. That is dashboard configuration — `supabase config push` is forbidden in this project — so it remains a manual step.

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: supabase/migrations/20260705212949_tenancy_core.sql:80-84
- **Detail**: The migration header states the code "is generated once and never changes — there is deliberately no owner-facing way to edit it," and FR-011 requires exactly that for printed QR codes. But `companies_update_owner` is a table-wide `for update` with **no column restriction and no immutability trigger**, verified by reading the policy. Nothing in the schema stops `update companies set code = 'ABC123'`. It is unreachable today only because `api/company/profile.ts:28` builds an explicit three-column patch — the invariant rests entirely on the absence of a route. The failure if one ever lands is severe and silent: staff auth addresses are *derived* from the code and never stored, so changing it makes every staff address in that venue uncomposable. Every waiter and kitchen account is permanently locked out, with no recovery path — no password reset, no email delivery, and the login is immutable by design.
- **Fix**: Add a `before update` trigger raising when `new.code is distinct from old.code`, plus an RLS assertion covering it.
  - Strength: Makes the documented invariant real at the layer that owns it, matching how `profiles_guard_self_change` already enforces the analogous rule.
  - Tradeoff: One more trigger on a hot table; needs a mapped error if a route ever does hit it.
  - Confidence: HIGH — the policy text is unambiguous and the consequence is mechanical.
  - Blind spot: None significant.
- **Decision**: FIXED — `supabase/migrations/20260803134535_venue_code_immutable.sql` adds a `before update` trigger raising 42501 when `code` changes, mirroring `profiles_guard_self_change`. Assertion 23 proves both halves: the update is rejected with 42501, and renaming the company still works so the trigger does not over-block FR-002. Applied and the suite passes with 23 assertions.

### F3 — The synthetic address is shown to a deactivated staff member

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/Topbar.astro:13, src/pages/dashboard.astro:16
- **Detail**: Both files render `{display_name ?? user.email}` and both carry a comment saying the synthetic address must never be shown back to staff — then keep the fallback that does exactly that. Concrete repro: deactivate a waiter, then have them sign in. Authentication **succeeds**, because deactivation only sets `profiles.deactivated_at` and leaves `auth.users` untouched. `signin.ts:39` redirects to `/`, which is not in `PROTECTED_ROUTES`, so the sign-out guard never fires. `current_company_id()` returns NULL for them, so their own profile row is filtered, `display_name` stays null, and the Topbar renders `anna@h42nam.staff.orderly.invalid`.
- **Fix**: Fall back to `user.email` only when `role === "owner"`; owners are the only accounts whose address is genuine. Consider adding `/` to the deactivated-session check.
- **Decision**: PENDING

### F4 — `companies.code` inherits a blanket anon read policy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260705215147_minimal_tables_menu.sql:59-62
- **Detail**: `companies_anon_read` is `to anon using (true)` over all rows and all columns. The new `code` column joins that set without the migration considering the policy. Contained today because `SUPABASE_KEY` is server-only (`astro.config.mjs:25`) and no browser Supabase client exists — verified. But the MVP's anonymous QR-ordering flow (S-08, the north star) is precisely the thing that will need a public read path, and at that point `GET /rest/v1/companies?select=code` returns every venue code on the platform, turning F1 from targeted into bulk. This is the same class as the existing entry in `lessons.md` about anon reads needing company_id scoping.
- **Fix**: Narrow anon access to a column list or a view before the anonymous QR flow lands, and add it to the S-07/S-08 plan as a prerequisite.
  - Strength: Fixes the whole anon-read class rather than this one column, and `lessons.md` already commits the team to doing it at S-07/S-08.
  - Tradeoff: Touches a policy other slices depend on; the RLS suite asserts current anon behaviour and would need updating with it.
  - Confidence: HIGH — policy text and key scoping both verified.
  - Blind spot: Whether S-08's design needs `code` readable anonymously at all.
- **Decision**: PENDING

### F5 — No app-layer throttle, against a weakened credential space

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signin.ts
- **Detail**: Before this change an attacker needed to know a real email address. Now they need a photo of a sticker plus a plausible first name. Passwords are owner-chosen by hand with a floor of 8 and `password_requirements = ""`. The endpoint has no rate limiting, lockout or captcha of its own; the only brake is GoTrue's `sign_in_sign_ups = 30 / 5 min / IP`, which rotating IPs defeat. Rate limiting was explicitly excluded in the plan's "What We're NOT Doing" (it needs KV or a Durable Object on Workers), so this is a known gap rather than an oversight — but the plan made that call before the credential space narrowed this far.
- **Fix**: Enable Supabase's captcha on the auth endpoints (`[auth.captcha]` is already in config.toml, commented out) as the cheapest real mitigation.
  - Strength: No Workers infrastructure needed, and it covers signup too, which F1 also abuses.
  - Tradeoff: Adds friction to every staff sign-in on a device behind a bar; needs a provider account.
  - Confidence: MEDIUM — captcha is available but its UX cost on a shared restaurant tablet is untested here.
  - Blind spot: Whether hCaptcha/Turnstile works acceptably in the Workers + Astro SSR setup.
- **Decision**: PENDING

### F6 — The plan no longer describes what was built

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline / Plan Adherence
- **Location**: context/changes/staff-login-identifiers/plan.md
- **Detail**: Two authorized mid-flight decisions were never written back. (1) The plan's "What We're NOT Doing" says "**No automated deletion of the three existing staff accounts** … It is a manual step" and Migration Notes say to delete them via the dashboard and recreate them through `/staff`. Instead `scripts/backfill-staff-logins.mjs` was written and run, migrating four accounts in place. (2) The plan specifies the login is "lowercased"; the implementation preserves case. Both were explicit user decisions and both are documented in the commit messages, but a future reader — or `/10x-plan-review` — takes the plan as ground truth and would flag working code as drift. `eslint.config.js` also gained a `scripts/**` block that no plan section mentions.
- **Fix**: Add a short addendum section to the plan recording the three deviations and why.
- **Decision**: PENDING

### F7 — Backfill script discards the error from its own rollback

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: scripts/backfill-staff-logins.mjs:191
- **Detail**: When the Admin-API email rewrite fails, the script reverts `profiles.login` to null so the two sides never disagree — but `await admin.from("profiles").update({ login: null })…` discards its result. If the revert itself fails, nothing is logged and the invariant the comment promises is silently broken: `profiles.login` is set while `auth.users.email` is unchanged, so the staff list advertises a login that cannot sign in. The neighbouring `deleteStaffAuthUser` already treats exactly this log as load-bearing.
- **Fix**: Destructure `{ error }` from the revert and `console.error` it, matching `deleteStaffAuthUser`.
- **Decision**: PENDING

### F8 — Raw Supabase messages still leak in two sibling auth routes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signup.ts:29, src/pages/api/company/profile.ts:32
- **Detail**: `signin.ts` was deliberately fixed in this change to stop putting `error.message` into the query string, but its two siblings still do, and that string is rendered to the page by `ServerError`. `signup.ts:6` also does `form.get("email") as string` with no null guard, so a missing field sends the literal string `null` to GoTrue and the raw complaint reaches the user. Both are pre-existing, not introduced here — but F1 makes `signup.ts` worth touching anyway.
- **Fix**: Apply the `signin.ts` mapping pattern to both while fixing F1.
- **Decision**: PENDING

### F9 — Login pattern permits RFC-invalid local parts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/staff-identity.ts:35
- **Detail**: `/^[A-Za-z0-9._-]+$/` accepts `...`, `___`, `.a.` and `a..b`. Composed into an address these are invalid local parts per RFC 5322, even though GoTrue's looser validator accepts them today. A future GoTrue tightening would strand any account created with such a login, and the login is immutable.
- **Fix**: Require the login to start and end alphanumeric and forbid consecutive dots.
- **Decision**: PENDING

### F10 — Three small consistency gaps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: scripts/backfill-staff-logins.mjs:95-97, supabase/tests/rls_isolation.sql:419-421, supabase/migrations/20260728150833_venue_code_and_staff_login.sql:108-110
- **Detail**: (a) `staffAuthEmail` is duplicated verbatim in the backfill script, guarded only by a "must stay in step" comment — currently identical, but nothing enforces it. (b) A comment in the RLS suite still explains that a 23505 could come from `profiles_company_email_idx`, an index this migration dropped; the assertion still passes, only the rationale is stale. (c) `handle_new_user` has no retry on a venue-code collision, which is defensible at 1-in-887M, but the failure surfaces as a raw Postgres unique-violation message on the signup page because of F8.
- **Fix**: Import the helper or add an equality test; delete the stale sentence; leave the retry alone but let the F8 fix cover the message.
- **Decision**: PENDING
