import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  type AdminCreds,
  loadAdminCreds,
  authenticateAndAssertSmokeAccount,
  generateRecoveryLink,
  getProductionRecoveryActionLink,
  loadSmokeCreds,
  restoreSmokeAccountPassword,
} from "./helpers";
import { buildRecoveryRedirectUrl } from "../lib/auth/recovery-redirect";

const PROD_URL = (
  process.env.PROD_URL?.trim() || "https://www.youtubeai.chat"
).replace(/\/$/, "");
const AUTH_REFRESH_PATH = "/auth/v1/token";
const AUTH_USER_PATH = "/auth/v1/user";

async function login(page: Page, creds: AdminCreds): Promise<void> {
  await page.goto(`${PROD_URL}/auth/login`);
  await page.fill("#email", creds.email);
  await page.fill("#password", creds.password);
  await Promise.all([
    page.waitForURL(
      (url) => url.pathname === "/" || url.pathname === "/dashboard",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: /^login$/i }).click(),
  ]);
  await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function expectSignedOut(page: Page): Promise<void> {
  await expect(
    page
      .getByRole("button", { name: /sign in|log in/i })
      .or(page.getByRole("link", { name: /sign in|log in/i }))
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

async function addExpiredSessionClock(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const realDateNow = Date.now.bind(Date);
    const readOffset = () => {
      const [, rawOffset = "0"] =
        window.name.match(/^youtubeai-auth-clock:(\d+)$/) ?? [];
      return Number(rawOffset);
    };

    if (!/^youtubeai-auth-clock:\d+$/.test(window.name)) {
      window.name = "youtubeai-auth-clock:0";
    }

    Date.now = () => realDateNow() + readOffset();
    (
      window as Window & {
        advanceAuthClock?: (milliseconds: number) => void;
      }
    ).advanceAuthClock = (milliseconds) => {
      window.name = `youtubeai-auth-clock:${readOffset() + milliseconds}`;
    };
  });
}

async function advanceAuthClock(page: Page, milliseconds: number): Promise<void> {
  await page.evaluate((offset) => {
    const pageWindow = window as Window & {
      advanceAuthClock?: (milliseconds: number) => void;
    };
    pageWindow.advanceAuthClock?.(offset);
  }, milliseconds);
}

async function closeContext(context: BrowserContext | undefined): Promise<void> {
  if (context) await context.close();
}

async function guardOtherSessionRevocation(
  page: Page,
  creds: AdminCreds,
  password: string,
): Promise<() => boolean> {
  let markerVerified = false;

  await page.route("**/auth/v1/logout**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("scope") !== "others") {
      await route.continue();
      return;
    }

    // The browser is about to revoke older sessions. Re-authenticate through
    // the protected service client so a misconfigured credential cannot reach
    // this destructive request unless the trusted app_metadata marker passes.
    await authenticateAndAssertSmokeAccount(creds, password);
    markerVerified = true;
    await route.continue();
  });

  return () => markerVerified;
}

function waitForPasswordUpdate(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith(AUTH_USER_PATH),
    { timeout: 15_000 },
  );
}

// Regression guard for the recovery redirect URL the form sends to Supabase.
// See lib/auth/recovery-redirect.ts for the allowlist + implicit-grant
// reasoning the assertions below pin. We intercept the recover request
// rather than completing it because (a) the test account is shared with
// manual QA and burning real recovery tokens during automation locks
// future sessions out, and (b) the meaningful assertion is what the form
// *requested*, not how Supabase handled it. Skip when login creds are
// absent (CI without secrets).
test("password reset form requests the apex /auth/update-password redirectTo", async ({
  page,
}) => {
  const creds = await loadSmokeCreds();
  test.skip(!creds, "TEST_NON_ADMIN_EMAIL/TEST_NON_ADMIN_PASSWORD required");
  if (!creds) return;

  let observedRedirectTo: string | undefined;

  await page.route("**/auth/v1/recover**", async (route) => {
    // Supabase JS sends redirect_to as a URL query param, not in the body.
    const url = new URL(route.request().url());
    observedRedirectTo = url.searchParams.get("redirect_to") ?? undefined;
    // 200 with empty body matches Supabase's success shape closely enough
    // for the form to flip into its "Check Your Email" success state. If a
    // future supabase-js validates a field on this response (today the
    // success path only checks for absence of `error`), update the body
    // here to match — the failure mode would be the success-text wait
    // timing out before the redirectTo assertion runs.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  await page.goto(`${PROD_URL}/auth/forgot-password`);
  await page.fill("#email", creds.email);
  await page.getByRole("button", { name: /send reset|reset password/i }).click();
  await expect(page.getByText(/check your email|sent/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Shared invariants regardless of env: apex (no www), targets the
  // update-password page directly, no extra query string. On local dev the
  // origin is http://localhost:3000 (no www to strip); the same path
  // assertions still hold.
  expect(observedRedirectTo, "form must call resetPasswordForEmail").toBeDefined();
  expect(observedRedirectTo).not.toMatch(/^https?:\/\/www\./i);
  expect(new URL(observedRedirectTo!).pathname).toBe("/auth/update-password");
  expect(new URL(observedRedirectTo!).search).toBe("");
});

// A stable temp password used during the reset flow. Must be different from
// the real password (Supabase blocks same-password updates via the UI). The
// admin API resets it back to the original at the end so subsequent runs work.
const TEMP_SUFFIX = "_E2Etmp";

test("password reset: forgot → recovery link → update → re-login @account-recovery", async ({
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
    // hashed_token from the admin API and verifies it via verifyOtp. This
    // is a SYNTHETIC path — the user-facing recovery flow is implicit grant
    // through Supabase's legacy verify endpoint (asserted in the previous
    // test) — but using it here gives us a real session on /auth/update-password
    // without burning the email round-trip. The downside: a regression in
    // the actual implicit-grant path won't fail this test. The
    // network-intercept test above pins the form-side contract; the
    // implicit-grant runtime path is verified manually after deploy.
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

    // The recovery page is about to invoke auth.updateUser. Fetch the
    // authenticated account through Auth immediately before that mutation so
    // a misrouted credential cannot change a human account's password.
    await authenticateAndAssertSmokeAccount(creds);
    const markerVerifiedBeforeRevocation = await guardOtherSessionRevocation(
      page,
      creds,
      tempPassword,
    );

    // --- Update password to a known temp value (Supabase blocks same-password updates) ---
    await page.locator("#password").fill(tempPassword);
    const passwordUpdateResponse = waitForPasswordUpdate(page);
    await page.getByRole("button", { name: /update password|save/i }).click();
    const updateResponse = await passwordUpdateResponse;
    passwordChanged = updateResponse.ok();
    expect(passwordChanged, "password update must succeed before recovery completes").toBe(true);
    await expect(page).toHaveURL(/\/(?:dashboard)?$/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();
    expect(markerVerifiedBeforeRevocation()).toBe(true);

    // --- Sanity: log out then re-login with the temp password to confirm it works ---
    await context.clearCookies();
    await page.goto(`${PROD_URL}/auth/login`);
    await page.fill("#email", creds.email);
    await page.fill("#password", tempPassword);
    await Promise.all([
      page.waitForURL(
        (url) => url.pathname === "/" || url.pathname === "/dashboard",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);
  } finally {
    // Restore original password EVEN ON FAILURE so subsequent runs work.
    // Skip restore only when the password was never changed (test failed
    // before the update form was submitted).
    if (passwordChanged) {
      await restoreSmokeAccountPassword(creds, tempPassword);
    }
  }
});

// End-to-end coverage for the actual production recovery path: implicit
// grant via Supabase's legacy verify endpoint, fragment-based session
// handoff, statically-prerendered /auth/update-password rendering against
// that session. This is what the unit tests on `buildRecoveryRedirectUrl`
// cannot verify on their own — it catches regressions like
// (a) the page being wrapped in an auth gate that bounces no-cookie users,
// (b) middleware redirecting /auth/update-password,
// (c) UserProvider being removed from the layout that covers this route, or
// (d) someone setting `detectSessionInUrl: false` in lib/supabase/client.ts.
// All four would let the network-intercept test pass while breaking the
// real flow in production.
test("password reset (implicit grant): action_link → fragment → form → update @account-recovery", async ({
  page,
  context,
  browser,
}) => {
  const creds = await loadAdminCreds();
  test.skip(!creds, "SUPABASE_SECRET_KEY required");
  if (!creds) return;
  // The implicit-grant flow only matters against the production allowlist.
  // On local dev, the redirectTo would be http://localhost:3000/auth/update-password,
  // which Supabase rejects (not allowlisted) and falls back to the apex
  // Site URL — leaving the user on prod, not local. Skip then.
  test.skip(
    !PROD_URL.includes("youtubeai.chat"),
    "Implicit-grant flow requires running against a host in the Supabase Auth allowlist"
  );

  const tempPassword = creds.password + TEMP_SUFFIX + "_action";
  let passwordChanged = false;
  let olderContext: BrowserContext | undefined;

  try {
    // Establish a Remembered Session before recovery. The recovery browser
    // must survive the later `scope: "others"` revocation while this older
    // context must fail on its next real refresh.
    olderContext = await browser.newContext();
    await addExpiredSessionClock(olderContext);
    const olderPage = await olderContext.newPage();
    await login(olderPage, creds);

    // Build the redirectTo exactly the way the production form does, then
    // ask Supabase for the same action_link the recovery email would carry.
    const redirectTo = buildRecoveryRedirectUrl(PROD_URL);
    const actionLink = await getProductionRecoveryActionLink(
      creds,
      creds.email,
      redirectTo
    );

    // Following the action_link runs Supabase's verify endpoint, which 303s
    // to redirectTo with `#access_token=...&type=recovery` in the fragment.
    // Vercel's edge then 307s non-www → www, preserving the fragment in
    // Chrome (probed separately during the PR #45 fix). The browser SDK
    // detects the fragment and establishes the session on page mount.
    await page.goto(actionLink);
    await page.waitForURL(/\/auth\/update-password(?:#|$)/, { timeout: 15_000 });

    // Wait for the form to be interactable AND for the SDK to have parsed
    // the fragment (the input becomes ready before the session lands —
    // racing the form submit can hit updateUser without a session).
    // @supabase/ssr's createBrowserClient persists the session in cookies
    // (`sb-*-auth-token`), not localStorage, so check document.cookie. The
    // cookie may be split across `.0`/`.1` chunks for size; just match the
    // prefix.
    await page.locator("#password").waitFor({ state: "visible", timeout: 5_000 });
    await page.waitForFunction(
      () => /(?:^|; )sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie),
      undefined,
      { timeout: 10_000 }
    );

    // Guard the password mutation against a credential accidentally pointing
    // at an unmarked account before submitting the recovery form.
    await authenticateAndAssertSmokeAccount(creds);
    const markerVerifiedBeforeRevocation = await guardOtherSessionRevocation(
      page,
      creds,
      tempPassword,
    );

    await page.locator("#password").fill(tempPassword);
    const passwordUpdateResponse = waitForPasswordUpdate(page);
    await page.getByRole("button", { name: /update password|save/i }).click();
    const updateResponse = await passwordUpdateResponse;
    passwordChanged = updateResponse.ok();
    expect(passwordChanged, "password update must succeed before recovery completes").toBe(true);
    await expect(page).toHaveURL(/\/(?:dashboard)?$/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();
    expect(markerVerifiedBeforeRevocation()).toBe(true);

    // The recovery browser's session is the one preserved by `scope:
    // "others"`; prove it at an authenticated product boundary after the
    // redirect rather than inferring it from the update response.
    await page.goto(`${PROD_URL}/account`);
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();

    await expect(olderPage.getByRole("button", { name: /user menu/i })).toBeVisible();
    await advanceAuthClock(olderPage, 3 * 60 * 60 * 1000);
    const refreshResponse = olderPage.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(AUTH_REFRESH_PATH) &&
        response.url().includes("grant_type=refresh_token"),
      { timeout: 15_000 },
    );
    await olderPage.reload({ waitUntil: "domcontentloaded" });
    const response = await refreshResponse;
    expect(response.status()).toBeGreaterThanOrEqual(400);
    await expectSignedOut(olderPage);

    // Sanity: re-login with the temp password.
    await context.clearCookies();
    await page.goto(`${PROD_URL}/auth/login`);
    await page.fill("#email", creds.email);
    await page.fill("#password", tempPassword);
    await Promise.all([
      page.waitForURL(
        (url) => url.pathname === "/" || url.pathname === "/dashboard",
        { timeout: 15_000 },
      ),
      page.getByRole("button", { name: /^login$/i }).click(),
    ]);
  } finally {
    try {
      await closeContext(olderContext);
    } finally {
      // Restore the Smoke Account even when password update succeeded but
      // older-session revocation or the later session assertions failed.
      if (passwordChanged) {
        await restoreSmokeAccountPassword(creds, tempPassword);
      }
    }
  }
});
