import { test, expect } from "@playwright/test";
import { loadSmokeCreds } from "./helpers";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");

test("login → logout round-trip", async ({ page }) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required");
  if (!creds) return;

  // --- Login ---
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", {
      timeout: 15_000,
    }),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);

  // Authenticated state signal: an account/menu trigger that's only
  // present when signed in. Adjust the selector to whatever the project
  // surfaces — common patterns:
  //   - getByRole("button", { name: /account|profile|sign out/i })
  //   - getByTestId("user-menu-trigger")
  const accountMenu = page.getByRole("button", { name: /user menu/i });
  await expect(accountMenu).toBeVisible({ timeout: 10_000 });

  // A remembered session must not be shown the cached login form. The
  // request middleware should recognize the auth cookie and send the Learner
  // straight back to their dashboard.
  await page.goto(`${PROD_URL}/auth/login`);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

  // The other signed-out-only auth surfaces must follow the same rule. A
  // registered Learner should never be offered another account or stale
  // post-signup instructions while their Remembered Session is active.
  await page.goto(`${PROD_URL}/auth/sign-up`);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

  await page.goto(`${PROD_URL}/auth/sign-up-success`);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });

  // An authenticated navigation to the public root must not render the
  // marketing homepage. The dashboard is the only post-login landing page.
  await page.goto(`${PROD_URL}/`);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: /welcome back/i }),
  ).toBeVisible();

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
