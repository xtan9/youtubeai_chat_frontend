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
});
