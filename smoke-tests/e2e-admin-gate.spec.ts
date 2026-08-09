import { test, expect } from "@playwright/test";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const ADMIN_PATHS = [
  "/admin",
  "/admin/users",
  "/admin/audit",
  "/admin/performance",
  "/admin/subscriptions",
];

test.describe("admin gate", () => {
  for (const path of ADMIN_PATHS) {
    test(`logged-out request to ${path} redirects to /auth/login`, async ({
      page,
    }) => {
      await page.goto(`${PROD_URL}${path}`);
      await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
    });
  }

  test("non-admin authenticated user cannot access /admin", async ({ page }) => {
    const email = process.env.TEST_NON_ADMIN_EMAIL?.trim();
    const password = process.env.TEST_NON_ADMIN_PASSWORD?.trim();
    test.skip(
      !email || !password,
      "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required",
    );
    if (!email || !password) return;

    await page.goto(`${PROD_URL}/auth/login`);
    await page.fill("#email", email);
    await page.fill("#password", password);
    await Promise.all([
      page.waitForURL(
        (url) => url.pathname === "/" || url.pathname === "/dashboard",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);

    await page.goto(`${PROD_URL}/admin`);
    await expect(page).toHaveURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 10_000 },
    );
    await expect(page.locator("[data-admin-scope]")).toHaveCount(0);
  });
});
