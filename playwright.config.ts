import { defineConfig } from "@playwright/test";

// Scoped to smoke-tests/ only — the project's unit tests run on vitest
// and this config must not pick them up. Keep testMatch tight.
export default defineConfig({
  testDir: "./smoke-tests",
  testMatch: /\.spec\.ts$/,
  // Upper bound on the whole file; e2e-summarize has its own 180s
  // in-test wait so a test may take ~200s including setup.
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Auto-start `pnpm dev` for specs that target local (e.g. e2e-seo-metadata).
  // Skipped when BASE_URL is set — the caller has already pointed at a
  // running env. Specs that hit prod via PROD_URL are unaffected either way.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
