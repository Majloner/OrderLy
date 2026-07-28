<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Staff Accounts and Roles (S-02)

- **Plan**: `context/changes/staff-accounts-roles/plan.md`
- **Scope**: All phases (1–3), commits `cfffeb2`, `9d11795`, `ad278e7`, `9dcf873`
- **Date**: 2026-07-28
- **Verdict**: REJECTED at review time → all 10 findings triaged and fixed 2026-07-28
- **Findings**: 1 critical, 4 warnings, 5 observations — 10 FIXED, 0 skipped

> **Triage outcome.** Every finding was fixed. F1 shipped as a follow-up migration
> (`20260728101449_restore_default_room_seed.sql`) plus assertion 19, which was confirmed to
> fail against the unrepaired database before passing after the push. F4 is fixed only as far
> as it can be — per-company email uniqueness is impossible while email is the login identifier,
> so a per-company staff login is being planned as a separate change. Post-fix state:
> `npm run lint` exit 0, `npm run typecheck` 0 errors, `npm run test` 45 passed,
> `npm run build` exit 0, `npm run test:rls` passes with 20 assertions.
>
> **Live verification against the running app** (owner session, real dev database, state
> restored afterwards; zero orphaned auth users left behind):
> F3 — self-rename now returns 200 (was 403), self role-change still 403, and the
> uppercase-UUID bypass is closed (403). Empty patch returns 400.
> F2 — deactivate, then rename while deactivated: the member stays deactivated and
> `deactivated_at` is byte-identical before and after the rename, proving the patch touches
> only the keys sent. Restore to active works.
> F4 — the 409 now reads "Tego adresu e-mail nie można użyć".
> F7 — `"  KELNER1@OP.PL  "` reaches the duplicate check as `kelner1@op.pl` instead of being
> rejected as malformed, confirming trim and lowercase run before the format check.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria re-verified this session: `npm run lint` exit 0, `npm run typecheck` 0 errors (71 files), `npm run test` 42 passed, `npm run build` exit 0, `npm run db:push` applied, `npm run test:rls` reached the rollback-proof row. All manual items confirmed by the user through the UI.

Notable clean results: no cross-`company_id` read or write path found; the service-role key is unreachable from any client bundle; a second owner is blocked at three independent layers (zod enum → `profiles_insert_owner` → the trigger, which binds the service role too since triggers ignore RLS); `auth.uid()` being NULL for the service role was checked and opens no hole.

## Findings

### F1 — `handle_new_user()` clobbers S-06's default-room seed

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data/correctness regression)
- **Location**: supabase/migrations/20260727220415_staff_accounts_roles.sql:150-177
- **Detail**: The migration's header says the body is "Same body as `20260708124756_menu_categories_items.sql`, with `email` added" — and that is exactly the bug. `20260727120000_room_layout_tables.sql:195-220` had already replaced `handle_new_user()` to also seed a default room (`insert into public.rooms ... 'Sala główna'`). This migration sorts later (22:04 vs 12:00) and rebased onto the wrong ancestor, silently dropping that insert. Verified live: `select prosrc like '%public.rooms%'` on the deployed function returns **false**. `public.tables.room_id` is `NOT NULL` with an FK to `rooms`, and `rooms_insert_owner` is owner-only, so every tenant registering from now on has no room and cannot be given a table or a QR code. The RLS suite cannot catch this — it seeds rooms by hand at `rls_isolation.sql:52` and nothing exercises `handle_new_user()`. Both existing companies predate the change, so no data is damaged yet.
- **Fix**: New migration re-adding the `rooms` insert to `handle_new_user()` (the current one is already pushed and committed, so it must not be edited in place), plus an RLS assertion that inserts into `auth.users` with `company_name` metadata and checks companies/profiles/menu_categories/rooms counts, so the next `create or replace` cannot regress silently. Correct the stale "same body as 20260708124756" comment.
  - Strength: Restores S-06's behaviour and adds the regression test whose absence allowed this.
  - Tradeoff: A fourth migration on this change; the assertion is ~15 lines of new test.
  - Confidence: HIGH — verified in both the migration files and the live database.
  - Blind spot: Whether S-06 has other uncommitted work that also touches this function.
- **Decision**: FIXED — `supabase/migrations/20260728101449_restore_default_room_seed.sql` restores the merged body (company + owner profile with email + 4 categories + 1 room) and idempotently backfills any company left without a room. Assertion 19 added to `rls_isolation.sql`; it was confirmed to FAIL against the unrepaired database (`FAIL bootstrap: 0 default rooms, expected 1 (S-06)`) and to PASS after the push. Live function verified: `prosrc like '%public.rooms%'` is now true.

### F2 — Renaming a member re-stamps `deactivated_at`; a stale client copy silently reactivates

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: src/pages/api/staff/[id].ts:44, src/components/staff/StaffDialog.tsx:80
- **Detail**: `PUT` writes `deactivated_at: body.input.active ? null : new Date().toISOString()` unconditionally — the schema has no "leave unchanged" value and `active` is required. Two consequences. (1) Renaming an already-deactivated member overwrites `deactivated_at` with `now()`, destroying the only record of when access was revoked. (2) The dialog derives `active` from its **loaded copy** of the row, so with a stale client the write resurrects: owner has `/staff` open in tab A, deactivates the waiter in tab B, then fixes a typo in tab A → `active: true` → `deactivated_at = null` → the waiter silently regains full access. The same last-write-wins clobber applies to `role` and `full_name` via `StaffManager.tsx:79-83`, which re-sends the cached values alongside the toggle.
- **Fix**: Make `role` and `active` optional in `staffUpdateInputSchema` and build the update object from only the keys actually present, so a rename never touches `deactivated_at`.
  - Strength: Removes the whole class rather than the one symptom, and shrinks the write surface to what the caller actually intends.
  - Tradeoff: The dialog and the confirm handler both need to send partial payloads; slightly more branching in the route.
  - Confidence: HIGH — traced end to end through the schema, route and both components.
  - Blind spot: A proper fix for concurrent edits needs an `updated_at` concurrency token; optional payloads narrow the window but do not close it.
- **Decision**: FIXED — `staffUpdateInputSchema` now has all three fields optional, with an absent key meaning "leave unchanged" and an explicit `null` full_name still clearing the name. `[id].ts` builds the patch from only the keys present and 400s on an empty patch. `StaffDialog` sends `{full_name, role}` only; `StaffManager.handleConfirm` sends `{active}` only, which also removes the reverse clobber (toggling activity reverting a rename made elsewhere). Four new schema tests cover the absent-vs-null semantics; 45 tests pass. Not yet re-verified through the UI.

### F3 — Blanket self-edit block makes the owner's own name uneditable anywhere in the app

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/staff/[id].ts:30-32, src/components/staff/StaffRow.tsx:57
- **Detail**: The route rejects every `PUT` where `id.data === guard.userId`. That was not in the plan's contract, and it contradicts a behaviour the plan deliberately guaranteed at the DB layer — Phase 1 item 8 required the trigger to *allow* an owner to rename themselves, and `rls_isolation.sql:471-473` asserts exactly that. The UI compounds it: `StaffRow.tsx:57` disables the **edit** pencil for self, whereas the plan said only "role and deactivation controls disabled". Net effect: an owner has no way to change their own display name anywhere — `settings.astro` edits company fields only. Two secondary notes: the plan asked for the 42501 → 403 message to "name the self-edit rule", but `[id].ts:52` returns the generic `"Ta zmiana jest niedozwolona"`; and the guard's `===` is a case-sensitive compare against a lowercase `user.id`, so an uppercased UUID in the path bypasses it (harmless today — the trigger catches it and maps to 403 — but the guard should not be the layer that fails).
- **Fix A ⭐ Recommended**: Drop the blanket check and let the trigger enforce it — reject only when the payload actually changes `role` or `active` for self, and move the specific Polish message onto the 42501 branch. Re-enable the pencil for self and hide the role `Select` in self-edit mode.
  - Strength: Restores the capability the plan designed for, and makes all three layers agree instead of two of them over-blocking.
  - Tradeoff: Touches the route, the row and the dialog; slightly more conditional UI.
  - Confidence: HIGH — the DB behaviour is already implemented and asserted, so only the layers above it need to relax.
  - Blind spot: None significant.
- **Fix B**: Keep the block and accept that self-rename is out of scope, documenting it in the plan's "What We're NOT Doing".
  - Strength: Zero code change; the current behaviour is safe, just limited.
  - Tradeoff: Leaves an asserted DB capability permanently unreachable, which will confuse the next person who reads the RLS test.
  - Confidence: HIGH — trivially correct.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `[id].ts` now rejects self-edits only when the payload carries `role` or `active`, compares the id case-insensitively, and the 42501 branch carries the specific message. `StaffRow` no longer disables the edit pencil for self (deactivation stays disabled); `StaffDialog` takes an `isSelf` prop that hides the role control, omits `role` from the payload, and adapts the description text. Lint, typecheck and 45 tests pass. Not yet re-verified through the UI.

### F4 — Duplicate-email 409 is a cross-tenant existence oracle and its wording is misleading

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (security)
- **Location**: src/pages/api/staff/index.ts:52-57, src/lib/staff-admin.ts:33-38
- **Detail**: `auth.users.email` is globally unique across the whole Supabase project, and the duplicate check runs before any company scoping. An owner of company A posting an arbitrary address learns whether it is registered anywhere in OrderLY — including another restaurant's owner or staff. The message also asserts something false: "Pracownik z tym adresem e-mail już istnieje" claims a staff member exists *in this company* when none does. Related product constraint, currently undocumented: because of that global uniqueness, one person can never work at two restaurants, and a departed employee's address can never be re-provisioned even after deactivation (`profiles_company_email_idx` keeps the row).
- **Fix**: Reword to something non-committal (e.g. "Tego adresu nie można użyć") and record the global-uniqueness constraint in the plan/PRD.
  - Strength: Removes the false assertion and blunts the oracle for a one-line change.
  - Tradeoff: Slightly less helpful message in the common honest case of a genuine duplicate.
  - Confidence: HIGH — the behaviour follows directly from Supabase's global email uniqueness.
  - Blind spot: Rate-limiting `POST /api/staff` would be the real mitigation; not addressed here.
- **Decision**: FIXED (partially) — the 409 is now "Tego adresu e-mail nie można użyć", removing both the false claim and the sharpest edge of the oracle, and the constraint is documented in `change.md` plus a comment at the call site. Verified the constraint's source directly: `auth.users_email_partial_key`, a unique index on `email` in the Supabase-managed `auth` schema. Scoping uniqueness per company is NOT possible while email is the login identifier — `signInWithPassword` resolves globally with no tenant parameter. The user opted to pursue a per-company login (requiring a company code/slug at sign-in) as a **separate change**, planned immediately after this triage. Rate-limiting remains unaddressed.

### F5 — Compensating delete swallows its own failure and can mask the original error

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/lib/staff-admin.ts:69-78, src/pages/api/staff/index.ts:47,73-74
- **Detail**: The ordering is right and the deleted id comes from the `createUser` response, never the request body — a caller cannot steer which account is deleted. Three holes remain. (a) `deleteStaffAuthUser` returns `void` and never reads the `{ error }` supabase-js returns, so a failed cleanup leaves a confirmed, password-bearing `auth.users` row with no profile — invisible to `GET /api/staff`, unreclaimable through any route, and the address is permanently 409'd. (b) Process death between the two calls produces the same orphan with no reconciliation path. (c) Both `createUser` and `deleteUser` re-throw non-`AuthError` exceptions (verified in `GoTrueAdminApi.js`), so a Workers `fetch` `TypeError` rejects the whole POST and the client gets a generic non-JSON 500 instead of the mapped Polish message — the exact thing the comment at `staff-admin.ts:69-71` promises not to do.
- **Fix**: Wrap both admin calls in try/catch; have `deleteStaffAuthUser` return a boolean and `console.error` the orphaned `{ userId, email }` on failure so the address is at least recoverable by hand.
  - Strength: Closes the masking path and leaves a breadcrumb for the otherwise-invisible orphan.
  - Tradeoff: `no-console` is `warn` in this config, so the log line needs a deliberate exception or a different sink.
  - Confidence: HIGH — the re-throw semantics were verified in the installed SDK source.
  - Blind spot: A true fix for (b) needs periodic reconciliation or an owner-facing "reclaim address" path; out of scope here.
- **Decision**: FIXED — `createStaffAuthUser` wraps the admin call in try/catch so a transport failure folds into the result union instead of rejecting the route. `deleteStaffAuthUser` now returns `boolean`, reads the `{ error }`, never throws, and `console.error`s the orphaned id (with a targeted `eslint-disable` — the id is the only route back to a stranded account). `index.ts` reports a distinct message when the rollback itself fails, so the owner learns the address is stuck rather than silently hitting 409 on retry. Hole (b), process death between the two calls, remains — it needs reconciliation, which is out of scope.

### F6 — `profileExistsInCompany` is dead code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/api.ts:132-137
- **Detail**: Repo-wide grep finds exactly two hits: the plan text and the definition. Zero call sites. This is the plan contradicting itself — Phase 2 #4 asked for the helper while Phase 2 #5 specified the zero-rows-means-404 pattern that makes it unreachable. The implemented approach is also strictly better: the helper would add a round trip and a TOCTOU window.
- **Fix**: Delete it; the zero-row 404 in `[id].ts:56-59` is the better design and is already in place.
- **Decision**: FIXED — removed from `src/lib/api.ts`.

### F7 — `.trim()` after `z.email()` never runs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (correctness)
- **Location**: src/lib/schemas/staff.ts:11-15
- **Detail**: Zod 4 runs the format check before appended checks, so the email validator sees the untrimmed value and `.trim()` is dead. An owner pasting `" kelner@lokal.pl "` gets "Nieprawidłowy adres e-mail" instead of a trimmed, accepted address. Empirically verified against the installed `zod@4.4.3`.
- **Fix**: `z.string().trim().pipe(z.email("Nieprawidłowy adres e-mail"))`.
- **Decision**: FIXED — `staff.ts` now trims and length-caps before piping into `z.email()`, then lowercases.

### F8 — `POST /api/staff` maps an RLS denial to 500 while `PUT` maps it to 403

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/staff/index.ts:73-79
- **Detail**: The POST error branch checks only `isUniqueViolation`, so a `profiles_insert_owner` denial (SQLSTATE 42501) falls through to a blanket 500 and additionally triggers the compensating delete without signalling that authorization, not infrastructure, was the cause. `[id].ts:51-53` already handles this correctly. Low probability — the guard checked `role === "owner"` from the same source — but the asymmetry is a gap.
- **Fix**: Add the `isInsufficientPrivilege(error) → 403` branch to POST, mirroring PUT.
- **Decision**: FIXED — added while reworking the POST error branch for F5.

### F9 — Two RLS gaps: an untested trigger branch and a denial assertion that cannot tell why it failed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria (test quality)
- **Location**: supabase/tests/rls_isolation.sql:408-423
- **Detail**: (a) The trigger's third branch — `new.role = 'owner' and old.role <> 'owner'`, i.e. an owner promoting an existing waiter to owner via UPDATE — has no assertion. Assertion 13 covers only the INSERT path, and `profiles_update_owner`'s WITH CHECK does not constrain `role`, so this trigger branch is the *sole* guard against a second owner on the UPDATE path and it ships untested. (b) The cross-tenant attempt (`:410`) and the second-owner attempt (`:419`) reuse the same email `denied@test.local` under `exception when others`, so the second block would still "pass" if it failed on the unique index (23505) rather than on the `role <> 'owner'` term it claims to test.
- **Fix**: Add the owner-promotes-waiter UPDATE assertion, narrow both denial blocks to assert `SQLSTATE = '42501'`, and give each attempt a distinct email.
- **Decision**: FIXED — new assertion 13b covers the UPDATE promotion path; both denial blocks in assertion 13 now assert `SQLSTATE = '42501'` and use distinct emails (`crosstenant@`, `secondowner@`). Suite passes.

### F10 — Temp-password field lets the browser save staff credentials against the owner's login

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/staff/StaffDialog.tsx:121-130
- **Detail**: The temporary-password input has no `autoComplete="new-password"` (and the email field no `autoComplete="off"`), so a password manager will offer to save the staff member's temporary password against the *owner's* saved OrderLY credentials — and may later autofill it into the owner's own sign-in.
- **Fix**: Add `autoComplete="new-password"` to the password input and `autoComplete="off"` to the email input.
- **Decision**: FIXED — both attributes added in `StaffDialog`.

## Minor notes (not tracked as findings)

- `astro.config.mjs:26-28` still says the service-role key is used "ONLY ... to mint menu-photo signed upload URLs" — it now also creates and deletes `auth.users` rows.
- `callStaffApi` omits the `signal?` parameter that `useMenu.ts:11-22` has; no functional impact today (no polling here).
- `GET /api/staff` sorts by `role, email`; the plan said `role` then `full_name`/`email`, so named rows sort by a hidden field.
- `guard_profile_self_change` is SECURITY INVOKER where the plan said SECURITY DEFINER. The implemented choice is safer and is commented; recorded as a deliberate deviation.
- `.overrideTypes<T, { merge: false }>()` is a new idiom in this repo (existing code uses `.single<T>()`); S-05/S-06 will likely copy it.
- `setStaff` is returned from `useStaff` but never consumed — there is no optimistic path here, unlike `MenuManager`'s reorder.
