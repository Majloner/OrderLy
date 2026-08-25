import type { APIContext, MiddlewareNext } from "astro";
import { createContext } from "astro/middleware";
import { serializeCookieHeader, stringToBase64URL } from "@supabase/ssr";
import { onRequest } from "@/middleware";
import { anonClient } from "./clients";

// Drives src/middleware.ts `onRequest` directly — no HTTP server, no e2e.
// `astro:middleware` resolves via the alias in vitest.integration.config.ts;
// `createContext` is Astro's own public context builder, so cookies (real
// `Cookie` header parsing plus a working `.set()` for the sign-out branch) and
// `redirect()` (302 + Location) behave exactly as in production. Contrast with
// helpers/context.ts, which deliberately bypasses the middleware for /api/*.

export interface MiddlewareRun {
  response: Response;
  locals: App.Locals;
  nextCalled: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[integration] ${name} is not set (see .env.test.example)`);
  }
  return value;
}

// The @supabase/ssr server client stores its session under
// `sb-<first hostname label>-auth-token`. Derive the label from the same
// SUPABASE_URL the middleware's client reads instead of hardcoding `sb-127`.
export function sessionCookieName(): string {
  const host = new URL(requireEnv("SUPABASE_URL")).hostname;
  return `sb-${host.split(".")[0]}-auth-token`;
}

// Signs in with seeded credentials and serializes the session the way
// @supabase/ssr reads it back: "base64-" + base64url(JSON(session)). A single
// unchunked cookie is fine on the read path (chunking only matters on write).
export async function sessionCookieFor(credentials: { email: string; password: string }): Promise<string> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword(credentials);
  if (error) {
    throw new Error(`sessionCookieFor(${credentials.email}) failed: ${error.message}`);
  }
  const value = `base64-${stringToBase64URL(JSON.stringify(data.session))}`;
  return serializeCookieHeader(sessionCookieName(), value, {});
}

export async function runMiddleware(path: string, opts: { cookie?: string } = {}): Promise<MiddlewareRun> {
  const headers = new Headers();
  if (opts.cookie) {
    headers.set("Cookie", opts.cookie);
  }
  const request = new Request(`http://localhost${path}`, { headers });
  const context: APIContext = createContext({
    request,
    defaultLocale: "",
    // The middleware assigns every field itself; createContext just needs a
    // value satisfying App.Locals (reassigning ctx.locals afterwards throws).
    locals: { user: null, company_id: null, role: null, display_name: null, supabase: null },
  });

  let nextCalled = false;
  const next: MiddlewareNext = () => {
    nextCalled = true;
    return Promise.resolve(new Response("next-called"));
  };

  const response = await onRequest(context, next);
  if (!(response instanceof Response)) {
    throw new Error("middleware returned no Response");
  }
  return { response, locals: context.locals, nextCalled };
}
