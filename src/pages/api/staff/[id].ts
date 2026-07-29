import type { APIRoute } from "astro";
import { z } from "zod";
import { guardStaffRequest, isInsufficientPrivilege, jsonData, jsonError, parseBody } from "@/lib/api";
import { staffUpdateInputSchema } from "@/lib/schemas/staff";
import type { AssignableStaffRole, StaffMember } from "@/types";

export const prerender = false;

const idSchema = z.uuid();

const COLUMNS = "user_id, company_id, login, email, full_name, role, deactivated_at, created_at";

// Rename, role change, deactivate and reactivate in one call. No DELETE export:
// removal is the soft deactivated_at flag, so order attribution survives (S-09).
export const PUT: APIRoute = async (context) => {
  const guard = guardStaffRequest(context, { write: true });
  if ("error" in guard) {
    return guard.error;
  }

  const id = idSchema.safeParse(context.params.id);
  if (!id.success) {
    return jsonError("Nieprawidłowy identyfikator pracownika", 400);
  }

  const body = await parseBody(context, staffUpdateInputSchema);
  if ("error" in body) {
    return body.error;
  }

  // Self-edit is allowed for the display name only. Changing your own role or
  // deactivating yourself would leave the company with nobody who can write —
  // profiles_guard_self_change rejects both, and this reports the rule instead
  // of surfacing a bare 42501. Compared case-insensitively because z.uuid()
  // preserves the caller's casing while user.id is always lowercase.
  const isSelf = id.data.toLowerCase() === guard.userId.toLowerCase();
  if (isSelf && (body.input.role !== undefined || body.input.active !== undefined)) {
    return jsonError("Nie można zmienić roli ani dezaktywować własnego konta", 403);
  }

  // Build the patch from the keys actually sent. An absent key means "leave
  // unchanged", so a rename cannot resurrect a deactivated member (nor reset
  // the timestamp recording when access was revoked), and toggling activity
  // cannot revert a rename made from another tab.
  // `login` is absent from the update schema on purpose — the auth address is
  // derived from it, so changing it would strand the account.
  const patch: {
    full_name?: string | null;
    email?: string | null;
    role?: AssignableStaffRole;
    deactivated_at?: string | null;
  } = {};
  if (body.input.full_name !== undefined) {
    patch.full_name = body.input.full_name;
  }
  if (body.input.email !== undefined) {
    patch.email = body.input.email;
  }
  if (body.input.role !== undefined) {
    patch.role = body.input.role;
  }
  if (body.input.active !== undefined) {
    patch.deactivated_at = body.input.active ? null : new Date().toISOString();
  }
  if (Object.keys(patch).length === 0) {
    return jsonError("Brak zmian do zapisania", 400);
  }

  const { data, error } = await guard.supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", id.data)
    .select(COLUMNS)
    .overrideTypes<StaffMember[], { merge: false }>();

  if (error) {
    // 42501 from profiles_guard_self_change: self-demotion, self-deactivation,
    // or any promotion to owner. The self cases are caught above, so reaching
    // here means an attempt to grant the owner role.
    if (isInsufficientPrivilege(error)) {
      return jsonError("Nie można nadać roli właściciela ani zmienić własnej roli", 403);
    }
    return jsonError("Nie udało się zapisać zmian", 500);
  }
  // Zero rows means RLS filtered it out — another company's profile, or none.
  if (data.length === 0) {
    return jsonError("Nie znaleziono pracownika", 404);
  }

  return jsonData(data[0]);
};
