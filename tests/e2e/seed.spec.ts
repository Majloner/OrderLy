import { test, expect } from "@playwright/test";

/**
 * Seed test — the exemplar every generated E2E test is modeled on.
 *
 * Conventions demonstrated here (see .claude/skills/10x-e2e/references/):
 * - getByRole / getByLabel as the default locators — never CSS/XPath.
 * - Wait for state (toBeVisible, toBeHidden, waitForURL) — never waitForTimeout.
 * - Unique test data (timestamp suffix) so parallel runs and re-runs don't collide.
 * - Full cycle in one test: setup → action → assertion → cleanup. No test depends
 *   on another test's leftovers.
 * - Test name bound to a risk from context/foundation/test-plan.md — the assertion
 *   must go red if that risk materializes.
 *
 * Auth: authenticated state comes from storageState (auth.setup.ts signs in the
 * owner once and saves playwright/.auth/owner.json; playwright.config.ts wires it
 * via `use.storageState` and a setup project dependency). Individual tests never
 * log in through the UI.
 */

// Risk source: test-plan.md §2 #3 — the owner is the only role allowed to perform
// menu writes, and the whole chain UI → POST /api/menu/categories → zod → RLS → DB
// must actually persist the row (a 200 with no surviving row would pass a shallow
// smoke test but fail the reload assertion below).
test("menu category created by the owner survives a page reload (test-plan risk #3: owner-only write chain)", async ({
  page,
}) => {
  // Unique per run — parallel workers and repeated runs never collide on the name.
  const categoryName = `E2E Kategoria ${Date.now()}`;

  // The menu manager is a React island that fetches /api/menu on mount —
  // waiting for that response is the state-based signal that the island is
  // hydrated and interactive (clicking earlier hits inert SSR markup).
  const menuLoaded = page.waitForResponse((response) => response.url().includes("/api/menu") && response.ok());
  await page.goto("/menu");
  await menuLoaded;

  // Create (role-based locators; the dialog is Radix, unmounted when closed).
  await page.getByRole("button", { name: "Dodaj kategorię" }).click();
  await page.getByRole("textbox", { name: "Nazwa kategorii" }).fill(categoryName);
  await page.getByRole("button", { name: "Zapisz" }).click();

  // Business outcome, not implementation detail: the category renders as a heading.
  // The web-first assertion waits for the state; no waitForTimeout anywhere.
  await expect(page.getByRole("heading", { name: categoryName })).toBeVisible();

  // The risk-tied half: the row must survive a full round trip to the DB.
  // An optimistic UI update alone must not be enough to keep this green.
  await page.reload();
  await expect(page.getByRole("heading", { name: categoryName })).toBeVisible();

  // Cleanup — the test removes what it created, so the suite stays re-runnable
  // against the same environment. Deletion goes through the real UI path
  // (confirm dialog), and we wait for the state change, not for time.
  await page.getByRole("button", { name: `Usuń kategorię ${categoryName}` }).click();
  await page.getByRole("button", { name: "Usuń" }).click();
  await expect(page.getByRole("heading", { name: categoryName })).toBeHidden();
});
