import { test as setup, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const AUTH_FILE = "playwright/.auth/owner.json";

// Signs the owner in ONCE through the real UI and saves the session cookies to
// AUTH_FILE. The browser projects in playwright.config.ts depend on this project
// and start every test already authenticated (storageState) — individual tests
// never log in through the UI (see e2e-quality-rules.md).
setup("authenticate as owner", async ({ page }) => {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD are not set. " +
        "Copy .env.e2e.example to .env.e2e and point it at an owner account " +
        "in the Supabase project the dev server uses (.dev.vars).",
    );
  }

  // Optional idempotent provisioning (E2E_PROVISION=1): create the owner through
  // the GoTrue admin API before signing in. The handle_new_user trigger
  // bootstraps the whole tenant from user_metadata.company_name — the same
  // mechanism the integration fixtures use. "Already registered" is success.
  if (process.env.E2E_PROVISION === "1") {
    const url = process.env.E2E_SUPABASE_URL;
    const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      throw new Error("E2E_PROVISION=1 requires E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY in .env.e2e.");
    }
    const admin = createClient(url, serviceKey);
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { company_name: process.env.E2E_COMPANY_NAME ?? "E2E Lokal" },
    });
    if (error && !/already|exists/i.test(error.message)) {
      throw new Error(`Provisioning the E2E owner failed: ${error.message}`);
    }
  }

  await page.goto("/auth/signin");
  // "Kod lokalu" stays empty — that is the owner path of the shared sign-in form.
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Hasło").fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // State-based signal that the session landed: the signin endpoint redirects
  // to "/" and the topbar renders "Sign out" only for an authenticated user.
  // Asserting the signed-in STATE (not a URL) survives redirect-target changes.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.context().storageState({ path: AUTH_FILE });
});
