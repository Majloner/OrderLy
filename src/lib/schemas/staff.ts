import { z } from "zod";
import { STAFF_ASSIGNABLE_ROLES } from "@/types";

// Minimum password length. Supabase's own floor is 6
// (supabase/config.toml [auth] minimum_password_length); we ask for more
// because the owner types this by hand and hands it over out-of-band — there is
// no email delivery and no reset flow in this slice.
export const MIN_STAFF_PASSWORD_LENGTH = 8;

export const staffCreateInputSchema = z.object({
  email: z
    .email("Nieprawidłowy adres e-mail")
    .trim()
    .max(255, "Adres e-mail może mieć najwyżej 255 znaków")
    .transform((value) => value.toLowerCase()),
  password: z
    .string("Hasło jest wymagane")
    .min(MIN_STAFF_PASSWORD_LENGTH, `Hasło musi mieć co najmniej ${MIN_STAFF_PASSWORD_LENGTH} znaków`)
    .max(72, "Hasło może mieć najwyżej 72 znaki"),
  full_name: z
    .string("Imię i nazwisko musi być tekstem")
    .trim()
    .max(120, "Imię i nazwisko może mieć najwyżej 120 znaków")
    .nullish()
    .transform((value) => {
      if (!value) {
        return null;
      }
      return value;
    }),
  role: z.enum(STAFF_ASSIGNABLE_ROLES, "Nieprawidłowa rola"),
});

// One PUT covers rename, role change, deactivate and reactivate. `active`
// maps to profiles.deactivated_at (true -> null, false -> now()). Email and
// password are immutable in this slice.
export const staffUpdateInputSchema = z.object({
  full_name: z
    .string("Imię i nazwisko musi być tekstem")
    .trim()
    .max(120, "Imię i nazwisko może mieć najwyżej 120 znaków")
    .nullish()
    .transform((value) => {
      if (!value) {
        return null;
      }
      return value;
    }),
  role: z.enum(STAFF_ASSIGNABLE_ROLES, "Nieprawidłowa rola"),
  active: z.boolean("Status konta musi być wartością logiczną"),
});

export type StaffCreateInput = z.output<typeof staffCreateInputSchema>;
export type StaffUpdateInput = z.output<typeof staffUpdateInputSchema>;
