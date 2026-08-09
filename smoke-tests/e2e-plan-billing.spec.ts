import { expect, test, type Page } from "@playwright/test";
import { loadSmokeCreds, type SmokeCreds } from "./helpers";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

async function login(page: Page, creds: SmokeCreds): Promise<void> {
  await page.goto(`${BASE_URL}/auth/login`);
  await page.getByLabel(/^email$/i).fill(creds.email);
  await page.getByLabel(/^password$/i).fill(creds.password);
  await page.getByRole("button", { name: /^login$/i }).click();
  await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function fulfillEntitlements(
  page: Page,
  body: Record<string, unknown>,
): Promise<void> {
  await page.route("**/api/me/entitlements", async (route) => {
    await route.fulfill({
      body: JSON.stringify(body),
      contentType: "application/json",
      status: 200,
    });
  });
}

test.describe("/account/billing", () => {
  test("logged-out visitors are redirected to login", async ({ page }) => {
    await page.goto(`${BASE_URL}/account/billing`);
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("desktop Free Plan shows usage and reaches Pricing", async ({
    page,
  }, testInfo) => {
    const creds = await loadSmokeCreds();
    test.skip(!creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required");
    if (!creds) return;

    await page.setViewportSize({ width: 1280, height: 900 });
    await login(page, creds);
    await fulfillEntitlements(page, {
      tier: "free",
      caps: {
        summariesUsed: 3,
        summariesLimit: 10,
        historyUsed: 2,
        historyLimit: 10,
      },
      subscription: null,
      subscriptionPresentation: { state: "free" },
    });

    await page.goto(`${BASE_URL}/account/billing`);

    await expect(
      page.getByRole("heading", { name: "Plan & Billing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Free Plan" }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", {
        name: "Monthly summaries: 3 of 10 used",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", {
        name: "Saved Videos in History: 2 of 10 used",
      }),
    ).toBeVisible();

    const upgrade = page.getByRole("link", { name: "Upgrade to Pro" });
    await expect(upgrade).toHaveCount(1);
    await page.screenshot({
      path: testInfo.outputPath("plan-billing-desktop-free.png"),
      fullPage: true,
    });
    await upgrade.click();
    await expect(page).toHaveURL(`${BASE_URL}/pricing`);
  });

  test("mobile billing issue stays readable and opens portal recovery", async ({
    page,
  }, testInfo) => {
    const creds = await loadSmokeCreds();
    test.skip(!creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required");
    if (!creds) return;

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, creds);
    await fulfillEntitlements(page, {
      tier: "pro",
      caps: {
        summariesUsed: 0,
        summariesLimit: -1,
        historyUsed: 0,
        historyLimit: -1,
      },
      subscription: { plan: "monthly" },
      subscriptionPresentation: {
        state: "billing_issue",
        plan: "monthly",
      },
    });
    await page.route("**/api/billing/portal", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          url: `${BASE_URL}/account/billing?portal=opened`,
        }),
        contentType: "application/json",
        status: 200,
      });
    });

    await page.goto(`${BASE_URL}/account/billing`);

    await expect(
      page.getByRole("heading", { name: "Billing issue" }),
    ).toBeVisible();
    await expect(
      page.getByText(/update your payment details securely in stripe/i),
    ).toBeVisible();
    const recovery = page.getByRole("button", {
      name: "Resolve billing issue in Stripe",
    });
    await expect(recovery).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("plan-billing-mobile-billing-issue.png"),
      fullPage: true,
    });
    await recovery.click();
    await expect(page).toHaveURL(
      `${BASE_URL}/account/billing?portal=opened`,
    );
  });
});
