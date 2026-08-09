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

  test("avatar dropdown navigates to Account identity and security controls", async ({
    page,
  }) => {
    const creds = await loadSmokeCreds();
    test.skip(!creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required");
    if (!creds) return;

    // The post-login destination varies by environment. The user-menu trigger
    // is the stable signal that the registered session is ready.
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

    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByText(creds.email)).toBeVisible();
    await expect(
      page.getByText(/sign out everywhere revokes refresh access/i),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /upgrade to pro/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /manage subscription/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^sign out$/i }),
    ).toBeVisible();
  });
});
