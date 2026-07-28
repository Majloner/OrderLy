import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

// Creating an auth.users row is inherently privileged — there is no
// authenticated path to it — so staff provisioning escalates to the
// service-role key here, mirroring src/lib/storage.ts. Two deliberate limits:
//
//  1. This module does NOT write the public.profiles row. That insert runs
//     through the caller's user-scoped client so profiles_insert_owner stays
//     the real enforcement boundary and the RLS suite can prove a waiter
//     cannot self-provision. Only the auth.users row needs the escalation.
//  2. `company_name` is never passed in metadata. The on_auth_user_created
//     trigger (handle_new_user) is gated on that key and would otherwise spawn
//     a stray company for every staff account — see the comment in
//     supabase/migrations/20260705232213_owner_registration_trigger.sql.
//
// The calling route authorizes first (owner guard) and derives company_id from
// locals, never from the request body.

function admin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type CreateStaffAuthUserResult = { userId: string } | { failure: "duplicate" | "failed" };

// Supabase reports a taken address as code `email_exists`; older builds only
// set the message, so match both rather than mapping a duplicate to a 500.
function isDuplicateEmail(error: { code?: string; message?: string }): boolean {
  if (error.code === "email_exists") {
    return true;
  }
  return /already (been )?registered|already exists/i.test(error.message ?? "");
}

// Creates the auth.users row for a staff account. email_confirm: true because
// there is no SMTP configured — the owner hands the password over directly, so
// the address is never verified by mail.
export async function createStaffAuthUser(input: {
  email: string;
  password: string;
  fullName: string | null;
}): Promise<CreateStaffAuthUserResult> {
  const client = admin();
  if (!client) {
    return { failure: "failed" };
  }

  // GoTrue's admin methods re-throw anything that is not an AuthError, so a
  // transport-level failure on Workers would reject the whole route and lose
  // the mapped Polish message. Catch it and fold it into the result union.
  try {
    const { data, error } = await client.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });

    if (error) {
      return { failure: isDuplicateEmail(error) ? "duplicate" : "failed" };
    }

    // data.user is non-null once error is ruled out (discriminated by the SDK).
    return { userId: data.user.id };
  } catch {
    return { failure: "failed" };
  }
}

// Compensating action for a failed profiles insert. The auth.users row is
// created first (profiles.user_id is FK'd to it), so without this an aborted
// provisioning leaves an orphan: a confirmed, password-bearing account with no
// profile — invisible to GET /api/staff and unreclaimable through any route,
// with its email permanently taken.
//
// Returns whether the cleanup succeeded so the caller can tell the owner the
// address is stuck rather than implying a clean failure. Never throws: it must
// not mask the original error that triggered the rollback.
export async function deleteStaffAuthUser(userId: string): Promise<boolean> {
  const client = admin();
  if (!client) {
    return false;
  }
  try {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) {
      // The orphaned id is the only route back to a stranded auth user; losing
      // it makes the address unreclaimable, so this log is load-bearing.
      // eslint-disable-next-line no-console
      console.error(`[staff] orphaned auth user ${userId}: cleanup failed`, error.message);
      return false;
    }
    return true;
  } catch (cleanupError) {
    // Same as above — the id must survive somewhere.
    // eslint-disable-next-line no-console
    console.error(`[staff] orphaned auth user ${userId}: cleanup threw`, cleanupError);
    return false;
  }
}
