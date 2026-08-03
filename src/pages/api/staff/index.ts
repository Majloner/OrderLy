import type { APIRoute } from "astro";
import {
  guardStaffRequest,
  isInsufficientPrivilege,
  isUniqueViolation,
  jsonData,
  jsonError,
  parseBody,
} from "@/lib/api";
import { staffCreateInputSchema } from "@/lib/schemas/staff";
import { createStaffAuthUser, deleteStaffAuthUser } from "@/lib/staff-admin";
import type { StaffMember } from "@/types";

export const prerender = false;

const COLUMNS = "user_id, company_id, login, email, full_name, role, deactivated_at, created_at";

export const GET: APIRoute = async (context) => {
  const guard = guardStaffRequest(context, { write: false });
  if ("error" in guard) {
    return guard.error;
  }

  // RLS-scoped to the caller's company; deactivated rows are included so the
  // UI can render and reactivate them.
  const { data, error } = await guard.supabase
    .from("profiles")
    .select(COLUMNS)
    .order("role")
    // Ordered by login, not email: email is now nullable, and the login is what
    // the owner dictates to staff, so it is the stable human handle here.
    .order("login")
    .overrideTypes<StaffMember[], { merge: false }>();

  if (error) {
    return jsonError("Nie udało się pobrać listy personelu", 500);
  }

  return jsonData(data);
};

// Two-step write. The auth.users row must exist before the profile (FK), so on
// a failed insert the auth user is deleted again — otherwise the address stays
// permanently taken with nothing to show for it.
export const POST: APIRoute = async (context) => {
  const guard = guardStaffRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const body = await parseBody(context, staffCreateInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // The venue code comes from the caller's OWN company, never the request body,
  // so an owner cannot provision into someone else's venue by forging a code.
  const { data: company, error: companyError } = await guard.supabase
    .from("companies")
    .select("code")
    .eq("id", guard.companyId)
    .maybeSingle<{ code: string }>();

  if (companyError || !company) {
    return jsonError("Nie udało się odczytać kodu lokalu", 500);
  }

  // The auth address is derived from (venue code, login) — see
  // src/lib/staff-identity.ts. A duplicate therefore means this login is taken
  // in THIS venue, which is why the message can finally be specific: the old
  // vague wording existed only because email was globally unique.
  const created = await createStaffAuthUser({
    venueCode: company.code,
    login: body.input.login,
    password: body.input.password,
    fullName: body.input.full_name,
  });
  if ("failure" in created) {
    if (created.failure === "duplicate") {
      return jsonError("Ten login jest już zajęty w Twoim lokalu", 409);
    }
    return jsonError("Nie udało się utworzyć konta pracownika", 500);
  }

  // company_id comes from locals, never the body. profiles_insert_owner also
  // rejects role = 'owner', so the assignable-roles enum is belt and braces.
  const { data, error } = await guard.supabase
    .from("profiles")
    .insert({
      user_id: created.userId,
      company_id: guard.companyId,
      login: body.input.login,
      email: body.input.email,
      full_name: body.input.full_name,
      role: body.input.role,
    })
    .select(COLUMNS)
    .single<StaffMember>();

  if (error) {
    // Roll back the auth user before reporting, so a failed provisioning does
    // not leave the address permanently taken. If the rollback itself fails,
    // say so — the owner otherwise sees a plain error and cannot understand
    // why retrying the same address now returns 409.
    const rolledBack = await deleteStaffAuthUser(created.userId);
    if (!rolledBack) {
      return jsonError(
        "Nie udało się utworzyć konta, a login pozostał zajęty. Użyj innego loginu lub skontaktuj się z pomocą.",
        500,
      );
    }
    if (isInsufficientPrivilege(error)) {
      return jsonError("Tylko właściciel może tworzyć konta personelu", 403);
    }
    // 23505 here is profiles_company_login_idx — the auth user was created but
    // the profile collided, which means the login is taken in this venue.
    if (isUniqueViolation(error)) {
      return jsonError("Ten login jest już zajęty w Twoim lokalu", 409);
    }
    return jsonError("Nie udało się utworzyć konta pracownika", 500);
  }

  return jsonData(data, 201);
};
