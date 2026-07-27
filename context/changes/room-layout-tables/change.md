---
change_id: room-layout-tables
title: Room layout and tables
status: implementing
created: 2026-07-23
updated: 2026-07-27
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap S-06 (`context/foundation/roadmap.md`), PRD: FR-008, FR-009, FR-010. Prereq S-01 (done).
- Owner designs the room in a visual editor, adds tables, activates/deactivates them, identifies by number.
- Runs in parallel with S-02 (staff-accounts-roles) — disjoint domains (tables vs profiles/auth).
- `tables` exists (F-01): `id, company_id, number, label, is_active, created_at` — extend with layout
  columns (e.g. pos_x/pos_y/shape) via ALTER; narrow `tables_staff_all` to owner-only writes (mirror the
  menu narrowing from S-03). `tables_anon_read_active` stays for the future client menu.
- `dnd-kit` is already installed (S-03) — reuse it for the drag-on-canvas editor.
- Guardrail: deactivate, never delete — the permanent per-table QR (S-07) must stay valid.
- Parallel-work coordination: do NOT refactor `src/lib/api.ts`'s guard into a shared helper concurrently
  with S-02 — inline an own owner guard (e.g. guardTablesRequest) or agree the refactor up front.
- Shared append-only files (merge with S-02 branch): src/middleware.ts, src/pages/dashboard.astro,
  src/types.ts, supabase/tests/rls_isolation.sql.
