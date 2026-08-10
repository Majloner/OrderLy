// Vitest stub for Astro's `astro:env/server` virtual module, which does not
// resolve outside the Astro build pipeline. App modules under test import their
// secrets from it (e.g. src/lib/staff-admin.ts, src/lib/supabase.ts); the
// integration harness feeds the same values from process.env so those modules
// import cleanly. Values are read lazily by the app modules at request time, so
// `undefined` at import time is fine. Aliased in vitest.integration.config.ts.

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
