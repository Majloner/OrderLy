import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/settings", "/menu", "/room"];
// Menu management and the room layout are owner-only (PRD Access Control);
// waiter/kitchen land back on the dashboard. RLS enforces this on the data
// layer regardless.
const OWNER_ROUTES = ["/menu", "/room"];

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
        .select("company_id, role")
        .eq("user_id", user.id)
        .maybeSingle<{ company_id: string; role: "owner" | "waiter" | "kitchen" }>();
      if (profile) {
        context.locals.company_id = profile.company_id;
        context.locals.role = profile.role;
      }
    }
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
