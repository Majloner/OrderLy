import type { APIContext } from "astro";
import type { ZodType } from "zod";
import { createClient } from "@/lib/supabase";

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

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return { error: jsonError("Supabase nie jest skonfigurowany", 500) };
  }

  return { supabase, companyId: company_id };
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
