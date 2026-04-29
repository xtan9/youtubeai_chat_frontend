import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("admin dashboard shows real-count badge and toggles admin exclusion", async ({
  page,
}) => {
  const adminEmail = process.env.TEST_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.TEST_ADMIN_PASSWORD?.trim();
  test.skip(
    !adminEmail || !adminPassword,
    "TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD required",
  );

  const creds =
    adminEmail && adminPassword
      ? { email: adminEmail, password: adminPassword }
      : await loadSmokeCreds();
  if (!creds) return;

  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/" || url.pathname === "/dashboard", {
      timeout: 15_000,
    }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Sidebar real-count: badge shows a number that is NOT "1,284" (the old
  // hardcoded placeholder). We don't pin the exact number — just that it
  // exists and isn't the placeholder.
  await page.goto(`${PROD_URL}/admin`);
  await expect(page.getByRole("heading", { name: /^Dashboard$/ })).toBeVisible();
  const usersLink = page.locator(`a[href="/admin/users"]`);
  await expect(usersLink).toBeVisible();
  const badgeText = await usersLink.locator(".badge").textContent();
  expect(badgeText).toBeTruthy();
  expect(badgeText).not.toBe("1,284");

  // Subtitle reflects exclusion mode.
  await expect(page.getByText(/excluding admin activity/i)).toBeVisible();

  // Toggle: click the "real users" pill.
  await page.getByRole("button", { name: /real users/i }).click();
  await expect(page).toHaveURL(/include_admins=1/);
  await expect(page.getByText(/including admins/i)).toBeVisible();

  // Performance page: same toggle works.
  await page.goto(`${PROD_URL}/admin/performance`);
  await expect(page.getByRole("heading", { name: /^Performance$/ })).toBeVisible();
  await expect(page.getByText(/excluding admin activity/i)).toBeVisible();
});
