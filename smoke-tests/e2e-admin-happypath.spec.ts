import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// This spec runs only when TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD are set
// (typically against a Vercel preview with a preview-only ADMIN_EMAILS),
// since the default test account is intentionally NOT in production's
// allowlist. Skip-conditional matches the precedent in e2e-auth-login.spec.ts.

test("admin signs in → dashboard renders + transcript modal opens", async ({
  page,
}) => {
  const adminEmail = process.env.TEST_ADMIN_EMAIL?.trim();
  const adminPassword = process.env.TEST_ADMIN_PASSWORD?.trim();
  test.skip(
    !adminEmail || !adminPassword,
    "TEST_ADMIN_EMAIL/TEST_ADMIN_PASSWORD required (must be in ADMIN_EMAILS)",
  );

  const creds = adminEmail && adminPassword
    ? { email: adminEmail, password: adminPassword }
    : await loadSmokeCreds();
  if (!creds) return;

  // Sign in
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // /admin renders dashboard
  await page.goto(`${PROD_URL}/admin`);
  await expect(page).toHaveURL(`${PROD_URL}/admin`, { timeout: 10_000 });
  await expect(page.locator('[data-admin-scope]')).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Dashboard$/ })).toBeVisible();
  await expect(page.getByText("Summaries", { exact: true })).toBeVisible();
  await expect(page.getByText("p95 latency", { exact: true })).toBeVisible();

  // /admin/users — open transcript modal, confirm audit banner
  await page.goto(`${PROD_URL}/admin/users`);
  await expect(page.getByRole("heading", { name: /^Users$/ })).toBeVisible();
  await page.getByRole("button", { name: /View transcript/i }).first().click();
  await expect(
    page.getByText(/viewing as admin.*will be logged|viewing as admin.*is logged/i),
  ).toBeVisible({ timeout: 5_000 });
});
