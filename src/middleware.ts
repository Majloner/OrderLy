import { defineMiddleware } from "astro:middleware";
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
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;

    // Resolve tenant context for authenticated users only (anon skips the query).
    // The profiles row is readable under RLS (a user's own profile is in their
    // company). Missing profile (orphan user) leaves company_id/role null.
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id, role, full_name, login")
        .eq("user_id", user.id)
        .maybeSingle<{ company_id: string; role: StaffRole; full_name: string | null; login: string | null }>();
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
    await supabase.auth.signOut();
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
