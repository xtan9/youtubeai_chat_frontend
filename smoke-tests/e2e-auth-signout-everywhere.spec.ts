import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  authenticateAndAssertSmokeAccount,
  loadAdminCreds,
  type SmokeCreds,
} from "./helpers";

// The production workflow points BASE_URL at the deployed app. Keeping the
// local default makes the same spec useful against a locally running server.
const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

const AUTH_REFRESH_PATH = "/auth/v1/token";

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

async function expectSignedOut(page: Page): Promise<void> {
  await expect(
    page
      .getByRole("button", { name: /sign in|log in/i })
      .or(page.getByRole("link", { name: /sign in|log in/i }))
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

async function addExpiredSessionClock(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const realDateNow = Date.now.bind(Date);
    const readOffset = () => {
      const [, rawOffset = "0"] =
        window.name.match(/^youtubeai-auth-clock:(\d+)$/) ?? [];
      return Number(rawOffset);
    };

    if (!/^youtubeai-auth-clock:\d+$/.test(window.name)) {
      window.name = "youtubeai-auth-clock:0";
    }

    Date.now = () => realDateNow() + readOffset();
    (
      window as Window & {
        advanceAuthClock?: (milliseconds: number) => void;
      }
    ).advanceAuthClock = (milliseconds) => {
      window.name = `youtubeai-auth-clock:${readOffset() + milliseconds}`;
    };
  });
}

async function closeContext(context: BrowserContext | undefined): Promise<void> {
  if (context) await context.close();
}

test.describe("Sign Out Everywhere @account-mutating", () => {
  // This suite deliberately mutates Auth state. The production workflow runs
  // it as its final browser phase after all other authenticated smoke checks.
  test.describe.configure({ mode: "serial" });

  test("revokes another context on its next refresh and signs out the initiator", async ({
    browser,
  }) => {
    const creds = await loadAdminCreds();
    test.skip(
      !creds,
      "a dedicated Smoke Account plus SUPABASE_URL/SUPABASE_SECRET_KEY are required",
    );
    if (!creds) return;

    let initiatingContext: BrowserContext | undefined;
    let otherContext: BrowserContext | undefined;

    try {
      initiatingContext = await browser.newContext();
      otherContext = await browser.newContext();
      await addExpiredSessionClock(otherContext);

      const initiatingPage = await initiatingContext.newPage();
      const otherPage = await otherContext.newPage();
      await login(initiatingPage, creds);
      await login(otherPage, creds);

      await initiatingPage.goto(`${BASE_URL}/account`);
      await expect(
        initiatingPage.getByRole("heading", { name: "Account" }),
      ).toBeVisible();
      await expect(
        initiatingPage.getByRole("button", { name: /sign out everywhere/i }),
      ).toBeVisible();

      // A global revocation is a destructive Auth mutation. Verify the
      // service-managed Smoke Account marker immediately before invoking it;
      // a personal or unmarked credential must fail here before the button is
      // ever clicked.
      await authenticateAndAssertSmokeAccount(creds);

      const signOutEverywhere = initiatingPage.getByRole("button", {
        name: /^sign out everywhere$/i,
      });
      await Promise.all([
        initiatingPage.waitForURL(
          (url) => url.pathname === "/",
          { timeout: 15_000 },
        ),
        signOutEverywhere.click(),
      ]);
      await expectSignedOut(initiatingPage);

      await expect(
        otherPage.getByRole("button", { name: /user menu/i }),
      ).toBeVisible();
      await otherPage.evaluate(() => {
        const pageWindow = window as Window & {
          advanceAuthClock?: (milliseconds: number) => void;
        };
        pageWindow.advanceAuthClock?.(3 * 60 * 60 * 1000);
      });

      const refreshResponse = otherPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes(AUTH_REFRESH_PATH) &&
          response.url().includes("grant_type=refresh_token"),
        { timeout: 15_000 },
      );
      await otherPage.reload({ waitUntil: "domcontentloaded" });
      const response = await refreshResponse;
      expect(response.status()).toBeGreaterThanOrEqual(400);
      await expectSignedOut(otherPage);
    } finally {
      await closeContext(initiatingContext);
      await closeContext(otherContext);
    }
  });
});
