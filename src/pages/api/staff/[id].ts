import type { APIRoute } from "astro";
import { z } from "zod";
import { guardStaffRequest, isInsufficientPrivilege, jsonData, jsonError, parseBody } from "@/lib/api";
import { staffUpdateInputSchema } from "@/lib/schemas/staff";
import type { StaffMember } from "@/types";

export const prerender = false;

const idSchema = z.uuid();

const COLUMNS = "user_id, company_id, email, full_name, role, deactivated_at, created_at";

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

  // The owner cannot act on their own row here: the payload always carries a
  // role, and the only assignable roles are waiter/kitchen, so any such call is
  // a self-demotion. profiles_guard_self_change would reject it anyway — this
  // just answers with a message that explains why.
  if (id.data === guard.userId) {
    return jsonError("Nie można zmienić roli ani dezaktywować własnego konta", 403);
  }

  const body = await parseBody(context, staffUpdateInputSchema);
  if ("error" in body) {
    return body.error;
  }

  const { data, error } = await guard.supabase
    .from("profiles")
    .update({
      full_name: body.input.full_name,
      role: body.input.role,
      deactivated_at: body.input.active ? null : new Date().toISOString(),
    })
    .eq("user_id", id.data)
    .select(COLUMNS)
    .overrideTypes<StaffMember[], { merge: false }>();

  if (error) {
    if (isInsufficientPrivilege(error)) {
      return jsonError("Ta zmiana jest niedozwolona", 403);
    }
    return jsonError("Nie udało się zapisać zmian", 500);
  }
  // Zero rows means RLS filtered it out — another company's profile, or none.
  if (data.length === 0) {
    return jsonError("Nie znaleziono pracownika", 404);
  }

  return jsonData(data[0]);
};
