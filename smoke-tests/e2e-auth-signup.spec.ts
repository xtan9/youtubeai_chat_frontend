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
    // Always clean up — even on test failure — so randomized users
    // don't accumulate in the project.
    await deleteUserByEmail(creds, email).catch((err) => {
      console.warn("[e2e-auth-signup] teardown deleteUser failed:", err);
    });
  }
});
