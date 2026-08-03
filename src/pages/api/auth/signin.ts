import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { staffAuthEmail } from "@/lib/staff-identity";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  // `email` carries whichever identity the form collected: a real address when
  // signing in as an owner, a login when a venue code is present.
  const identity = ((form.get("email") as string | null) ?? "").trim();
  const venueCode = ((form.get("venue_code") as string | null) ?? "").trim();
  const password = (form.get("password") as string | null) ?? "";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase nie jest skonfigurowany")}`);
  }

  // Staff addresses are DERIVED from (venue code, login) — see
  // src/lib/staff-identity.ts. Deliberately no database lookup: an unknown
  // venue code simply composes an address that does not exist, so it fails the
  // same way a wrong password does and cannot be used to discover which venue
  // codes are real. Those codes end up printed on QR stickers, so that matters.
  const authEmail = venueCode ? staffAuthEmail(venueCode, identity) : identity;

  const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });

  if (error) {
    // One message for all three failure modes, for the same reason. Only the
    // known Supabase error is mapped; anything else would otherwise leak
    // error.message into the query string and onto the page.
    const message = /invalid login credentials/i.test(error.message)
      ? "Nieprawidłowy kod lokalu, login lub hasło."
      : "Nie udało się zalogować. Spróbuj ponownie.";
    return context.redirect(`/auth/signin?error=${encodeURIComponent(message)}`);
  }

  return context.redirect("/");
};
