import { z } from "zod";
import { STAFF_ASSIGNABLE_ROLES } from "@/types";

// Minimum password length. Supabase's own floor is 6
// (supabase/config.toml [auth] minimum_password_length); we ask for more
// because the owner types this by hand and hands it over out-of-band — there is
// no email delivery and no reset flow in this slice.
export const MIN_STAFF_PASSWORD_LENGTH = 8;

export const staffCreateInputSchema = z.object({
  // trim() must run BEFORE the format check — zod evaluates the format first
  // on a plain z.email() chain, so a pasted address with a trailing space would
  // be rejected rather than normalised. Lowercased to match the
  // (company_id, lower(email)) index.
  email: z
    .string("Adres e-mail jest wymagany")
    .trim()
    .max(255, "Adres e-mail może mieć najwyżej 255 znaków")
    .pipe(z.email("Nieprawidłowy adres e-mail"))
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

// One PUT covers rename, role change, deactivate and reactivate — but every
// field is OPTIONAL and an absent key means "leave unchanged". Making them
// required would force each caller to restate the whole row from its own
// (possibly stale) copy, so a rename issued from a tab that had not refetched
// would clobber a deactivation made elsewhere. `active` maps to
// profiles.deactivated_at (true -> null, false -> now()); an explicit null
// full_name clears the name, while omitting the key preserves it. Email and
// password are immutable in this slice.
export const staffUpdateInputSchema = z.object({
  full_name: z
    .string("Imię i nazwisko musi być tekstem")
    .trim()
    .max(120, "Imię i nazwisko może mieć najwyżej 120 znaków")
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      if (!value) {
        return null;
      }
      return value;
    }),
  role: z.enum(STAFF_ASSIGNABLE_ROLES, "Nieprawidłowa rola").optional(),
  active: z.boolean("Status konta musi być wartością logiczną").optional(),
});

export type StaffCreateInput = z.output<typeof staffCreateInputSchema>;
export type StaffUpdateInput = z.output<typeof staffUpdateInputSchema>;
