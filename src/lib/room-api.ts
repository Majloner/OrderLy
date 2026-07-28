import type { APIContext } from "astro";
import { jsonError } from "@/lib/api";
import type { createClient } from "@/lib/supabase";

type SupabaseServerClient = NonNullable<ReturnType<typeof createClient>>;

interface RoomRequestContext {
  supabase: SupabaseServerClient;
  companyId: string;
}

// Route-level guard for /api/room/*. Mirrors guardMenuRequest (src/lib/api.ts)
// check for check and return shape for return shape — deliberately duplicated
// rather than factored into a shared helper, because the S-02 branch is editing
// src/lib/api.ts concurrently (context/changes/room-layout-tables/change.md).
// RLS is the real enforcement; this gives the UI fast, friendly JSON errors.
// Reads are for the whole staff, writes are owner-only (PRD Access Control).
export function guardTablesRequest(
  context: APIContext,
  options: { write: boolean },
): { error: Response } | RoomRequestContext {
  const { user, company_id, role } = context.locals;

  if (!user) {
    return { error: jsonError("Wymagane zalogowanie", 401) };
  }
  if (options.write && role !== "owner") {
    return { error: jsonError("Tylko właściciel może zmieniać schemat sali", 403) };
  }
  if (!company_id) {
    return { error: jsonError("Konto nie jest przypisane do żadnej firmy", 403) };
  }

  // Reuse the per-request client middleware already built (see src/middleware.ts).
  const supabase = context.locals.supabase;
  if (!supabase) {
    return { error: jsonError("Supabase nie jest skonfigurowany", 500) };
  }

  return { supabase, companyId: company_id };
}

// Confirm a room belongs to the caller's company before a table references it.
// The SELECT is RLS-scoped to current_company_id(), so another tenant's room
// reads as absent — FK validation alone runs below RLS and would let an owner
// place a table in a foreign company's room.
export async function roomExistsInCompany(supabase: SupabaseServerClient, roomId: string): Promise<boolean> {
  const { data } = await supabase.from("rooms").select("id").eq("id", roomId).maybeSingle();
  return data !== null;
}

// 23503 = FK violation. tables.room_id is ON DELETE RESTRICT, so deleting a room
// that still holds tables raises this instead of cascading the tables (and their
// permanent QR codes) away.
export function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === "23503";
}
