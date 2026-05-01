import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

// Defaults to local dev (`pnpm dev`); set BASE_URL to point at a deployed env.
const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");

test.describe("/account", () => {
  test("anonymous user is redirected to /auth/login", async ({ page }) => {
    await page.goto(`${BASE_URL}/account`);
    await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test("avatar dropdown navigates to /account and shows plan info", async ({
    page,
  }) => {
    const creds = await loadSmokeCreds();
    test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
    if (!creds) return;

    // --- Login ---
    // Post-login destination is environment-specific (`/` on prod,
    // `/dashboard` on local dev). Don't pin the URL — wait for the
    // signed-in user-menu trigger to render instead.
    await page.goto(`${BASE_URL}/auth/login`);
    await page.fill("#email", creds.email);
    await page.fill("#password", creds.password);
    await page.getByRole("button", { name: /^login$/i }).click();

    const userMenu = page.getByRole("button", { name: /user menu/i });
    await expect(userMenu).toBeVisible({ timeout: 15_000 });
    await userMenu.click();

    const accountItem = page.getByRole("menuitem", { name: /account/i });
    await expect(accountItem).toBeVisible();
    await Promise.all([
      page.waitForURL(`${BASE_URL}/account`, { timeout: 10_000 }),
      accountItem.click(),
    ]);

    // --- Verify the page rendered ---
    // The "Account" heading is always present; the plan card depends on tier.
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

    // The test account is expected to be Free or Pro — assert that one of
    // the two tier-specific surfaces rendered. Either an Upgrade-to-Pro
    // link (Free) or a Manage Subscription button (Pro) must be present.
    const upgradeLink = page.getByRole("link", { name: /upgrade to pro/i });
    const manageButton = page.getByRole("button", {
      name: /manage subscription/i,
    });
    await expect(upgradeLink.or(manageButton).first()).toBeVisible({
      timeout: 10_000,
    });

    // Sign Out button is always present.
    await expect(
      page.getByRole("button", { name: /^sign out$/i })
    ).toBeVisible();
  });
});
