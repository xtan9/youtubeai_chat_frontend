import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

const ADMIN_PATHS = [
  "/admin",
  "/admin/users",
  "/admin/audit",
  "/admin/performance",
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

  test("non-admin authenticated user is redirected to / (homepage)", async ({
    page,
  }) => {
    const creds = await loadSmokeCreds();
    test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
    if (!creds) return;

    // The default test account is intentionally NOT in ADMIN_EMAILS in
    // production. If that ever changes, this assertion would still pass
    // for the redirect-to-/ path but a follow-up check confirms the
    // non-admin still cannot see the admin sidebar.
    await page.goto(`${PROD_URL}/auth/login`);
    await page.fill("#email", creds.email);
    await page.fill("#password", creds.password);
    await Promise.all([
      page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);

    // Now hit /admin — gate should reject and bounce to /.
    await page.goto(`${PROD_URL}/admin`);
    await expect(page).toHaveURL(`${PROD_URL}/`, { timeout: 10_000 });

    // Defense in depth: the admin sidebar must not render anywhere.
    await expect(page.locator('[data-admin-scope]')).toHaveCount(0);
  });
});
