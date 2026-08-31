import { test as setup, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Signs each E2E owner in ONCE through the real UI and saves the session cookies
// to its auth file. The browser projects in playwright.config.ts depend on this
// project and start every test already authenticated (storageState) — individual
// tests never log in through the UI (see e2e-quality-rules.md).
//
// Two tenants: owner A is the default storageState for the whole chromium
// project; owner B exists for cross-tenant specs (test-plan risk #1), which open
// a second context from playwright/.auth/owner-b.json.

interface OwnerAccount {
  email: string;
  password: string;
  companyName: string;
  authFile: string;
}

function owners(): OwnerAccount[] {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD are not set. " +
        "Copy .env.e2e.example to .env.e2e and point it at an owner account " +
        "in the Supabase project the dev server uses (.dev.vars).",
    );
  }
  return [
    {
      email,
      password,
      companyName: process.env.E2E_COMPANY_NAME ?? "E2E Lokal",
      authFile: "playwright/.auth/owner.json",
    },
    {
      email: process.env.E2E_OWNER_B_EMAIL ?? "e2e-owner-b@orderly.test",
      password,
      companyName: process.env.E2E_COMPANY_B_NAME ?? "E2E Lokal B",
      authFile: "playwright/.auth/owner-b.json",
    },
  ];
}

// Optional idempotent provisioning (E2E_PROVISION=1): create the owner through
// the GoTrue admin API before signing in. The handle_new_user trigger bootstraps
// the whole tenant from user_metadata.company_name — the same mechanism the
// integration fixtures use. "Already registered" is success.
async function provision(owner: OwnerAccount): Promise<void> {
  if (process.env.E2E_PROVISION !== "1") {
    return;
  }
  const url = process.env.E2E_SUPABASE_URL;
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("E2E_PROVISION=1 requires E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY in .env.e2e.");
  }
  const admin = createClient(url, serviceKey);
  const { error } = await admin.auth.admin.createUser({
    email: owner.email,
    password: owner.password,
    email_confirm: true,
    user_metadata: { company_name: owner.companyName },
  });
  if (error && !/already|exists/i.test(error.message)) {
    throw new Error(`Provisioning ${owner.email} failed: ${error.message}`);
  }
}

async function signInAndSave(page: Page, owner: OwnerAccount): Promise<void> {
  await page.goto("/auth/signin");
  // The form is a React island (client:load). Astro removes the `ssr` attribute
  // from <astro-island> when hydration finishes — fill before that and the DOM
  // values never reach React state, so the submit fires client validation on
  // empty fields. State-based wait, not a timeout.
  await page.locator("astro-island:not([ssr])").first().waitFor({ state: "attached" });
  // "Kod lokalu" stays empty — that is the owner path of the shared sign-in form.
  await page.getByLabel("E-mail").fill(owner.email);
  await page.getByLabel("Hasło").fill(owner.password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // State-based signal that the session landed: the signin endpoint redirects
  // to "/" and the topbar renders "Sign out" only for an authenticated user.
  // Asserting the signed-in STATE (not a URL) survives redirect-target changes.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.context().storageState({ path: owner.authFile });
}

setup("authenticate as owner A", async ({ page }) => {
  const [ownerA] = owners();
  await provision(ownerA);
  await signInAndSave(page, ownerA);
});

setup("authenticate as owner B", async ({ page }) => {
  const [, ownerB] = owners();
  await provision(ownerB);
  await signInAndSave(page, ownerB);
});
