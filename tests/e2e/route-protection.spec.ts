import { test, expect } from "@playwright/test";

// Provenance: test-plan.md §2 risk #3, the page-route half — "an unauthenticated
// visitor reaches a protected route". The integration suite (§6.7) proves the
// middleware in isolation by calling onRequest directly; this spec proves the
// REAL server runs that middleware for a real browser request. Modeled on
// tests/e2e/seed.spec.ts.

// This spec runs UNAUTHENTICATED: override the project-level storageState so the
// browser context starts with no session cookies at all.
test.use({ storageState: { cookies: [], origins: [] } });

test("anonymous visitor is redirected to sign-in from the owner-only menu page (test-plan risk #3: protected page routes)", async ({
  page,
}) => {
  // Attempt to open an owner-only, protected route without any session.
  await page.goto("/menu");

  // State-based signal, no waitForTimeout: the middleware must answer with a
  // redirect and the browser must land on the sign-in page — never on the menu
  // manager. If the middleware stops gating this route, the URL never changes
  // and this times out red.
  await page.waitForURL("/auth/signin");
  await expect(page.getByRole("button", { name: "Zaloguj się" })).toBeVisible();
});
