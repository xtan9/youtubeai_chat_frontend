import path from "node:path";
import { defineConfig } from "@playwright/test";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the preview critical gate`);
  }
  return value;
}

const outputRoot = requireEnv("PREVIEW_PLAYWRIGHT_OUTPUT_DIR");
const storageStatePath = requireEnv("PREVIEW_STORAGE_STATE_PATH");

export default defineConfig({
  testDir: "./smoke-tests",
  testMatch: /preview-critical\.spec\.ts$/,
  globalSetup: "./smoke-tests/preview-auth.setup.ts",
  outputDir: path.join(outputRoot, "artifacts"),
  preserveOutput: "failures-only",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["junit", { outputFile: path.join(outputRoot, "results.xml") }],
  ],
  use: {
    baseURL: requireEnv("BASE_URL"),
    storageState: storageStatePath,
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
