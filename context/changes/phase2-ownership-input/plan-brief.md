# Ownership + Input Boundaries (Phase 2) — Plan Brief

> Full plan: `context/changes/phase2-ownership-input/plan.md`
> Research: `context/changes/phase2-ownership-input/research.md`

## What & Why

Rollout Phase 2 of the test plan: pin the **ownership/IDOR (#4)**, **input-validation parity (#5)**, and **staff self-privilege (#6)** defenses at the **route layer**, on the Phase 1 harness. The defenses already work in code and are proven at the SQL layer; this phase proves the HTTP handlers wire guards + validation + error-translation correctly on top — and makes the one un-backstopped gap (`menu_items.category_id`) visible.

## Starting Point

The Phase 1 integration harness is on `main` (2-companies × roles fixtures, synthetic `APIContext`, `astro:env` stub). The Risk #3 authz matrix already covers all five `room_objects` routes; the SQL suite already proves Storage prefix scoping, staff invariants, and room_objects RLS/FK. There are no photo tests, no `objectId` fixture, and the `category_id` gap is only noted in KNOWN-GAPS.md.

## Desired End State

`npm run test:integration` + `npm run test:rls:local` deterministically prove: waiter/kitchen can't touch photo endpoints (403) and owner A can't reach company-B ids (404/400); the photo path handed to Storage is server-built `{companyId}/{itemId}`; every body route rejects a representative bad input (400) while clamp routes stay 200; staff self role/deactivate → 403 and `role:"owner"` → 400 with the DB effect unchanged; and the `category_id` DB gap is demonstrated + labeled.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Photo-test approach | **Mock `storage.ts` edge** (`vi.mock`) | IDOR logic runs before Storage; deterministic, no cleanup burden; brief says "mock only the Storage/service-role edge" | Plan |
| `category_id` gap | **Route test + labeled DB known-gap** in `rls_isolation.sql` | Highest-value gap; catches "someone removed the app check"; flips to assertion when a composite FK lands | Plan |
| #5 breadth | **Representative bad-input per route** | Proves `parseBody` wiring end-to-end without duplicating the schema unit tests | Plan |
| room_objects cross-tenant | **Representative** (POST foreign room_id, PUT/DELETE B object) | Objects mirror tables; 3-role authz already covered by Risk #3 | Plan |
| Storage / staff / room_objects RLS | **Not re-proven** | Already covered at the SQL layer | Research |

## Scope

**In scope:** `objectId` fixture + cleanup extension; photo-IDOR (mocked); cross-entity pointer IDOR (category/room); object cross-tenant; `category_id` DB known-gap; representative #5 400-matrix + clamp/empty-patch guardrails; #6 staff-invariant route tests; cookbook §6 note.

**Out of scope:** real Supabase Storage; fixing the `category_id` gap (no composite-FK migration); re-proving SQL RLS/trigger predicates; re-doing the room_objects 3-role authz matrix; full per-field #5 matrix.

## Architecture / Approach

New integration test files under `tests/integration/{isolation,validation}/`, all reusing `seedTwoCompanies`/`buildContext`/`serviceRoleClient` and the `cross-tenant-write.test.ts` pattern (drive handler as owner A vs a company-B id, assert status, re-read via service-role to prove no effect). Photo routes run with a hoisted `vi.mock("@/lib/storage")` whose spies capture the path. One SQL block extends `rls_isolation.sql` with the `category_id` known-gap.

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Fixture/harness | `objectId` + cleanup + Storage-mock pattern | cleanup missing room_objects/storage residue |
| 2. #4 IDOR | photo + cross-entity + object cross-tenant + category_id known-gap | asserting on mock spy correctly; gap block must be `notice` not `exception` |
| 3. #5 parity | representative 400-per-route + clamp/partial guardrails | mistaking clamp→200 for a gap |
| 4. #6 staff | self role/active→403, owner-role→400, rename→200 (+ DB effect) | conflating 403-self-guard vs 400-schema cases |
| 5. Cookbook | §6 note (mock pattern, objectId) | drift from what was built |

**Prerequisites:** Docker + `npx supabase start` + `.env.test` (JWT keys). CI (`ci.yml`, Phase 3) will run these on the PR.
**Estimated effort:** ~2 sessions across 5 phases (Phase 1 + 2 are the bulk).

## Open Risks & Assumptions

- Mocking Storage means the real service-role mint/remove path isn't exercised here (accepted — SQL proves prefix RLS; the token-delivery concern is already solved in code per lessons.md).
- The `category_id` known-gap is a deliberate non-failing spec until a composite-FK follow-up lands.
- DB-backed suites need a local Supabase; only lint/typecheck run without Docker.

## Success Criteria (Summary)

- Owner A / waiter / kitchen cannot reach another company's photo, item, category, room, or object through any route — proven by 403/404 + no DB/Storage effect.
- Every body route rejects out-of-contract input (400); clamp routes stay 200; staff empty-patch → 400.
- Staff self-privilege holds at the route (403/400) with roles unchanged in the DB; the `category_id` DB gap is visible and ready to close.
