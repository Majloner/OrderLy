import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const { user, company_id, role } = context.locals;

  // Owner-only; RLS (companies_update_owner) is the real enforcement, this is a
  // fast guard + friendly redirect.
  if (!user || role !== "owner" || !company_id) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const name = ((form.get("name") as string) || "").trim();
  const address = ((form.get("address") as string) || "").trim();
  const openingHours = ((form.get("opening_hours") as string) || "").trim();

  if (!name) {
    return context.redirect(`/settings?error=${encodeURIComponent("Nazwa lokalu jest wymagana")}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/settings?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  const { error } = await supabase
    .from("companies")
    .update({ name, address: address || null, opening_hours: openingHours || null })
    .eq("id", company_id);

  if (error) {
    return context.redirect(`/settings?error=${encodeURIComponent(error.message)}`);
  }

  return context.redirect("/settings?success=1");
};
