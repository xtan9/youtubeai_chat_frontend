import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loadAdminCreds, deleteUserByEmail } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("signup creates a new account and redirects to sign-up-success", async ({
  page,
}) => {
  const creds = await loadAdminCreds();
  test.skip(!creds, "SUPABASE_SECRET_KEY required for signup teardown");
  if (!creds) return;

  const email = `signup-test-${randomUUID()}@youtubeai.chat`;
  const password = `TestPass!${randomUUID().slice(0, 8)}`;

  try {
    await page.goto(`${PROD_URL}/auth/sign-up`);

    // Use role-based locators — survives visual redesigns. Form has
    // distinct password + repeat-password inputs.
    await page.getByLabel(/email/i).fill(email);
    await page.locator("#password").fill(password);
    await page.locator("#repeat-password").fill(password);

    await Promise.all([
      page.waitForURL(/\/auth\/sign-up-success/, { timeout: 15_000 }),
      page.getByRole("button", { name: /sign up/i }).click(),
    ]);

    await expect(
      page.getByText(/check your email|confirmation/i).first()
    ).toBeVisible();
  } finally {
    // Cleanup is mandatory — if it fails, the test must fail too so the
    // accumulating-orphans condition is visible (otherwise auth.users
    // grows monotonically and degrades pagination on every run). We log
    // first to give the assertion failure context, then re-throw.
    try {
      await deleteUserByEmail(creds, email);
    } catch (err) {
      console.error("[e2e-auth-signup] teardown deleteUser failed:", err);
      throw err;
    }
  }
});
