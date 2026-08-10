import type { APIContext } from "astro";
import type { Principal } from "./fixtures";

// Builds the minimal APIContext an /api/* handler actually reads: `request`,
// `locals` (user/company_id/role/display_name/supabase), and `params`. The
// route handlers under test derive tenant + role solely from `locals`, so a
// synthetic context exercises the real guard code and real RLS without an HTTP
// server or the middleware. Fields Astro injects but these handlers never touch
// are stubbed and cast away.

export interface RequestSpec {
  method: string;
  url?: string;
  body?: unknown;
  params?: Record<string, string | undefined>;
}

export function buildContext(principal: Principal, spec: RequestSpec): APIContext {
  const url = spec.url ?? "http://localhost/api/test";
  const hasBody = spec.body !== undefined;

  const request = new Request(url, {
    method: spec.method,
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(spec.body) : undefined,
  });

  // Not annotated App.Locals: the Cloudflare adapter augments Locals with a
  // runtime-only `cfContext` the handlers under test never read. The outer cast
  // carries this through.
  const locals = {
    user: principal.user,
    company_id: principal.company_id,
    role: principal.role,
    display_name: principal.display_name,
    // A user-scoped supabase-js client stands in for the SSR client middleware
    // would attach; both expose the same query surface the guards use.
    supabase: principal.client as App.Locals["supabase"],
  };

  return {
    request,
    locals,
    params: spec.params ?? {},
    url: new URL(url),
    cookies: {} as APIContext["cookies"],
    redirect: (path: string, status?: number) =>
      new Response(null, { status: status ?? 302, headers: { Location: path } }),
  } as unknown as APIContext;
}
