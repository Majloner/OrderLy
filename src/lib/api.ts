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
// polling will reuse GET /api/menu), writes are owner-only.
export function guardMenuRequest(
  context: APIContext,
  options: { write: boolean },
): { error: Response } | MenuRequestContext {
  const { user, company_id, role } = context.locals;

  if (!user) {
    return { error: jsonError("Wymagane zalogowanie", 401) };
  }
  if (options.write && role !== "owner") {
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

// Confirm a category belongs to the caller's company before an item references
// it. The SELECT is RLS-scoped to current_company_id(), so a category from
// another tenant reads as absent — FK validation alone would bypass RLS and let
// an owner point an item at another company's category.
export async function categoryExistsInCompany(supabase: SupabaseServerClient, categoryId: string): Promise<boolean> {
  const { data } = await supabase.from("menu_categories").select("id").eq("id", categoryId).maybeSingle();
  return data !== null;
}

// Confirm a menu item belongs to the caller's company before minting a photo
// upload URL / attaching a photo. RLS-scoped SELECT, so a foreign item reads as
// absent — prevents creating orphan objects under the owner's prefix.
export async function itemExistsInCompany(supabase: SupabaseServerClient, itemId: string): Promise<boolean> {
  const { data } = await supabase.from("menu_items").select("id").eq("id", itemId).maybeSingle();
  return data !== null;
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
