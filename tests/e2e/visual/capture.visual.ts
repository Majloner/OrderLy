import { test, expect, type Page } from "@playwright/test";

/**
 * Visual-review capture (test-plan §3 Phase 4) — NOT a test suite.
 *
 * Each "test" navigates one critical owner screen, waits for a seeded-content
 * signal (state-based, never waitForTimeout — see CLAUDE.md), and writes a
 * full-page screenshot for scripts/visual-review.mjs to judge against
 * tests/e2e/visual/rubrics/. The only assertions are the content signals: a
 * capture of a skeleton or an empty state would review the wrong thing.
 *
 * Determinism: content literals below must match scripts/seed-visual.mjs —
 * run `npm run seed:visual` first. Reduced motion is emulated so transitions
 * can't smear a mid-animation frame; fonts are awaited so a FOUT frame can't
 * be captured.
 */

const SCREENS_DIR = "visual-review/screens";

async function settle(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The Astro dev toolbar is dev-only chrome floating over real content — it
  // must not reach the reviewed screenshot (a VLM would flag it as overlap).
  await page.addStyleTag({ content: "astro-dev-toolbar{display:none !important}" });
  await page.evaluate(() => document.fonts.ready);
}

test("capture /dashboard", async ({ page }) => {
  await page.goto("/dashboard");
  // SSR page, no island: the heading and owner nav are the render signal.
  await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Schemat sali" })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SCREENS_DIR}/dashboard.png`, fullPage: true });
});

test("capture /menu", async ({ page }) => {
  // The menu manager island fetches /api/menu on mount — the response plus a
  // seeded item name is the hydrated-with-data signal.
  const menuLoaded = page.waitForResponse((response) => response.url().includes("/api/menu") && response.ok());
  await page.goto("/menu");
  await menuLoaded;
  await expect(page.getByRole("heading", { name: "Przystawki" })).toBeVisible();
  await expect(page.getByText("Pierogi ruskie")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SCREENS_DIR}/menu.png`, fullPage: true });
});

test("capture /room", async ({ page }) => {
  // The room layout island fetches /api/room on mount; the seeded room name
  // proves rooms rendered, the aria-labelled bar proves objects reached the canvas.
  const roomLoaded = page.waitForResponse((response) => response.url().includes("/api/room") && response.ok());
  await page.goto("/room");
  await roomLoaded;
  await expect(page.getByText("Sala główna").first()).toBeVisible();
  await expect(page.getByLabel("Bar").first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SCREENS_DIR}/room.png`, fullPage: true });
});
