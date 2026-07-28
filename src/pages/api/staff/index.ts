import type { APIRoute } from "astro";
import { guardStaffRequest, isUniqueViolation, jsonData, jsonError, parseBody } from "@/lib/api";
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

  const created = await createStaffAuthUser({
    email: body.input.email,
    password: body.input.password,
    fullName: body.input.full_name,
  });
  if ("failure" in created) {
    if (created.failure === "duplicate") {
      return jsonError("Pracownik z tym adresem e-mail już istnieje", 409);
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
    await deleteStaffAuthUser(created.userId);
    if (isUniqueViolation(error)) {
      return jsonError("Pracownik z tym adresem e-mail już istnieje", 409);
    }
    return jsonError("Nie udało się utworzyć konta pracownika", 500);
  }

  return jsonData(data, 201);
};
