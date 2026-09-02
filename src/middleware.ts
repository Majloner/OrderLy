import { defineMiddleware } from "astro:middleware";
import { parseCookieHeader } from "@supabase/ssr";
import { jsonError } from "@/lib/api";
import { createClient } from "@/lib/supabase";
import type { StaffRole } from "@/types";

const PROTECTED_ROUTES = ["/dashboard", "/settings", "/menu", "/staff", "/room"];
// Menu management, staff provisioning, the room layout and the company profile
// are owner-only (PRD Access Control, FR-002); waiter/kitchen land back on the
// dashboard. RLS enforces this on the data layer regardless. Keep every owner
// route in PROTECTED_ROUTES too — one listed only here would bounce anonymous
// visitors to /dashboard instead of signin.
const OWNER_ROUTES = ["/menu", "/staff", "/room", "/settings"];

// Match a route exactly or as a path prefix (`/menu` matches `/menu` and
// `/menu/x`, but not `/menus` — that would silently gate a future public
// client-menu page).
function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.user = null;
  context.locals.company_id = null;
  context.locals.role = null;
  context.locals.display_name = null;
  context.locals.supabase = supabase;

  if (supabase) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    // getUser also "errors" for a plain anonymous or expired session (4xx) —
    // that is the normal anon path. Only a transport-level failure (status 0 or
    // missing: fetch got no response) or a GoTrue 5xx means the session state is
    // UNKNOWN; treating it as "anonymous" would bounce signed-in users to the
    // signin page and hand API clients a misleading 401/200.
    if (userError && (!userError.status || userError.status >= 500)) {
      // eslint-disable-next-line no-console
      console.error("[middleware] auth.getUser failed:", userError.message);
      if (context.url.pathname.startsWith("/api/")) {
        return jsonError("Błąd serwera. Spróbuj ponownie.", 500);
      }
      return new Response("Błąd serwera. Spróbuj ponownie.", { status: 500 });
    }
    context.locals.user = user ?? null;

    // Resolve tenant context for authenticated users only (anon skips the query).
    // The profiles row is readable under RLS (a user's own profile is in their
    // company). Missing profile (orphan user) leaves company_id/role null.
    if (user) {
      // Hoisted so the equivalent select("") mutant can be suppressed here —
      // inside the method chain the directive attaches to the wrong AST node.
      // Stryker disable next-line StringLiteral: select("") behaves like select("*"), an equivalent mutant no behavioral test can distinguish
      const profileColumns = "company_id, role, full_name, login";
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select(profileColumns)
        .eq("user_id", user.id)
        .maybeSingle<{ company_id: string; role: StaffRole; full_name: string | null; login: string | null }>();
      // A FAILED lookup is not "no profile". Swallowing this error let a
      // transient DB/PostgREST failure fall through to the deactivation branch
      // below, which signs the user out of EVERY session (GoTrue global revoke)
      // behind a misleading "account inactive" message. Infrastructure failure
      // must surface as a 5xx and leave the session alone.
      if (profileError) {
        // eslint-disable-next-line no-console
        console.error("[middleware] profiles lookup failed:", profileError.message);
        if (context.url.pathname.startsWith("/api/")) {
          return jsonError("Błąd serwera. Spróbuj ponownie.", 500);
        }
        return new Response("Błąd serwera. Spróbuj ponownie.", { status: 500 });
      }
      if (profile) {
        context.locals.company_id = profile.company_id;
        context.locals.role = profile.role;
        // Staff auth addresses are synthetic (…@code.staff.orderly.invalid), so
        // user.email must never be shown back to them. Prefer the real name,
        // then the login; the email fallback only ever applies to owners, whose
        // address is genuine.
        context.locals.display_name = profile.full_name ?? profile.login ?? user.email ?? null;
      }
    }
  }

  // Signed in but no profile resolved: either an orphan user or a deactivated
  // staff member — current_company_id()/current_staff_role() return NULL for
  // the latter, so the SELECT above finds nothing. Either way every query
  // default-denies, so end the session instead of rendering an empty shell
  // they could sit on until the cookie expires. Runs on EVERY route, not just
  // protected ones: sign-in lands on `/`, which is public, so a deactivated
  // session used to be able to sit there indefinitely. No redirect loop on
  // /auth/signin — the redirect carries the cookie-clearing headers, so the
  // follow-up request arrives anonymous and renders.
  if (context.locals.user && !context.locals.role && supabase) {
    const { error: signOutError } = await supabase.auth.signOut();
    // Stryker disable next-line ConditionalExpression: if(true) is observably equivalent (a successful signOut already clears the cookies); the if(false) regression is pinned by the GoTrue-outage test
    if (signOutError) {
      // On a non-auth error GoTrue keeps the local session, so the cookie
      // would survive and re-trigger this branch on the redirect target.
      // Drop the auth cookies ourselves; the server-side revocation can wait.
      for (const { name } of parseCookieHeader(context.request.headers.get("Cookie") ?? "")) {
        if (name.startsWith("sb-") && name.includes("-auth-token")) {
          context.cookies.delete(name, { path: "/" });
        }
      }
    }
    // API routes speak JSON: a 302 here would be followed by fetch clients
    // (redirect: "follow"), land on the signin page as HTML 200 and read as an
    // empty success. The session is dead either way; only the shape differs.
    if (context.url.pathname.startsWith("/api/")) {
      return jsonError("Konto jest nieaktywne", 401);
    }
    const params = new URLSearchParams({
      error: "Twoje konto jest nieaktywne. Skontaktuj się z właścicielem lokalu.",
    });
    return context.redirect(`/auth/signin?${params.toString()}`);
  }

  if (PROTECTED_ROUTES.some((route) => matchesRoute(context.url.pathname, route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (OWNER_ROUTES.some((route) => matchesRoute(context.url.pathname, route))) {
    if (context.locals.role !== "owner") {
      return context.redirect("/dashboard");
    }
  }

  return next();
});
