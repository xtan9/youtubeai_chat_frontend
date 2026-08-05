import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loadSmokeCreds, type SmokeCreds } from "./helpers";

// Defaults to local dev (`pnpm dev`); CI points this at the deployed app so
// these assertions exercise the real hosted Supabase Auth session boundary.
const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

async function login(page: Page, creds: SmokeCreds): Promise<void> {
  await page.goto(`${BASE_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
  await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function signOutLocally(page: Page): Promise<void> {
  const accountMenu = page.getByRole("button", { name: /user menu/i });
  await accountMenu.click();
  const signOut = page.getByRole("menuitem", { name: /^sign out$/i });
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 }),
    signOut.click(),
  ]);
  await expect(
    page
      .getByRole("button", { name: /sign in|log in/i })
      .or(page.getByRole("link", { name: /sign in|log in/i })),
  ).toBeVisible();
}

async function closeContext(context: BrowserContext | undefined): Promise<void> {
  if (context) await context.close();
}

test("remembered sessions survive a browser restart and local sign out stays browser-local", async ({
  browser,
}) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  let rememberedContext: BrowserContext | undefined;
  let restoredContext: BrowserContext | undefined;
  let concurrentContext: BrowserContext | undefined;

  try {
    // Sign in one browser profile, close it, and restore its persisted cookie
    // state in a fresh context. This is the deployed browser-restart seam.
    rememberedContext = await browser.newContext();
    const rememberedPage = await rememberedContext.newPage();
    await login(rememberedPage, creds);
    const storageState = await rememberedContext.storageState();
    await closeContext(rememberedContext);
    rememberedContext = undefined;

    restoredContext = await browser.newContext({ storageState });
    const restoredPage = await restoredContext.newPage();
    await restoredPage.goto(`${BASE_URL}/account`);
    await expect(restoredPage.getByRole("heading", { name: "Account" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(restoredPage.getByRole("button", { name: /user menu/i })).toBeVisible();

    // A separately authenticated browser context must remain independent.
    // The clock shim only advances this test page's view of time; Supabase
    // still performs each refresh against the real hosted Auth service.
    concurrentContext = await browser.newContext();
    await concurrentContext.addInitScript(() => {
      const realDateNow = Date.now.bind(Date);
      const readOffset = () => {
        const [, rawOffset = "0"] = window.name.match(/^youtubeai-auth-clock:(\d+)$/) ?? [];
        return Number(rawOffset);
      };
      if (!/^youtubeai-auth-clock:\d+$/.test(window.name)) {
        window.name = "youtubeai-auth-clock:0";
      }
      Date.now = () => realDateNow() + readOffset();
      (window as Window & { advanceAuthClock?: (milliseconds: number) => void }).advanceAuthClock =
        (milliseconds) => {
          window.name = `youtubeai-auth-clock:${readOffset() + milliseconds}`;
        };
    });
    const concurrentPage = await concurrentContext.newPage();
    await login(concurrentPage, creds);

    await signOutLocally(restoredPage);

    // The other context keeps its session and can force two normal refresh
    // cycles without another login or an OTP challenge.
    await concurrentPage.goto(`${BASE_URL}/`);
    await expect(concurrentPage.getByRole("button", { name: /user menu/i })).toBeVisible({
      timeout: 15_000,
    });
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await concurrentPage.evaluate(() => {
        const pageWindow = window as Window & {
          advanceAuthClock?: (milliseconds: number) => void;
        };
        pageWindow.advanceAuthClock?.(2 * 60 * 60 * 1000);
      });
      await concurrentPage.goto(`${BASE_URL}/`);
      await expect(concurrentPage.getByRole("button", { name: /user menu/i })).toBeVisible({
        timeout: 15_000,
      });
    }
  } finally {
    await closeContext(rememberedContext);
    await closeContext(restoredContext);
    await closeContext(concurrentContext);
  }
});
