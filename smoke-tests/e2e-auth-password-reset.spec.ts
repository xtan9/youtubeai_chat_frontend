import { test, expect } from "@playwright/test";
import { loadAdminCreds, generateRecoveryLink, getAdminClient } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

// A stable temp password used during the reset flow. Must be different from
// the real password (Supabase blocks same-password updates via the UI). The
// admin API resets it back to the original at the end so subsequent runs work.
const TEMP_SUFFIX = "_E2Etmp";

test("password reset: forgot → recovery link → update → re-login", async ({
  page,
  context,
}) => {
  const creds = await loadAdminCreds();
  test.skip(!creds, "SUPABASE_SECRET_KEY required");
  if (!creds) return;

  const tempPassword = creds.password + TEMP_SUFFIX;
  let passwordChanged = false;

  try {
    // --- Forgot-password form submission (UI signal only) ---
    await page.goto(`${PROD_URL}/auth/forgot-password`);
    await page.fill("#email", creds.email);
    await page.getByRole("button", { name: /send reset|reset password/i }).click();
    // Accept success card OR Supabase rate-limit response — both confirm the
    // form was submitted (the rate-limit fires when the previous run was < 45s ago).
    await expect(
      page
        .getByText(/check your email|sent|security purposes|after \d+ seconds/i)
        .first()
    ).toBeVisible({ timeout: 10_000 });

    // --- Skip the email; pull the recovery link via admin API ---
    // generateRecoveryLink builds a direct /auth/confirm URL using the
    // hashed_token from the admin API. This avoids the implicit-flow hash
    // fragment (which gets stripped on www↔non-www HTTP redirects) and goes
    // through the app's PKCE-compatible verifyOtp handler instead.
    const recoveryLink = await generateRecoveryLink(
      creds,
      creds.email,
      PROD_URL,
      "/auth/update-password"
    );

    // The recovery link points to /auth/confirm on the app; following it in
    // the same browser context establishes the session cookie, which the
    // /auth/update-password page needs.
    await page.goto(recoveryLink);
    await page.waitForURL(/\/auth\/update-password/, { timeout: 15_000 });

    // --- Update password to a known temp value (Supabase blocks same-password updates) ---
    await page.locator("#password").fill(tempPassword);
    await Promise.all([
      page.waitForURL(`${PROD_URL}/`, { timeout: 10_000 }),
      page.getByRole("button", { name: /update password|save/i }).click(),
    ]);
    // Mark immediately after the password change is committed by Supabase.
    // The redirect above only completes after the auth.updateUser call returned.
    passwordChanged = true;

    // --- Sanity: log out then re-login with the temp password to confirm it works ---
    await context.clearCookies();
    await page.goto(`${PROD_URL}/auth/login`);
    await page.fill("#email", creds.email);
    await page.fill("#password", tempPassword);
    await Promise.all([
      page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);
  } finally {
    // Restore original password EVEN ON FAILURE so subsequent runs work.
    // Skip restore only when the password was never changed (test failed
    // before the update form was submitted).
    if (passwordChanged) {
      const admin = await getAdminClient(creds);
      // Paginate to find user (project may exceed any single page size).
      let userId: string | undefined;
      for (let pg = 1; !userId; pg++) {
        const { data, error } = await admin.auth.admin.listUsers({
          page: pg,
          perPage: 1000,
        });
        if (error) throw error;
        const match = data.users.find((u) => u.email === creds.email);
        if (match) {
          userId = match.id;
          break;
        }
        if (data.users.length < 1000) break;
      }
      if (!userId) {
        throw new Error(
          `Teardown: cannot find user ${creds.email} to restore password`
        );
      }
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password: creds.password,
      });
      if (error) throw error;
    }
  }
});
