import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("login → logout round-trip", async ({ page }) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_USER_EMAIL/TEST_USER_PASSWORD required");
  if (!creds) return;

  // --- Login ---
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(`${PROD_URL}/`, { timeout: 15_000 }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Authenticated state signal: an account/menu trigger that's only
  // present when signed in. Adjust the selector to whatever the project
  // surfaces — common patterns:
  //   - getByRole("button", { name: /account|profile|sign out/i })
  //   - getByTestId("user-menu-trigger")
  const accountMenu = page
    .getByRole("button", { name: /account|profile|sign out|logout/i })
    .or(page.getByTestId("user-menu-trigger"));
  await expect(accountMenu).toBeVisible({ timeout: 10_000 });

  // --- Logout ---
  await accountMenu.click();
  // Logout may be inside an open menu, or a direct button.
  const logout = page
    .getByRole("menuitem", { name: /sign out|logout/i })
    .or(page.getByRole("button", { name: /sign out|logout/i }));
  await Promise.all([
    page.waitForURL(/\/(auth\/login)?$/, { timeout: 10_000 }),
    logout.click(),
  ]);

  // Unauthenticated state: account menu must be gone AND sign-in CTA visible.
  // Both checks together guard against a refactor that hides Sign Out via
  // CSS without actually logging out.
  await expect(accountMenu).not.toBeVisible();
  await expect(
    page
      .getByRole("button", { name: /sign in|log in/i })
      .or(page.getByRole("link", { name: /sign in|log in/i }))
  ).toBeVisible();
});
