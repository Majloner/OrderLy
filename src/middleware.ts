import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/settings"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  context.locals.user = null;
  context.locals.company_id = null;
  context.locals.role = null;

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

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
