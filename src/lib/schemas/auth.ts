import { z } from "zod";
import { STAFF_EMAIL_DOMAIN_SUFFIX } from "@/lib/staff-identity";

// Owner self-registration. This endpoint is OPEN and unauthenticated, which is
// why it needs a schema at all: without one, anyone could register an address
// inside the derived staff namespace and permanently occupy a login belonging
// to someone else's venue (impl-review F1).
//
// Matches the client-side floor in SignUpForm and Supabase's own
// minimum_password_length = 6.
export const MIN_SIGNUP_PASSWORD_LENGTH = 6;

export const signUpInputSchema = z.object({
  email: z
    .string("Adres e-mail jest wymagany")
    .trim()
    .max(255, "Adres e-mail może mieć najwyżej 255 znaków")
    .toLowerCase()
    .pipe(z.email("Nieprawidłowy adres e-mail"))
    // Refusing the whole namespace, not just well-formed members of it: staff
    // addresses are minted server-side from (venue code, login) and must never
    // originate from a public form.
    .refine((value) => !value.endsWith(`.${STAFF_EMAIL_DOMAIN_SUFFIX}`), "Tego adresu e-mail nie można użyć"),
  password: z
    .string("Hasło jest wymagane")
    .min(MIN_SIGNUP_PASSWORD_LENGTH, `Hasło musi mieć co najmniej ${MIN_SIGNUP_PASSWORD_LENGTH} znaków`)
    .max(72, "Hasło może mieć najwyżej 72 znaki"),
  company_name: z
    .string("Nazwa lokalu jest wymagana")
    .trim()
    .min(1, "Nazwa lokalu jest wymagana")
    .max(120, "Nazwa lokalu może mieć najwyżej 120 znaków"),
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
});

export type SignUpInput = z.output<typeof signUpInputSchema>;
