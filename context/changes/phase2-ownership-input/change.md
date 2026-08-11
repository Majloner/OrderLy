---
change_id: phase2-ownership-input
title: Ownership + input boundaries (test-plan Phase 2 — Risks #4/#5/#6)
status: preparing
created: 2026-08-11
updated: 2026-08-11
archived_at: null
---

## Notes

Rollout Phase 2 of context/foundation/test-plan.md: "Ownership + input boundaries".
Built on the Phase 1 integration harness (tests/integration/**) already on main.
Risks covered: #4 (IDOR on photo/Storage + cross-entity pointers), #5 (server
input-validation parity), #6 (staff self-privilege invariant).

Risk response intent (to verify in /10x-research against current code):
- #4: prove owner A cannot mint a signed upload URL / attach a photo / point a
  pointer (itemId/categoryId — and now room_objects room_id) at company B's
  resource. Client supplies the id; the SERVER builds the Storage object path
  from company_id. Ownership must be checked (RLS-scoped SELECT) BEFORE any
  service-role Storage op; a valid FK is not proof of ownership.
- #5: prove the server rejects out-of-contract input regardless of the UI —
  negative/huge price, empty/whitespace name, bad enum (role/availability/table
  shape/object kind), foreign MIME or oversized photo. The zod schema is the
  contract; assert the route returns 400, not that zod mirrors itself.
- #6: prove an owner cannot self-demote / self-deactivate, and no one can be
  promoted to `owner`; the profiles_guard_self_change trigger raises 42501 and
  the route must translate it to 403 with roles unchanged (assert the EFFECT,
  not the trigger's message text).

Test types: integration (owner A targets company-B resource; 3 roles), unit/contract
(schemas), extend supabase/tests/rls_isolation.sql where a DB-layer invariant is
cheapest. Mock only the Storage/service-role edge, never internal modules.

Note: main gained room_objects (#27) with its own routes + RLS; fold its
ownership/validation into #4/#5 where relevant.
