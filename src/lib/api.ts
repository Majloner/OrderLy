import type { APIContext } from "astro";
import type { ZodType } from "zod";
import type { createClient } from "@/lib/supabase";

type SupabaseServerClient = NonNullable<ReturnType<typeof createClient>>;

export function jsonData(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface MenuRequestContext {
  supabase: SupabaseServerClient;
  companyId: string;
}

// Route-level guard for /api/menu/*. RLS is the real enforcement; this gives
// the UI fast, friendly JSON errors. Reads are for the whole staff (S-05
// polling reuses GET /api/menu); writes are owner-only, with one S-05
// exception: `write: "availability"` also admits the waiter (the availability
// PATCH — the DB holds the change to that column via the
// menu_items_guard_staff_columns trigger). Kitchen has no menu write at all.
export function guardMenuRequest(
  context: APIContext,
  options: { write: boolean | "availability" },
): { error: Response } | MenuRequestContext {
  const { user, company_id, role } = context.locals;

  if (!user) {
    return { error: jsonError("Wymagane zalogowanie", 401) };
  }
  if (options.write === "availability" && role !== "owner" && role !== "waiter") {
    return { error: jsonError("Tylko właściciel i kelner mogą zmieniać dostępność pozycji", 403) };
  }
  if (options.write === true && role !== "owner") {
    return { error: jsonError("Tylko właściciel może modyfikować menu", 403) };
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

interface StaffRequestContext {
  supabase: SupabaseServerClient;
  companyId: string;
  userId: string;
}

// Route-level guard for /api/staff/*. A deliberate sibling of
// guardMenuRequest rather than a shared refactor — S-06 is in flight on this
// file (see context/changes/staff-accounts-roles/change.md).
//
// Unlike menu, reads are owner-only too: the staff roster is not something a
// waiter or the kitchen needs, so `write` only distinguishes the error copy.
// RLS remains the real enforcement (profiles_select_same_company +
// profiles_insert_owner/update_owner/delete_owner).
export function guardStaffRequest(
  context: APIContext,
  options: { write: boolean },
): { error: Response } | StaffRequestContext {
  const { user, company_id, role } = context.locals;

  if (!user) {
    return { error: jsonError("Wymagane zalogowanie", 401) };
  }
  if (role !== "owner") {
    return {
      error: jsonError(
        options.write ? "Tylko właściciel może zarządzać kontami personelu" : "Tylko właściciel widzi listę personelu",
        403,
      ),
    };
  }
  if (!company_id) {
    return { error: jsonError("Konto nie jest przypisane do żadnej firmy", 403) };
  }

  const supabase = context.locals.supabase;
  if (!supabase) {
    return { error: jsonError("Supabase nie jest skonfigurowany", 500) };
  }

  return { supabase, companyId: company_id, userId: user.id };
}

// Ownership checks return the parseBody-style union: `{ error }` carries a
// ready 500 when the lookup itself FAILED (transient DB error — not the same
// thing as "row absent"), `{ owned }` answers the actual question. Collapsing
// a failed lookup into `false` used to swallow the error and mislabel an infra
// failure as a 4xx ownership refusal.

// Confirm a category belongs to the caller's company before an item references
// it. The SELECT is RLS-scoped to current_company_id(), so a category from
// another tenant reads as absent — FK validation alone would bypass RLS and let
// an owner point an item at another company's category.
export async function categoryExistsInCompany(
  supabase: SupabaseServerClient,
  categoryId: string,
): Promise<{ error: Response } | { owned: boolean }> {
  const { data, error } = await supabase.from("menu_categories").select("id").eq("id", categoryId).maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[api] category ownership lookup failed:", error.message);
    return { error: jsonError("Błąd serwera. Spróbuj ponownie.", 500) };
  }
  return { owned: data !== null };
}

// Confirm a menu item belongs to the caller's company (RLS-scoped SELECT) before
// minting a photo upload URL — prevents orphan objects under the owner's prefix.
export async function itemExistsInCompany(
  supabase: SupabaseServerClient,
  itemId: string,
): Promise<{ error: Response } | { owned: boolean }> {
  const { data, error } = await supabase.from("menu_items").select("id").eq("id", itemId).maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error("[api] item ownership lookup failed:", error.message);
    return { error: jsonError("Błąd serwera. Spróbuj ponownie.", 500) };
  }
  return { owned: data !== null };
}

export async function parseBody<T>(
  context: APIContext,
  schema: ZodType<T>,
): Promise<{ error: Response } | { input: T }> {
  let raw: unknown;
  try {
    raw = await context.request.json();
  } catch {
    return { error: jsonError("Nieprawidłowe żądanie JSON", 400) };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: jsonError(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane", 400) };
  }

  return { input: parsed.data };
}

export function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// 42501 = insufficient_privilege, raised by the profiles_guard_self_change
// trigger on owner self-demotion / self-deactivation / promotion to owner.
// Distinguishing it lets the route answer 403 instead of a blanket 500.
export function isInsufficientPrivilege(error: { code?: string } | null): boolean {
  return error?.code === "42501";
}
