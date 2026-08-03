import { describe, expect, it } from "vitest";
import { MIN_SIGNUP_PASSWORD_LENGTH, signUpInputSchema } from "@/lib/schemas/auth";
import { staffAuthEmail } from "@/lib/staff-identity";

const validSignUp = {
  email: "wlasciciel@lokal.pl",
  password: "haslo123",
  company_name: "Pizzeria Roma",
  full_name: "Anna Kowalska",
};

describe("signUpInputSchema", () => {
  it("accepts a normal owner registration", () => {
    expect(signUpInputSchema.safeParse(validSignUp).success).toBe(true);
  });

  it("lowercases and trims the email", () => {
    expect(signUpInputSchema.parse({ ...validSignUp, email: "  Wlasciciel@Lokal.PL  " }).email).toBe(
      "wlasciciel@lokal.pl",
    );
  });

  it("rejects a malformed email", () => {
    expect(signUpInputSchema.safeParse({ ...validSignUp, email: "nie-email" }).success).toBe(false);
  });

  it("requires a company name", () => {
    expect(signUpInputSchema.safeParse({ ...validSignUp, company_name: "   " }).success).toBe(false);
  });

  it("rejects a password shorter than the minimum", () => {
    const short = "x".repeat(MIN_SIGNUP_PASSWORD_LENGTH - 1);
    expect(signUpInputSchema.safeParse({ ...validSignUp, password: short }).success).toBe(false);
  });

  it("normalizes a missing full name to null", () => {
    const { full_name: _fullName, ...rest } = validSignUp;
    expect(signUpInputSchema.parse(rest).full_name).toBeNull();
  });

  // impl-review F1. Public signup must not be able to mint an address inside
  // the derived staff namespace — doing so would permanently occupy a login in
  // someone else's venue, with no way for that owner to reclaim it.
  describe("staff namespace squatting", () => {
    it("rejects an address derived for a real venue and login", () => {
      const squatted = staffAuthEmail("H42NAM", "anna");
      expect(signUpInputSchema.safeParse({ ...validSignUp, email: squatted }).success).toBe(false);
    });

    it("rejects the namespace regardless of case", () => {
      const result = signUpInputSchema.safeParse({
        ...validSignUp,
        email: "Anna@H42NAM.Staff.Orderly.INVALID",
      });
      expect(result.success).toBe(false);
    });

    it("rejects any venue code, not just known ones", () => {
      expect(signUpInputSchema.safeParse({ ...validSignUp, email: "x@zzzzzz.staff.orderly.invalid" }).success).toBe(
        false,
      );
    });

    it("still allows an unrelated address that merely mentions the word staff", () => {
      expect(signUpInputSchema.safeParse({ ...validSignUp, email: "staff@lokal.pl" }).success).toBe(true);
    });
  });
});
