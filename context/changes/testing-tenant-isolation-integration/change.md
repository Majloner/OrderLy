---
change_id: testing-tenant-isolation-integration
title: Integration harness + tenant isolation (test-plan Phase 1)
status: implementing
created: 2026-08-04
updated: 2026-08-05
archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Integration harness + tenant isolation".
Risks covered: #1 (cross-tenant read/write leak), #2 (anon read not scoped by company_id), #3 (request-layer authz bypass).
Test types planned: integration (API route tests under a local Supabase, 2 companies x roles), SQL RLS.
Risk response intent:
- #1: prove a request authenticated as company A never returns or mutates company B rows on any domain entity; the owner role does NOT lift the tenant boundary.
- #2: prove the anon key cannot read rows whose company_id differs from the table/session context; anon-read policies lacking a company_id predicate are the failure surface.
- #3: prove owner-only writes return 403 for waiter/kitchen and protected routes redirect anonymous; a 200 on the happy path does not imply authorization holds.
After creating the folder, follow the downstream continuation rule.
