import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Integration tests run against a local Supabase (`npx supabase start`) and need
// the local URL + keys in process.env BEFORE any helper imports. Astro's
// `astro:env/server` virtual module does not resolve under Vitest, so we bypass
// it entirely: load .env.test here and feed the three names straight into the
// worker env. See tests/integration/helpers/local-supabase.ts for the fail-fast
// guard the fixtures call before touching the database.
const env = loadEnv("test", process.cwd(), "");
const pick = (key: string): Record<string, string> => (env[key] ? { [key]: env[key] } : {});

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // App modules under test (e.g. src/lib/staff-admin.ts) import their secrets
      // from `astro:env/server`, which Vitest cannot resolve. Redirect it to a
      // stub that reads the same values from process.env so those modules import.
      "astro:env/server": fileURLToPath(new URL("./tests/integration/stubs/astro-env-server.ts", import.meta.url)),
      // src/middleware.ts imports `astro:middleware`, another virtual module.
      // Astro's own dev/build pipeline resolves it with exactly this alias
      // (astro/dist/core/create-vite.js), so we mirror it rather than stub it:
      // defineMiddleware is an identity function and the module is real.
      "astro:middleware": "astro/virtual-modules/middleware.js",
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    env: {
      ...pick("SUPABASE_URL"),
      ...pick("SUPABASE_KEY"),
      ...pick("SUPABASE_SERVICE_ROLE_KEY"),
    },
    // DB round-trips (auth admin, seeding) are slower than unit assertions.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Suites share one local database; serialize files so seed/cleanup of one
    // suite never races another.
    fileParallelism: false,
  },
});
