import base from "./vitest.integration.config";

// Stryker mutation runs: the integration setup (env injection, aliases,
// serialization) narrowed to the middleware suite only — mutants live in
// src/middleware.ts, so running the whole integration suite per mutant would
// buy no extra signal at ~5x the wall-clock. See test-plan.md (mutation gate
// is selective, not a per-commit CI gate).
export default {
  ...base,
  test: {
    ...base.test,
    include: ["tests/integration/authz/middleware.test.ts"],
  },
};
