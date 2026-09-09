---
name: code-review
description: Review code changes against the team's five acceptance criteria (tenant isolation, auth & secrets, input validation, framework conventions, test coverage). Use when asked to "review code", "check this PR", "review my changes", or "code review".
---

# /code-review — Team Code Review

Review the provided code changes (a diff, a PR, or specific files) against the
team's five acceptance criteria. These criteria encode the OrderLY project's
internal requirements — they predate and outrank generic best practices.

## The five acceptance criteria

1. **tenant-isolation** — Every read/write is scoped by `company_id` from the
   authenticated session; new tables enable RLS with granular per-operation,
   per-role policies. RLS is defense in depth — application code must scope
   anyway. Never grant `anon` policies without a `company_id` predicate; when
   nothing consumes a public surface, do not grant it at all. Any possible
   cross-tenant read or mutation is an automatic critical finding.
2. **auth-and-secrets** — API routes under `src/pages/api/` export
   `const prerender = false` and gate mutations on `locals.user` (resolved by
   middleware). Server-only secrets come from `astro:env/server`, never
   `import.meta.env` in client code, and never appear in logs, responses, or
   client bundles.
3. **input-validation** — Every API input (body, params, query) is parsed with
   zod; malformed input returns 400. Error status codes carry correct
   semantics: 401/403 for auth, 404 only for genuinely missing resources, 500
   for infrastructure/lookup failures — never a 4xx that masks a server-side
   error, and never a swallowed error that returns success.
4. **framework-conventions** — Astro renders static content; React is only for
   interactivity (hooks extracted to `src/components/hooks/`, no
   `"use client"`, no direct DOM manipulation). Tailwind classes merged with
   `cn()` from `@/lib/utils`, never string concatenation. TypeScript strict —
   no `any`, no unsafe non-null assertions.
5. **test-coverage** — Changed business logic comes with a unit or integration
   test; tests are independent (own setup/cleanup, unique ids), never use
   `page.waitForTimeout()`, and the change does not weaken or delete existing
   assertions.

## Review rules

- Judge only what the change shows or clearly implies; do not speculate about
  unrelated code.
- No style nitpicks a linter would catch.
- Deliberately flawed fixtures and test data are not production findings —
  identify them as such and move on.

## Output format

Organize findings by severity, most severe first:

- **Critical** — security holes, cross-tenant access, data loss, broken auth.
- **Warning** — real defects or violations of the criteria above that won't
  page anyone tonight.
- **Suggestion** — improvements worth doing, not blocking.

Each finding includes a `file:line` reference when possible, one sentence on
what is wrong, and one sentence on what to do instead.

Finish with exactly one recommendation and a one-sentence justification:

- `APPROVE` — no critical or warning findings.
- `REQUEST CHANGES` — at least one critical finding, or warnings that must land
  before merge.
- `NEEDS DISCUSSION` — the change conflicts with a criterion in a way that may
  be intentional; a human decision is required.
