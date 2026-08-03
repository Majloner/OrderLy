import React, { useState } from "react";
import { Mail, Lock, LogIn, Store } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function SignInForm({ serverError }: Props) {
  const [venueCode, setVenueCode] = useState("");
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ venue_code?: string; identity?: string; password?: string }>({});

  // A venue code present means this is a staff sign-in and the identity field
  // holds a login, not an address — so the email format check must not run.
  // Empty code means the owner path, unchanged from before this feature.
  const isStaffSignIn = venueCode.trim().length > 0;

  function validate() {
    const next: typeof errors = {};
    if (!identity.trim()) {
      next.identity = isStaffSignIn ? "Login jest wymagany" : "E-mail jest wymagany";
    } else if (!isStaffSignIn && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) {
      next.identity = "Podaj poprawny adres e-mail";
    }
    if (!password) {
      next.password = "Hasło jest wymagane";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function clearError(field: keyof typeof errors) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/auth/signin" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="venue_code"
        label="Kod lokalu"
        value={venueCode}
        onChange={(v) => {
          setVenueCode(v);
          clearError("venue_code");
        }}
        placeholder="np. H42NAM"
        error={errors.venue_code}
        icon={<Store className="size-4" />}
        hint={<p className="mt-1 text-xs text-blue-100/50">Zostaw puste, jeśli jesteś właścicielem lokalu.</p>}
      />

      {/* One field, two meanings — the venue code decides which. The `id` also
          supplies the formData key via FormField, so it stays `email` for
          backwards compatibility with the endpoint's owner path. */}
      <FormField
        id="email"
        type={isStaffSignIn ? "text" : "email"}
        label={isStaffSignIn ? "Login" : "E-mail"}
        value={identity}
        onChange={(v) => {
          setIdentity(v);
          clearError("identity");
        }}
        placeholder={isStaffSignIn ? "np. anna" : "ty@przyklad.pl"}
        error={errors.identity}
        icon={isStaffSignIn ? <Store className="size-4" /> : <Mail className="size-4" />}
      />

      <FormField
        id="password"
        label="Hasło"
        type={showPassword ? "text" : "password"}
        value={password}
        onChange={(v) => {
          setPassword(v);
          clearError("password");
        }}
        placeholder="Twoje hasło"
        error={errors.password}
        icon={<Lock className="size-4" />}
        endContent={
          <PasswordToggle
            visible={showPassword}
            onToggle={() => {
              setShowPassword(!showPassword);
            }}
          />
        }
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Logowanie..." icon={<LogIn className="size-4" />}>
        Zaloguj się
      </SubmitButton>
    </form>
  );
}
