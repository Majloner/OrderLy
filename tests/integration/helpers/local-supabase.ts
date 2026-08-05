// Fail-fast guard the fixtures call before touching the database. Kept OUT of a
// global vitest setupFile on purpose: DB-free suites (e.g. the registry
// completeness check) must run without a running Supabase or a .env.test, so the
// env/reachability requirement belongs to the code paths that actually seed.

const REQUIRED = ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

let verified = false;

export async function ensureLocalSupabase(): Promise<void> {
  if (verified) {
    return;
  }

  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `[integration] Missing env: ${missing.join(", ")}.\n` +
        `  1. npx supabase start\n` +
        `  2. cp .env.test.example .env.test\n` +
        `  3. paste the anon + service_role keys from: npx supabase status`,
    );
  }

  const healthUrl = `${process.env.SUPABASE_URL}/auth/v1/health`;
  try {
    const res = await fetch(healthUrl);
    if (!res.ok) {
      throw new Error(`health check returned ${res.status}`);
    }
  } catch (cause) {
    throw new Error(
      `[integration] Local Supabase not reachable at ${process.env.SUPABASE_URL} ` +
        `(${cause instanceof Error ? cause.message : String(cause)}). Run: npx supabase start`,
    );
  }

  verified = true;
}
