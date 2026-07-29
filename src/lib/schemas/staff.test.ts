import { describe, expect, it } from "vitest";
import { MIN_STAFF_PASSWORD_LENGTH, staffCreateInputSchema, staffUpdateInputSchema } from "@/lib/schemas/staff";
import { MAX_STAFF_LOGIN_LENGTH, MIN_STAFF_LOGIN_LENGTH } from "@/lib/staff-identity";

const validCreate = {
  login: "anna",
  password: "tajne-haslo",
  full_name: "Anna Kowalska",
  email: "kelner@lokal.pl",
  role: "waiter",
};

describe("staffCreateInputSchema", () => {
  it("accepts a valid staff account", () => {
    expect(staffCreateInputSchema.safeParse(validCreate).success).toBe(true);
  });

  it("accepts the kitchen role", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, role: "kitchen" }).success).toBe(true);
  });

  it("rejects the owner role — owner is not assignable", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, role: "owner" }).success).toBe(false);
  });

  it("rejects an unknown role", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, role: "manager" }).success).toBe(false);
  });

  // --- login: the credential ---------------------------------------------
  it("requires a login", () => {
    const { login: _login, ...rest } = validCreate;
    expect(staffCreateInputSchema.safeParse(rest).success).toBe(false);
  });

  it("lowercases and trims the login", () => {
    const result = staffCreateInputSchema.parse({ ...validCreate, login: "  ANNA.Kowalska  " });
    expect(result.login).toBe("anna.kowalska");
  });

  it("accepts dots, hyphens and underscores", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, login: "anna_k-2.b" }).success).toBe(true);
  });

  it("rejects an at-sign, which would break the derived auth address", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, login: "anna@lokal.pl" }).success).toBe(false);
  });

  it("rejects spaces and other punctuation in the login", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, login: "anna kowalska" }).success).toBe(false);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, login: "anna+1" }).success).toBe(false);
  });

  it("enforces the login length bounds", () => {
    const short = "x".repeat(MIN_STAFF_LOGIN_LENGTH - 1);
    const long = "x".repeat(MAX_STAFF_LOGIN_LENGTH + 1);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, login: short }).success).toBe(false);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, login: long }).success).toBe(false);
    expect(
      staffCreateInputSchema.safeParse({ ...validCreate, login: "x".repeat(MAX_STAFF_LOGIN_LENGTH) }).success,
    ).toBe(true);
  });

  // --- email: optional contact data ---------------------------------------
  it("accepts a staff member with no email at all", () => {
    const { email: _email, ...rest } = validCreate;
    expect(staffCreateInputSchema.parse(rest).email).toBeNull();
  });

  it("folds an empty email field to null rather than rejecting it", () => {
    expect(staffCreateInputSchema.parse({ ...validCreate, email: "" }).email).toBeNull();
    expect(staffCreateInputSchema.parse({ ...validCreate, email: "   " }).email).toBeNull();
  });

  it("accepts an explicit null email", () => {
    expect(staffCreateInputSchema.parse({ ...validCreate, email: null }).email).toBeNull();
  });

  it("lowercases and trims a supplied email", () => {
    expect(staffCreateInputSchema.parse({ ...validCreate, email: "  Kelner@Lokal.PL  " }).email).toBe(
      "kelner@lokal.pl",
    );
  });

  it("still rejects a malformed email when one is supplied", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, email: "nie-email" }).success).toBe(false);
  });

  // --- password ------------------------------------------------------------
  it("rejects a password shorter than the minimum", () => {
    const short = "x".repeat(MIN_STAFF_PASSWORD_LENGTH - 1);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, password: short }).success).toBe(false);
  });

  it("accepts a password at exactly the minimum length", () => {
    const exact = "x".repeat(MIN_STAFF_PASSWORD_LENGTH);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, password: exact }).success).toBe(true);
  });

  // --- full name -----------------------------------------------------------
  it("trims the full name", () => {
    expect(staffCreateInputSchema.parse({ ...validCreate, full_name: "  Anna Kowalska  " }).full_name).toBe(
      "Anna Kowalska",
    );
  });

  it("normalizes a missing or whitespace-only full name to null", () => {
    const { full_name: _fullName, ...rest } = validCreate;
    expect(staffCreateInputSchema.parse(rest).full_name).toBeNull();
    expect(staffCreateInputSchema.parse({ ...validCreate, full_name: "   " }).full_name).toBeNull();
  });
});

describe("staffUpdateInputSchema", () => {
  const validUpdate = { full_name: "Anna Nowak", role: "kitchen", active: true };

  it("accepts a rename", () => {
    expect(staffUpdateInputSchema.safeParse(validUpdate).success).toBe(true);
  });

  it("accepts a deactivation", () => {
    expect(staffUpdateInputSchema.safeParse({ ...validUpdate, active: false }).success).toBe(true);
  });

  it("accepts a reactivation", () => {
    expect(staffUpdateInputSchema.parse({ ...validUpdate, active: true }).active).toBe(true);
  });

  it("rejects promoting to owner", () => {
    expect(staffUpdateInputSchema.safeParse({ ...validUpdate, role: "owner" }).success).toBe(false);
  });

  it("rejects a non-boolean active flag", () => {
    expect(staffUpdateInputSchema.safeParse({ ...validUpdate, active: "yes" }).success).toBe(false);
  });

  // Absent means "leave unchanged" — the route builds its patch from the keys
  // that are actually present, so a rename never touches deactivated_at.
  it("accepts a rename with no active flag and leaves it undefined", () => {
    const result = staffUpdateInputSchema.parse({ full_name: "Anna Nowak", role: "kitchen" });
    expect(result.active).toBeUndefined();
  });

  it("accepts an activity toggle on its own and leaves the other fields undefined", () => {
    const result = staffUpdateInputSchema.parse({ active: false });
    expect(result.active).toBe(false);
    expect(result.full_name).toBeUndefined();
    expect(result.role).toBeUndefined();
  });

  it("distinguishes an omitted full name from an explicit null", () => {
    expect(staffUpdateInputSchema.parse({ role: "waiter" }).full_name).toBeUndefined();
    expect(staffUpdateInputSchema.parse({ full_name: null }).full_name).toBeNull();
  });

  it("normalizes a whitespace-only full name to null", () => {
    expect(staffUpdateInputSchema.parse({ full_name: "   " }).full_name).toBeNull();
  });

  // --- email is editable, login is not -------------------------------------
  it("accepts changing the email", () => {
    expect(staffUpdateInputSchema.parse({ email: "  Nowy@Lokal.PL  " }).email).toBe("nowy@lokal.pl");
  });

  it("accepts clearing the email", () => {
    expect(staffUpdateInputSchema.parse({ email: null }).email).toBeNull();
    expect(staffUpdateInputSchema.parse({ email: "" }).email).toBeNull();
  });

  it("distinguishes an omitted email from an explicit null", () => {
    expect(staffUpdateInputSchema.parse({ role: "waiter" }).email).toBeUndefined();
  });

  // The auth address is derived from the login, so a changed login would strand
  // the account. The schema has no such key, and zod strips it — this guards
  // against someone adding it back by accident.
  it("never carries a login through to the patch", () => {
    const parsed = staffUpdateInputSchema.parse({ full_name: "Anna", login: "podmieniony" });
    expect(parsed).not.toHaveProperty("login");
  });
});
