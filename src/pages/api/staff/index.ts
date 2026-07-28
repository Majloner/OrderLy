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

const COLUMNS = "user_id, company_id, email, full_name, role, deactivated_at, created_at";

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
    .order("email")
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

  // NOTE: auth.users.email is unique across the WHOLE Supabase project
  // (auth.users_email_partial_key), not per company, and the check below runs
  // before any tenant scoping. The 409 is therefore deliberately vague — a
  // message naming "a staff member in this company" would both be false and
  // let an owner probe whether an address is registered with another tenant.
  // Consequences worth knowing: one person cannot work at two venues, and a
  // departed employee's address can never be re-provisioned. Replacing email
  // with a per-company login is planned as a separate change.
  const created = await createStaffAuthUser({
    email: body.input.email,
    password: body.input.password,
    fullName: body.input.full_name,
  });
  if ("failure" in created) {
    if (created.failure === "duplicate") {
      return jsonError("Tego adresu e-mail nie można użyć", 409);
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
        "Nie udało się utworzyć konta, a adres e-mail pozostał zajęty. Użyj innego adresu lub skontaktuj się z pomocą.",
        500,
      );
    }
    if (isInsufficientPrivilege(error)) {
      return jsonError("Tylko właściciel może tworzyć konta personelu", 403);
    }
    if (isUniqueViolation(error)) {
      return jsonError("Tego adresu e-mail nie można użyć", 409);
    }
    return jsonError("Nie udało się utworzyć konta pracownika", 500);
  }

  return jsonData(data, 201);
};
