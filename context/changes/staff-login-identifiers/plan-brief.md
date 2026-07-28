# Per-Venue Staff Login — Plan Brief

> Full plan: `context/changes/staff-login-identifiers/plan.md`
> Frame brief: `context/changes/staff-login-identifiers/frame.md`

## What & Why

The email field does two jobs at once — it is the login credential, which
Supabase forces to be globally unique, and a per-venue contact attribute the
owner wants to be able to repeat. Those two roles have to be separated. Once
staff have their own identifier, the global constraint becomes irrelevant,
because the auth-layer address stops being something a human chooses.

## Starting Point

`auth.users.email` is globally unique via a Supabase-managed index that cannot
be scoped. `companies` has no human-readable identifier at all — just
`id, name, address, opening_hours, created_at`, and `name` is not even unique.
`/auth/signin` is the only sign-in path in the app: a native form POST whose
client-side validation rejects anything without an `@` before the request even
leaves the browser. Three real staff accounts exist on the hosted project,
created during S-02 testing, using real addresses as credentials.

## Desired End State

An owner sees their venue code on the **Pracownicy** page and gives a new waiter
two things: that code and a login. The waiter signs in with venue code, login
and password. Owners sign in exactly as before — email, venue code left empty.
Two staff at different venues may share a login, and an email may appear on
several staff records or on none. Nothing anywhere shows a staff member the
synthetic address behind their account.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| What the real problem is | Email does double duty as credential and contact attribute | Global uniqueness is a fixed Supabase property to route around, not fight. | Frame |
| Identity model | One login, one venue; `profiles` stays 1:1 | Reverses an earlier "one account, many venues" idea that contradicted the PRD Non-Goal. | Frame |
| Who owns the venue identifier | This change defines it; S-07 consumes it | S-07 is unstarted but owns FR-011, so the code is designed for QR permanence from the outset. | Plan |
| How the venue is indicated | A "kod lokalu" field on the existing `/auth/signin` | One form, one route, works from a printed note; no routing or hosting change. | Plan |
| Venue code form | Generated, short, immutable, unambiguous alphabet | Immutability satisfies FR-011 by construction — a printed QR code can never be invalidated. | Plan |
| Two account types | Venue code optional: empty means owner-by-email | Owners notice no change; one form and one endpoint. | Plan |
| Auth address | Derived from `(code, login)`, never stored or looked up | Sign-in needs no query, and a wrong code is indistinguishable from a wrong password — non-enumeration for free. | Plan |
| Existing staff accounts | Deleted and recreated by hand, not by migration | They are test data; a migration that deletes auth users is not a safe way to say that. | Plan |
| `profiles.email` | Kept, nullable, per-venue unique index dropped | Becomes optional contact data that may repeat, which is what was asked for. | Plan |
| Sign-in errors | One generic message for all three failure modes | Prevents probing which venue codes and logins exist — and they end up on QR stickers. | Plan |
| Staff list identity | Login is primary; sort by role then login | The login always exists, and it is what the owner dictates over the phone. | Plan |

## Scope

**In scope:** `companies.code` (generated, immutable, unique) with backfill;
`profiles.login` unique per venue; `email` nullable and no longer unique per
venue; a shared address-derivation function; provisioning by login; the venue
code field on sign-in and its server-side translation; login as the displayed
identity; the venue code shown to the owner; RLS and unit tests.

**Out of scope:** owner registration and owner sign-in; multi-membership and
venue switching; new routes or subdomains; owner-editable venue codes; changing
a login after creation; automated deletion of existing accounts; password
reset; rate limiting; QR code generation itself.

## Architecture / Approach

Schema → provisioning → sign-in, matching every prior slice.

The load-bearing idea: the synthetic auth address is **derived, not stored**.
Because the venue code is immutable and the login is unique within it,
`staffAuthEmail(code, login)` composes the same value at provisioning time and
at sign-in time. One shared pure function means the two sides cannot drift, and
sign-in performs no database lookup — a nonexistent venue code simply yields an
address that does not exist and fails identically to a wrong password.

The address uses the RFC 2606 `.invalid` TLD, which can never resolve, so no
mail is ever attempted and no real address can collide with a generated one.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Schema | Venue code + login columns, relaxed email constraint, trigger mints codes, RLS assertions | `handle_new_user()` must be replaced starting from the *current* body — replacing it from an older one is exactly the S-02 F1 regression that already happened once. |
| 2. Provisioning | Shared derivation function, login-based schemas, staff API and tests | First divergence between what the owner types and what Supabase stores; a drift between the two call sites would be silent. |
| 3. Sign-in & display | Venue code field, server translation, login as identity everywhere | Touches the only authentication path in the app. The client-side email regex breaks first and looks like a server fault. |

**Prerequisites:** S-02 merged (it is). Supabase CLI linked for `test:rls`.
Phases 1 and 2 are additive and cannot lock anyone out; only Phase 3 changes a
working login.

**Estimated effort:** ~3 sessions, one per phase, with a manual-verification
pause after each.

## Open Risks & Assumptions

- **Phase 3 is the risky one.** `/auth/signin` is the only way into the
  application. The client-side regex at `SignInForm.tsx:18-30` must change in
  the same commit as the server translation, or the failure looks server-side.
- The venue code is being designed for a slice that has not been planned. If
  S-07 later needs something this code cannot express, it changes a value that
  is immutable by design — the mitigation is that a random opaque code
  constrains S-07 as little as possible.
- The three existing staff accounts keep working through the owner path until
  they are deleted by hand. If that step is skipped, they linger as accounts
  with no login.
- `supabase config push` must never be run — it overwrites the entire remote
  auth configuration.
- Rate limiting is deliberately absent, so the sign-in endpoint can be probed;
  the generic error message is the only mitigation in this change.

## Success Criteria (Summary)

- A waiter signs in with a venue code and a login, and never sees the synthetic
  address behind their account.
- The same login works at two different venues, and an email may repeat or be
  absent entirely.
- An owner's sign-in is byte-for-byte the experience it was before.
