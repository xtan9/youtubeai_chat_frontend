import { chromium } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for preview authentication`);
  }
  return value;
}

function requirePreviewUrl(): string {
  const value = requireEnv("BASE_URL").replace(/\/$/, "");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".vercel.app")) {
    throw new Error(`Refusing non-Vercel preview URL: ${url.origin}`);
  }
  return url.origin;
}

function requireRunnerTemporaryState(): string {
  const runnerTemp = resolve(requireEnv("RUNNER_TEMP"));
  const statePath = resolve(requireEnv("PREVIEW_STORAGE_STATE_PATH"));
  const stateRelative = relative(runnerTemp, statePath);
  if (
    !stateRelative ||
    stateRelative === ".." ||
    stateRelative.startsWith(`..${sep}`) ||
    isAbsolute(stateRelative)
  ) {
    throw new Error(
      `PREVIEW_STORAGE_STATE_PATH must be inside RUNNER_TEMP (${runnerTemp})`,
    );
  }
  return statePath;
}

export default async function previewAuthenticationSetup() {
  const baseUrl = requirePreviewUrl();
  const storageStatePath = requireRunnerTemporaryState();
  const bypassSecret = requireEnv("VERCEL_AUTOMATION_BYPASS_SECRET");
  const email = requireEnv("PREVIEW_TEST_USER_EMAIL");
  const password = requireEnv("PREVIEW_TEST_USER_PASSWORD");

  await mkdir(dirname(storageStatePath), { recursive: true });
  await rm(storageStatePath, { force: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: baseUrl });

  try {
    const bypassResponse = await context.request.get("/", {
      headers: {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
    });
    if (bypassResponse.status() !== 200) {
      throw new Error(
        `Preview protection bypass returned HTTP ${bypassResponse.status()}`,
      );
    }
    if (new URL(bypassResponse.url()).origin !== baseUrl) {
      throw new Error("Preview protection bypass left the deployed origin");
    }

    const page = await context.newPage();
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.getByRole("button", { name: /user menu/i }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await context.storageState({ path: storageStatePath });
  } finally {
    await context.close();
    await browser.close();
  }
}
