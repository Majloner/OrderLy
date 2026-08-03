import { describe, expect, it } from "vitest";
import {
  MAX_STAFF_LOGIN_LENGTH,
  MIN_STAFF_LOGIN_LENGTH,
  isValidStaffLogin,
  staffAuthEmail,
} from "@/lib/staff-identity";

describe("staffAuthEmail", () => {
  it("composes a syntactically valid address from venue code and login", () => {
    expect(staffAuthEmail("H42NAM", "anna")).toBe("anna@h42nam.staff.orderly.invalid");
  });

  // Determinism is what lets sign-in skip a database lookup entirely: the same
  // pair must always compose the same address, at provisioning and at sign-in.
  it("is deterministic for the same inputs", () => {
    expect(staffAuthEmail("H42NAM", "anna")).toBe(staffAuthEmail("H42NAM", "anna"));
  });

  it("is case-insensitive in both arguments", () => {
    const canonical = staffAuthEmail("h42nam", "anna");
    expect(staffAuthEmail("H42NAM", "ANNA")).toBe(canonical);
    expect(staffAuthEmail("H42nam", "Anna")).toBe(canonical);
  });

  it("ignores surrounding whitespace", () => {
    expect(staffAuthEmail("  H42NAM  ", "  anna  ")).toBe("anna@h42nam.staff.orderly.invalid");
  });

  it("gives different venues different addresses for the same login", () => {
    expect(staffAuthEmail("AAAAAA", "anna")).not.toBe(staffAuthEmail("BBBBBB", "anna"));
  });

  // RFC 2606 reserves .invalid so the address can never resolve and no real
  // address can collide with a generated one.
  it("always lands under the reserved .invalid TLD", () => {
    expect(staffAuthEmail("ZZZZZZ", "kuba").endsWith(".staff.orderly.invalid")).toBe(true);
  });
});

describe("isValidStaffLogin", () => {
  it("accepts lowercase letters, digits and the allowed separators", () => {
    expect(isValidStaffLogin("anna")).toBe(true);
    expect(isValidStaffLogin("anna.kowalska")).toBe(true);
    expect(isValidStaffLogin("anna-k")).toBe(true);
    expect(isValidStaffLogin("anna_k2")).toBe(true);
  });

  it("rejects an at-sign, which would break the composed address", () => {
    expect(isValidStaffLogin("anna@lokal")).toBe(false);
  });

  // Case is preserved for display but never significant — see staffAuthEmail's
  // case-insensitivity test above.
  it("accepts mixed case, so a login can be written KAdam", () => {
    expect(isValidStaffLogin("KAdam")).toBe(true);
    expect(isValidStaffLogin("MSwiatek")).toBe(true);
    expect(isValidStaffLogin("KWojtek2")).toBe(true);
  });

  it("rejects spaces and other punctuation", () => {
    expect(isValidStaffLogin("anna kowalska")).toBe(false);
    expect(isValidStaffLogin("anna+1")).toBe(false);
    expect(isValidStaffLogin("anna/k")).toBe(false);
    expect(isValidStaffLogin("Świątek")).toBe(false);
  });

  it("enforces the length bounds", () => {
    expect(isValidStaffLogin("x".repeat(MIN_STAFF_LOGIN_LENGTH - 1))).toBe(false);
    expect(isValidStaffLogin("x".repeat(MIN_STAFF_LOGIN_LENGTH))).toBe(true);
    expect(isValidStaffLogin("x".repeat(MAX_STAFF_LOGIN_LENGTH))).toBe(true);
    expect(isValidStaffLogin("x".repeat(MAX_STAFF_LOGIN_LENGTH + 1))).toBe(false);
  });

  it("rejects an empty login", () => {
    expect(isValidStaffLogin("")).toBe(false);
  });
});
