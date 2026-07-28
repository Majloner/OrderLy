---
change_id: staff-accounts-roles
title: Staff accounts and roles
status: impl_reviewed
created: 2026-07-23
updated: 2026-07-28
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap S-02 (`context/foundation/roadmap.md`), PRD: FR-003. Prereq S-01 (done).
- Owner creates/invites staff accounts and assigns roles (waiter/kitchen); no self-registration.
- Runs in parallel with S-06 (room-layout-tables) — disjoint domains (profiles/auth vs tables).
- Creating `auth.users` needs the service role (admin API); `SUPABASE_SERVICE_ROLE_KEY` is already
  configured (S-04) and `src/lib/storage.ts` shows the service-role client pattern.
- `staff_role` enum (owner/waiter/kitchen) already exists; `profiles` has `profiles_select_same_company`
  + `profiles_update_owner` — this change must add owner INSERT/DELETE policies.
- Parallel-work coordination: do NOT refactor `src/lib/api.ts`'s guard into a shared helper concurrently
  with S-06 — inline an own owner guard (e.g. guardStaffRequest) or agree the refactor up front.
- Shared append-only files (merge with S-06 branch): src/middleware.ts, src/pages/dashboard.astro,
  src/types.ts, supabase/tests/rls_isolation.sql.
- Known constraint (impl-review F4): `auth.users.email` is unique across the whole Supabase
  project (`auth.users_email_partial_key`, a unique index in the Supabase-managed `auth` schema),
  not per company — and the email IS the login identifier, since `signInWithPassword` resolves
  globally with no tenant parameter. So one person cannot hold accounts at two venues, and a
  departed employee's address can never be re-provisioned. `profiles_company_email_idx` is
  per-company but only guards the denormalized display copy. Replacing email with a per-company
  login requires a company code/slug at sign-in — planned as a separate change.
