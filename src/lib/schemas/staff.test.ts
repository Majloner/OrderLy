import { describe, expect, it } from "vitest";
import { MIN_STAFF_PASSWORD_LENGTH, staffCreateInputSchema, staffUpdateInputSchema } from "@/lib/schemas/staff";

const validCreate = {
  email: "kelner@lokal.pl",
  password: "tajne-haslo",
  full_name: "Anna Kowalska",
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

  it("lowercases the email", () => {
    const result = staffCreateInputSchema.parse({ ...validCreate, email: "Kelner@Lokal.PL" });
    expect(result.email).toBe("kelner@lokal.pl");
  });

  it("rejects a malformed email", () => {
    expect(staffCreateInputSchema.safeParse({ ...validCreate, email: "nie-email" }).success).toBe(false);
  });

  it("rejects a password shorter than the minimum", () => {
    const short = "x".repeat(MIN_STAFF_PASSWORD_LENGTH - 1);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, password: short }).success).toBe(false);
  });

  it("accepts a password at exactly the minimum length", () => {
    const exact = "x".repeat(MIN_STAFF_PASSWORD_LENGTH);
    expect(staffCreateInputSchema.safeParse({ ...validCreate, password: exact }).success).toBe(true);
  });

  it("trims the full name", () => {
    const result = staffCreateInputSchema.parse({ ...validCreate, full_name: "  Anna Kowalska  " });
    expect(result.full_name).toBe("Anna Kowalska");
  });

  it("normalizes a missing full name to null", () => {
    const { full_name: _fullName, ...rest } = validCreate;
    expect(staffCreateInputSchema.parse(rest).full_name).toBeNull();
  });

  it("normalizes a whitespace-only full name to null", () => {
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
    const result = staffUpdateInputSchema.parse({ ...validUpdate, active: true });
    expect(result.active).toBe(true);
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
});
