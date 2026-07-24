import { chromium, type BrowserContext } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

type BrowserStorageState = Awaited<
  ReturnType<BrowserContext["storageState"]>
>;

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

function requireRunnerTemporaryStateDirectory(): string {
  const runnerTemp = resolve(requireEnv("RUNNER_TEMP"));
  const stateDirectory = resolve(requireEnv("PREVIEW_STORAGE_STATE_DIR"));
  const stateRelative = relative(runnerTemp, stateDirectory);
  if (
    !stateRelative ||
    stateRelative === ".." ||
    stateRelative.startsWith(`..${sep}`) ||
    isAbsolute(stateRelative)
  ) {
    throw new Error(
      `PREVIEW_STORAGE_STATE_DIR must be inside RUNNER_TEMP (${runnerTemp})`,
    );
  }
  return stateDirectory;
}

export function assertBypassOnlyState(
  state: BrowserStorageState,
  baseUrl: string,
) {
  if (state.origins.length !== 0) {
    throw new Error(
      "Bypass-only state must not contain application origin storage",
    );
  }

  if (state.cookies.length !== 1) {
    throw new Error(
      "Bypass-only state must contain exactly one cookie and no application auth cookies",
    );
  }

  const cookie = state.cookies[0];
  const previewHostname = new URL(baseUrl).hostname;
  const cookieDomain = cookie.domain.replace(/^\./, "");
  const appliesToPreview =
    previewHostname === cookieDomain ||
    previewHostname.endsWith(`.${cookieDomain}`);
  if (
    cookie.value.length === 0 ||
    !cookie.httpOnly ||
    !cookie.secure ||
    cookie.path !== "/" ||
    !appliesToPreview
  ) {
    throw new Error(
      "Bypass-only state cookie must be non-empty, secure, HTTP-only, root-scoped, and valid for the preview",
    );
  }
}

export default async function previewAuthenticationSetup() {
  const baseUrl = requirePreviewUrl();
  const stateDirectory = requireRunnerTemporaryStateDirectory();
  const publicStatePath = resolve(
    stateDirectory,
    "public-storage-state.json",
  );
  const authenticatedStatePath = resolve(
    stateDirectory,
    "authenticated-storage-state.json",
  );
  const bypassSecret = requireEnv("VERCEL_AUTOMATION_BYPASS_SECRET");
  const email = requireEnv("PREVIEW_TEST_USER_EMAIL");
  const password = requireEnv("PREVIEW_TEST_USER_PASSWORD");

  await rm(stateDirectory, { recursive: true, force: true });
  await mkdir(stateDirectory, { recursive: true });

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

    const publicState = await context.storageState();
    assertBypassOnlyState(publicState, baseUrl);

    const cookieOnlyResponse = await context.request.get("/");
    if (cookieOnlyResponse.status() !== 200) {
      throw new Error(
        `Preview protection cookie returned HTTP ${cookieOnlyResponse.status()}`,
      );
    }
    if (new URL(cookieOnlyResponse.url()).origin !== baseUrl) {
      throw new Error("Preview protection cookie left the deployed origin");
    }

    await context.storageState({ path: publicStatePath });

    const page = await context.newPage();
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^login$/i }).click();
    await page.getByRole("button", { name: /user menu/i }).waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await context.storageState({ path: authenticatedStatePath });
  } finally {
    await context.close();
    await browser.close();
  }
}
