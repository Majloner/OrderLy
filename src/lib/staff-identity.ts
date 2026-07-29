// The single source of truth for how a staff member's Supabase auth address is
// composed. Provisioning (src/lib/staff-admin.ts) and sign-in
// (src/pages/api/auth/signin.ts) both call staffAuthEmail with the same two
// inputs, so the address is DERIVED rather than stored and the two sides cannot
// drift.
//
// Three properties follow from that, and all three are load-bearing:
//
//  1. Sign-in needs no database lookup. Venue code + login compose the address
//     directly, so authentication is one call to GoTrue.
//  2. A nonexistent venue code produces an address that does not exist, which
//     fails exactly like a wrong password. The non-enumerating error shape comes
//     for free rather than needing to be engineered.
//  3. The login must therefore be IMMUTABLE after creation — changing it would
//     make the derived address drift from the one the account was created
//     under. Email is already immutable here, so this matches the contract that
//     already exists rather than adding a new constraint.

// RFC 2606 reserves `.invalid` as a TLD guaranteed never to resolve. Using it
// means no mail can ever be attempted against these addresses and no real
// address can collide with a generated one.
const STAFF_EMAIL_DOMAIN_SUFFIX = "staff.orderly.invalid";

export const MIN_STAFF_LOGIN_LENGTH = 3;
export const MAX_STAFF_LOGIN_LENGTH = 32;

// Lowercase letters, digits, dot, hyphen, underscore. Deliberately excludes `@`
// and anything else that would make the composed value an invalid address —
// GoTrue still applies its own syntactic address validation.
export const STAFF_LOGIN_PATTERN = /^[a-z0-9._-]+$/;

export function isValidStaffLogin(login: string): boolean {
  if (login.length < MIN_STAFF_LOGIN_LENGTH || login.length > MAX_STAFF_LOGIN_LENGTH) {
    return false;
  }
  return STAFF_LOGIN_PATTERN.test(login);
}

// Both inputs are lowercased so that a login differing only in case resolves to
// the same account — matching the (company_id, lower(login)) index in
// 20260728150833_venue_code_and_staff_login.sql.
export function staffAuthEmail(venueCode: string, login: string): string {
  return `${login.trim().toLowerCase()}@${venueCode.trim().toLowerCase()}.${STAFF_EMAIL_DOMAIN_SUFFIX}`;
}
