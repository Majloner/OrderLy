import { test, expect } from "@playwright/test";

// Provenance: test-plan.md §2 risk #1 (High×High) — "an authenticated user of
// company A reads or modifies company B's rows". The integration suite proves
// the API layer on a synthetic context; this spec proves the full chain in a
// real browser: session B → real server → RLS → rendered menu. Modeled on
// tests/e2e/seed.spec.ts. Owner B's storageState comes from auth.setup.ts.

test("menu category created by company A is invisible to company B's owner (test-plan risk #1: tenant isolation)", async ({
  page,
  browser,
}) => {
  const categoryName = `E2E Izolacja ${Date.now()}`;

  // Company A (the project-level storageState): create a uniquely named category.
  // The manager is a React island that fetches /api/menu on mount — waiting for
  // that response is the state-based signal it is hydrated and interactive.
  const menuLoadedA = page.waitForResponse((response) => response.url().includes("/api/menu") && response.ok());
  await page.goto("/menu");
  await menuLoadedA;
  await page.getByRole("button", { name: "Dodaj kategorię" }).click();
  await page.getByRole("textbox", { name: "Nazwa kategorii" }).fill(categoryName);
  await page.getByRole("button", { name: "Zapisz" }).click();
  await expect(page.getByRole("heading", { name: categoryName })).toBeVisible();

  // Company B: a separate authenticated context, same app, other tenant.
  const contextB = await browser.newContext({ storageState: "playwright/.auth/owner-b.json" });
  try {
    const pageB = await contextB.newPage();
    // Wait for B's menu payload to actually land before asserting absence — an
    // island that hasn't fetched yet would also "not show" A's category and let
    // a naive absence check pass for the wrong reason.
    const menuLoaded = pageB.waitForResponse((response) => response.url().includes("/api/menu") && response.ok());
    await pageB.goto("/menu");
    await menuLoaded;

    // Positive control: B's menu manager rendered (an error page would also
    // hide A's data). Then the risk-tied assertion: A's row never crosses the
    // tenant boundary into B's rendered menu.
    await expect(pageB.getByRole("button", { name: "Dodaj kategorię" })).toBeVisible();
    await expect(pageB.getByRole("heading", { name: categoryName })).toBeHidden();
  } finally {
    await contextB.close();
  }

  // Cleanup — company A removes what it created, so the suite stays re-runnable.
  await page.getByRole("button", { name: `Usuń kategorię ${categoryName}` }).click();
  await page.getByRole("button", { name: "Usuń" }).click();
  await expect(page.getByRole("heading", { name: categoryName })).toBeHidden();
});
