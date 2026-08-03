import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { signUpInputSchema } from "@/lib/schemas/auth";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  // This endpoint is open and unauthenticated, so every field is validated —
  // most importantly the address, which must not fall inside the derived staff
  // namespace (impl-review F1). Without that check anyone could register
  // `<login>@<code>.staff.orderly.invalid` and permanently occupy a login in
  // another venue.
  const parsed = signUpInputSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
    company_name: form.get("company_name"),
    full_name: form.get("full_name"),
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Nieprawidłowe dane";
    return context.redirect(`/auth/signup?error=${encodeURIComponent(message)}`);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  // company_name/full_name land in raw_user_meta_data; the handle_new_user
  // trigger reads them to create the company + owner profile.
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { company_name: parsed.data.company_name, full_name: parsed.data.full_name } },
  });

  if (error) {
    // Never surface error.message — it would put raw GoTrue text into the query
    // string and onto the page (impl-review F8).
    const message = /already registered/i.test(error.message)
      ? "Ten e-mail jest już zarejestrowany."
      : "Nie udało się utworzyć konta. Spróbuj ponownie.";
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
