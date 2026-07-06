import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  const companyName = ((form.get("company_name") as string) || "").trim();
  const fullName = ((form.get("full_name") as string) || "").trim();

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  if (!companyName) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Nazwa lokalu jest wymagana")}`);
  }

  // company_name/full_name land in raw_user_meta_data; the handle_new_user
  // trigger reads them to create the company + owner profile.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { company_name: companyName, full_name: fullName || null } },
  });

  if (error) {
    const message = /already registered/i.test(error.message) ? "Ten e-mail jest już zarejestrowany." : error.message;
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }

  // With email confirmations off, an existing/obfuscated email can return no
  // session and no error (Supabase enumeration-safe behaviour). Only proceed to
  // the dashboard when a real session was actually established.
  if (!data.session) {
    return context.redirect(
      `/auth/signup?error=${encodeURIComponent("Nie udało się utworzyć konta. Ten e-mail może być już zajęty.")}`,
    );
  }

  return context.redirect("/dashboard");
};
