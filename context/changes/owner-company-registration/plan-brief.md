# Owner Company Registration (S-01) — Plan Brief

> Full plan: `context/changes/owner-company-registration/plan.md`

## What & Why

Let a venue owner register a company, log in, and edit the venue profile (PRD FR-001/FR-002) — the
first user-visible slice on top of the F-01 multi-tenant foundation. Registration must create the
company + owner profile through a privileged path, because F-01's RLS grants no authenticated INSERT.

## Starting Point

F-01 shipped `companies`/`profiles` (+ RLS, roles) and middleware that resolves `company_id`/`role`.
The existing signup only does `auth.signUp` (no company/profile) and routes to a confirm-email page;
the form collects email+password only.

## Desired End State

Registering with email + password + venue name creates the auth user, company, and owner profile;
the owner is logged in and lands on `/dashboard` with tenant context resolved. An owner-only settings
page edits venue name/address/opening hours, persisted to `companies`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Company+profile creation | `handle_new_user` `SECURITY DEFINER` trigger from signup metadata | One-step, atomic, no `service_role` on the edge Worker | Plan |
| Trigger scope | Conditional on `company_name` metadata | S-02 staff signups (no `company_name`) won't spawn stray companies | Plan |
| Email confirmations | Off for MVP | One-step register → dashboard; no rate-limited mailer dependency | Plan |
| Registration fields | email, password, venue name (req) + owner name (opt) | Minimum to create company+profile; rest via profile edit | Plan |
| Post-register landing | `/dashboard` | Page already exists; zero new UI | Plan |
| Profile edit | Owner-only settings page: name/address/opening_hours | Direct FR-002; RLS `companies_update_owner` already supports it | Plan |
| Orphan (logged-in, no company) | Not handled in S-01 | Assume registration always creates the company | Plan |
| Validation | Dup email → clear error; venue name required, non-unique | Good error UX; venue names repeat across tenants (multi-tenant) | Plan |

## Scope

**In scope:** registration trigger; email-confirmation off; signup endpoint + form venue-name field; owner-only venue settings page + update endpoint; dashboard link.

**Out of scope:** staff accounts (S-02); menu/tables/QR/ordering (S-03+); orphan-user handling; email verification; `service_role` on the Worker.

## Architecture / Approach

Backend-first. A `SECURITY DEFINER` trigger on `auth.users` reads `company_name`/`full_name` from
`raw_user_meta_data` (set via `auth.signUp` `options.data`) and inserts the company + owner profile,
bypassing RLS. Confirmations off → signup returns a session → `/dashboard`. FR-002 edits go through
an owner-scoped endpoint updating `companies` (RLS-enforced).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend creation | trigger + email-confirmation off | trigger must be conditional (S-02) + confirmations must be off on hosted |
| 2. Registration flow | signup metadata + venue-name form field | signup errors (dup email) surfaced cleanly |
| 3. Venue profile settings | owner-only settings page + update endpoint | owner-only guard + RLS scoping |

**Prerequisites:** F-01 live (done); Supabase linked; ability to apply auth config to hosted (`config push`/dashboard).
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Email confirmations must be turned off on the **hosted** project, not just in local config — otherwise the one-step flow breaks.
- The trigger fires for every `auth.users` insert; correctness relies on the `company_name`-conditional (revisited in S-02).
- No orphan-user safety net (out of scope) — a failed trigger would leave a user without a company.

## Success Criteria (Summary)

- Registering with a venue name → logged in on `/dashboard`, company + owner profile created.
- Owner edits venue name/address/opening hours and they persist.
- Another company's owner cannot see or edit the first company's data (RLS holds).
