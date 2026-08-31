import { defineConfig, devices } from "@playwright/test";

// E2E credentials live in .env.e2e (gitignored) — see .env.e2e.example.
// loadEnvFile never overrides variables already present in the environment,
// so CI can pass everything through env and skip the file entirely.
try {
  process.loadEnvFile(".env.e2e");
} catch {
  // .env.e2e is optional.
}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Signs the owner in once and saves the session to playwright/.auth/;
    // every browser project depends on it instead of logging in per test.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/owner.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
