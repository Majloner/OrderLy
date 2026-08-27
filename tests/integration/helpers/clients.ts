import { createClient } from "@supabase/supabase-js";

// Test-only Supabase client factory. Deliberately does NOT import
// src/lib/supabase.ts: that module reads `astro:env/server`, which is an
// unresolved virtual module under Vitest. The production client config is
// trivial (URL + key), so reproducing it here costs one line and keeps the
// harness decoupled from the Astro build pipeline. Env is injected by
// vitest.integration.config.ts and validated in setup.ts.

// The concrete client type these factories produce — shared so fixtures and the
// context builder annotate against the exact same generic instantiation.
export type TestClient = ReturnType<typeof createClient>;

const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

// setup.ts guarantees these are present at runtime, but TS still sees
// `string | undefined`; narrow via a throw rather than a `!`/`as` assertion
// (both are forbidden by the lint config).
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[integration] ${name} is not set (see .env.test.example)`);
  }
  return value;
}

// Anon (public) key client — no session. Used for anon-principal read attempts
// and as the base for sign-in.
export function anonClient(): TestClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_KEY"), AUTH_OPTS);
}

// Service-role client — bypasses RLS. Used ONLY to seed/clean fixtures and to
// verify effects in the DB (fetch company-B rows an authenticated A request
// must never touch). Never wired into a request under test.
export function serviceRoleClient(): TestClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), AUTH_OPTS);
}

// Returns an anon-key client carrying the given user's JWT — this is the client
// a synthetic request injects as `locals.supabase`, so current_company_id() /
// current_staff_role() resolve to that user at the RLS layer.
export async function signInAs(credentials: { email: string; password: string }): Promise<TestClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword(credentials);
  if (error) {
    throw new Error(`signInAs(${credentials.email}) failed: ${error.message}`);
  }
  return client;
}
