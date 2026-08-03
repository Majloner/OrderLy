import { z } from "zod";
import { MAX_STAFF_LOGIN_LENGTH, MIN_STAFF_LOGIN_LENGTH, STAFF_LOGIN_PATTERN } from "@/lib/staff-identity";
import { STAFF_ASSIGNABLE_ROLES } from "@/types";

// Minimum password length. Supabase's own floor is 6
// (supabase/config.toml [auth] minimum_password_length); we ask for more
// because the owner types this by hand and hands it over out-of-band — there is
// no email delivery and no reset flow in this slice.
export const MIN_STAFF_PASSWORD_LENGTH = 8;

export const staffCreateInputSchema = z.object({
  // The credential. Case is preserved as the owner typed it, but never
  // significant: the uniqueness index is on lower(login) and staffAuthEmail
  // lowercases, so KAdam and kadam are one account and both work at sign-in.
  // Immutable after creation — see src/lib/staff-identity.ts.
  login: z
    .string("Login jest wymagany")
    .trim()
    .min(MIN_STAFF_LOGIN_LENGTH, `Login musi mieć co najmniej ${MIN_STAFF_LOGIN_LENGTH} znaki`)
    .max(MAX_STAFF_LOGIN_LENGTH, `Login może mieć najwyżej ${MAX_STAFF_LOGIN_LENGTH} znaków`)
    .regex(STAFF_LOGIN_PATTERN, "Login może zawierać tylko litery, cyfry, kropkę, myślnik i podkreślnik"),
  // Optional contact data now, not a credential. May repeat across staff within
  // a venue, or be absent entirely. The preprocess folds an empty or
  // whitespace-only string to null so a blank form field means "no email"
  // rather than "malformed email". trim() runs BEFORE the format check — zod
  // evaluates the format first on a plain z.email() chain, so a pasted address
  // with a trailing space would be rejected rather than normalised.
  email: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z
      .string("Adres e-mail musi być tekstem")
      .trim()
      .toLowerCase()
      .max(255, "Adres e-mail może mieć najwyżej 255 znaków")
      .pipe(z.email("Nieprawidłowy adres e-mail"))
      .nullish()
      .transform((value) => value ?? null),
  ),
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
// full_name clears the name, while omitting the key preserves it.
//
// `login` is deliberately absent and must never be added: the auth address is
// derived from it (src/lib/staff-identity.ts), so changing it would strand the
// account behind an address nobody can compose. Password is likewise immutable.
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
  email: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z
        .string("Adres e-mail musi być tekstem")
        .trim()
        .toLowerCase()
        .max(255, "Adres e-mail może mieć najwyżej 255 znaków")
        .pipe(z.email("Nieprawidłowy adres e-mail"))
        .nullable(),
    )
    .optional(),
  role: z.enum(STAFF_ASSIGNABLE_ROLES, "Nieprawidłowa rola").optional(),
  active: z.boolean("Status konta musi być wartością logiczną").optional(),
});

export type StaffCreateInput = z.output<typeof staffCreateInputSchema>;
export type StaffUpdateInput = z.output<typeof staffUpdateInputSchema>;
