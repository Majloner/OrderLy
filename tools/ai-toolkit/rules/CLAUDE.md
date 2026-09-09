# Team rules (OrderLY)

These rules are distributed by `@majloner/ai-toolkit` and encode the team's
hard requirements. They apply to every change in this repository.

- **Tenant isolation is non-negotiable.** Every table is scoped by `company_id`
  and protected by Postgres RLS with granular per-operation, per-role policies.
  Never write a query that can read or mutate rows across `company_id`; scope
  in application code even though RLS exists (defense in depth). Never grant
  `anon` policies without a `company_id` predicate — and if nothing consumes a
  public surface, do not grant it at all.
- **SSR is the default.** Every API route under `src/pages/api/` exports
  `const prerender = false`.
- **Auth runs in middleware.** Mutating routes gate on `locals.user`.
  Server-only secrets come from `astro:env/server` — never `import.meta.env`
  in client code, never in logs, responses, or bundles.
- **Validate every API input with zod** (body, params, query); malformed input
  returns 400. Error codes carry correct semantics: 401/403 auth, 404 only for
  genuinely missing resources, 500 for infrastructure failures — never a 4xx
  masking a server-side error.
- **Astro for static, React only for interactivity.** Hooks live in
  `src/components/hooks/`; no `"use client"`, no direct DOM manipulation.
  Merge Tailwind classes with `cn()` from `@/lib/utils`, never by string
  concatenation.
- **Changed business logic ships with a test.** Tests are independent (own
  setup/cleanup, unique ids) and never use `page.waitForTimeout()`.
