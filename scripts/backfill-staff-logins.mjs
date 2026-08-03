// One-off migration for staff accounts created BEFORE staff-login-identifiers.
//
// Those accounts authenticate with a real email address and have no login, so
// the new sign-in path (venue code + login) cannot reach them: it composes
// `<login>@<code>.staff.orderly.invalid`, which does not exist for them.
//
// This script does both halves of the migration:
//   1. derives and stores profiles.login from full_name
//   2. rewrites auth.users.email to the derived synthetic address
//
// Step 2 goes through the Admin API on purpose. The address also lives in
// auth.identities.identity_data, and updating auth.users directly with SQL
// leaves the two out of step, which breaks sign-in. Passwords are untouched.
//
// Usage (dry run first — it changes nothing and prints the plan):
//   node scripts/backfill-staff-logins.mjs
//   node scripts/backfill-staff-logins.mjs --apply
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .dev.vars.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

// --- env -------------------------------------------------------------------

function readDevVars() {
  const raw = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (match) {
      vars[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return vars;
}

const env = readDevVars();
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .dev.vars");
  process.exit(1);
}

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- derivation ------------------------------------------------------------

// `ł` and `Ł` are single codepoints (U+0142 / U+0141), NOT a base letter plus a
// combining mark, so NFD normalisation leaves them intact. Every other Polish
// diacritic does decompose. Mapping these two explicitly is what stops "Miłosz"
// from producing a login the validator rejects.
const HARD_MAP = { ł: "l", Ł: "L" };

function stripDiacritics(value) {
  return value
    .replace(/[łŁ]/g, (char) => HARD_MAP[char])
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function capitalise(value) {
  if (!value) {
    return "";
  }
  return value[0].toUpperCase() + value.slice(1);
}

// Rule: first letter of the given name (capitalised) + surname (diacritics
// stripped, capitalised). "Miłosz Świątek" -> "MSwiatek". With three or more
// parts, the first and the last are used; with one, that single part is used.
export function deriveLogin(fullName) {
  if (!fullName) {
    return null;
  }
  const parts = stripDiacritics(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return capitalise(parts[0]);
  }
  const initial = parts[0][0].toUpperCase();
  return `${initial}${capitalise(parts[parts.length - 1])}`;
}

// Must stay in step with src/lib/staff-identity.ts.
const STAFF_LOGIN_PATTERN = /^[A-Za-z0-9._-]+$/;
const MIN_LOGIN = 3;
const MAX_LOGIN = 32;

function staffAuthEmail(venueCode, login) {
  return `${login.trim().toLowerCase()}@${venueCode.trim().toLowerCase()}.staff.orderly.invalid`;
}

// --- run -------------------------------------------------------------------

const { data: rows, error } = await admin
  .from("profiles")
  .select("user_id, full_name, email, login, role, company_id, companies(code, name)")
  .neq("role", "owner")
  .is("login", null);

if (error) {
  console.error("Could not read profiles:", error.message);
  process.exit(1);
}

if (rows.length === 0) {
  console.log("Nothing to do — every non-owner profile already has a login.");
  process.exit(0);
}

// Collisions are per venue, case-insensitively, matching profiles_company_login_idx.
const { data: existing } = await admin.from("profiles").select("company_id, login").not("login", "is", null);
const taken = new Set((existing ?? []).map((row) => `${row.company_id}:${row.login.toLowerCase()}`));

const plan = [];
const problems = [];

for (const row of rows) {
  // PostgREST returns a to-one embed as an object, but normalise anyway: an
  // array here would silently produce addresses like `x@undefined.staff...`.
  const venue = Array.isArray(row.companies) ? row.companies[0] : row.companies;
  if (!venue?.code) {
    problems.push(`${row.user_id} ("${row.full_name}"): could not resolve the venue code`);
    continue;
  }

  const login = deriveLogin(row.full_name);

  if (!login) {
    problems.push(`${row.user_id} (${row.email ?? "no email"}): full_name is empty, cannot derive a login`);
    continue;
  }
  if (!STAFF_LOGIN_PATTERN.test(login) || login.length < MIN_LOGIN || login.length > MAX_LOGIN) {
    problems.push(`${row.user_id} ("${row.full_name}"): derived "${login}" fails validation`);
    continue;
  }
  const key = `${row.company_id}:${login.toLowerCase()}`;
  if (taken.has(key)) {
    problems.push(`${row.user_id} ("${row.full_name}"): derived "${login}" is already taken in ${venue.name}`);
    continue;
  }
  taken.add(key);
  plan.push({ ...row, login, authEmail: staffAuthEmail(venue.code, login), venueName: venue.name });
}

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — ${plan.length} account(s) to migrate\n`);
for (const item of plan) {
  console.log(`  ${item.venueName.padEnd(10)} "${item.full_name}"`);
  console.log(`    login   : ${item.login}`);
  console.log(`    auth    : ${item.email ?? "(none)"}  ->  ${item.authEmail}`);
  console.log(`    contact : ${item.email ?? "(none)"} (kept on the profile)`);
}

if (problems.length > 0) {
  console.log(`\nSkipped ${problems.length}:`);
  for (const problem of problems) {
    console.log(`  - ${problem}`);
  }
}

if (!APPLY) {
  console.log("\nNothing was changed. Re-run with --apply to perform the migration.\n");
  process.exit(0);
}

let migrated = 0;
for (const item of plan) {
  // profiles.login first: if it fails, the account is left exactly as it was
  // and still signs in with its old address.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ login: item.login })
    .eq("user_id", item.user_id);

  if (profileError) {
    console.error(`  FAILED ${item.login}: profiles update — ${profileError.message}`);
    continue;
  }

  const { error: authError } = await admin.auth.admin.updateUserById(item.user_id, { email: item.authEmail });

  if (authError) {
    // The login landed but the address did not, so the account can still sign
    // in the old way. Reverted so the two never disagree.
    await admin.from("profiles").update({ login: null }).eq("user_id", item.user_id);
    console.error(`  FAILED ${item.login}: auth update — ${authError.message} (login reverted)`);
    continue;
  }

  console.log(`  OK ${item.login} -> ${item.authEmail}`);
  migrated += 1;
}

console.log(`\nMigrated ${migrated}/${plan.length}.\n`);
