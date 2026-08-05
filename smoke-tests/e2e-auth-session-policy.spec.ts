import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  authenticateAndAssertSmokeAccount,
  getProductionRecoveryActionLink,
  loadAdminSmokeCreds,
  loadSmokeCreds,
  restoreSmokeAccountPassword,
  type AdminCreds,
  type SmokeCreds,
} from "./helpers";
import { buildRecoveryRedirectUrl } from "../lib/auth/recovery-redirect";

const BASE_URL = (
  process.env.BASE_URL?.trim() || "http://localhost:3000"
).replace(/\/$/, "");
const AUTH_REFRESH_PATH = "/auth/v1/token";
const AUTH_USER_PATH = "/auth/v1/user";
const AUTH_LOGOUT_PATH = "/auth/v1/logout";
const TEMP_SUFFIX = "_E2Etmp";
const REFRESH_OFFSET = 2 * 60 * 60 * 1000;

type MutationEvidence = {
  localSignOutMarkerVerified: boolean;
  globalSignOutMarkerVerified: boolean;
  passwordUpdateMarkerVerified: boolean;
  otherSessionRevocationMarkerVerified: boolean;
};

type SessionPolicyEvidence = {
  schemaVersion: 1;
  journey: "production-session-policy";
  baseUrl: string;
  status: "incomplete" | "passed";
  completedCases: string[];
  markerChecks: MutationEvidence;
  cleanup: {
    persistentProfileClosed: boolean;
    contextsClosed: boolean;
    passwordRestored: boolean;
  };
};

function newMutationEvidence(): MutationEvidence {
  return {
    localSignOutMarkerVerified: false,
    globalSignOutMarkerVerified: false,
    passwordUpdateMarkerVerified: false,
    otherSessionRevocationMarkerVerified: false,
  };
}

async function writeEvidence(evidence: SessionPolicyEvidence): Promise<void> {
  const target =
    process.env.SESSION_POLICY_EVIDENCE_PATH?.trim() ??
    "test-results/session-policy-evidence.json";
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function login(page: Page, creds: SmokeCreds): Promise<void> {
  await page.goto(`${BASE_URL}/auth/login`);
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

async function installAuthClock(context: BrowserContext): Promise<void> {
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

async function advanceAuthClock(
  page: Page,
  milliseconds: number,
): Promise<void> {
  await page.evaluate((offset) => {
    const pageWindow = window as Window & {
      advanceAuthClock?: (milliseconds: number) => void;
    };
    pageWindow.advanceAuthClock?.(offset);
  }, milliseconds);
}

async function forceRefresh(page: Page): Promise<void> {
  await advanceAuthClock(page, REFRESH_OFFSET);
  const refreshResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(AUTH_REFRESH_PATH) &&
      response.url().includes("grant_type=refresh_token"),
    { timeout: 15_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const response = await refreshResponse;
  expect(response.ok(), "forced session refresh must succeed").toBe(true);
  await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible({
    timeout: 15_000,
  });
}

async function expectRefreshRejected(page: Page): Promise<void> {
  await advanceAuthClock(page, REFRESH_OFFSET);
  const refreshResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(AUTH_REFRESH_PATH) &&
      response.url().includes("grant_type=refresh_token"),
    { timeout: 15_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const response = await refreshResponse;
  expect(response.status(), "revoked refresh must be rejected").toBeGreaterThanOrEqual(400);
  await expectSignedOut(page);
}

async function signOutLocally(page: Page): Promise<void> {
  await page.getByRole("button", { name: /user menu/i }).click();
  const signOut = page.getByRole("menuitem", { name: /^sign out$/i });
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 }),
    signOut.click(),
  ]);
  await expectSignedOut(page);
}

async function installMutationGuards(
  page: Page,
  creds: AdminCreds,
  passwords: { passwordUpdate?: string; logout: string },
  evidence: MutationEvidence,
): Promise<void> {
  await page.route(`**${AUTH_USER_PATH}**`, async (route) => {
    if (route.request().method() !== "PUT" || !passwords.passwordUpdate) {
      await route.continue();
      return;
    }

    await authenticateAndAssertSmokeAccount(creds, passwords.passwordUpdate);
    evidence.passwordUpdateMarkerVerified = true;
    await route.continue();
  });

  await page.route(`**${AUTH_LOGOUT_PATH}**`, async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    await authenticateAndAssertSmokeAccount(creds, passwords.logout);
    if (scope === "global") {
      evidence.globalSignOutMarkerVerified = true;
    } else if (scope === "others") {
      evidence.otherSessionRevocationMarkerVerified = true;
    } else {
      evidence.localSignOutMarkerVerified = true;
    }
    await route.continue();
  });
}

async function closeContext(context: BrowserContext | undefined): Promise<void> {
  if (context) await context.close();
}

test.describe("Production session policy @session-policy", () => {
  test.describe.configure({ mode: "serial" });

  test(
    "complete production session policy journey @account-recovery @account-mutating",
    async ({
  browser,
  page,
  }, testInfo) => {
  const nonAdminCreds = await loadSmokeCreds();
  const adminCreds = await loadAdminSmokeCreds();
  if (!nonAdminCreds || !adminCreds) {
    const message =
      "both marked Smoke Account pairs plus Supabase service credentials are required";
    if (process.env.CI) throw new Error(message);
    test.skip(true, message);
    return;
  }

  const evidence: SessionPolicyEvidence = {
    schemaVersion: 1,
    journey: "production-session-policy",
    baseUrl: BASE_URL,
    status: "incomplete",
    completedCases: [],
    markerChecks: newMutationEvidence(),
    cleanup: {
      persistentProfileClosed: false,
      contextsClosed: false,
      passwordRestored: false,
    },
  };
  await writeEvidence(evidence);

  let persistentContext: BrowserContext | undefined;
  let concurrentContext: BrowserContext | undefined;
  let recoveryOlderContext: BrowserContext | undefined;
  let globalInitiatingContext: BrowserContext | undefined;
  let globalOtherContext: BrowserContext | undefined;
  let passwordChanged = false;
  let journeyCompleted = false;
  const tempPassword = `${adminCreds.password}${TEMP_SUFFIX}`;

  try {
    // Phase 1: use the non-admin Smoke Account for all browser-local and
    // concurrent-session checks before any account mutation is attempted.
    const profilePath = testInfo.outputPath("remembered-browser-profile");
    persistentContext = await browser
      .browserType()
      .launchPersistentContext(profilePath);
    const firstProfilePage = await persistentContext.newPage();
    await login(firstProfilePage, nonAdminCreds);
    await persistentContext.close();
    persistentContext = await browser
      .browserType()
      .launchPersistentContext(profilePath);
    await installAuthClock(persistentContext);
    const restoredPage = await persistentContext.newPage();
    await restoredPage.goto(`${BASE_URL}/account`);
    await expect(
      restoredPage.getByRole("heading", { name: "Account" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      restoredPage.getByRole("button", { name: /user menu/i }),
    ).toBeVisible();
    evidence.completedCases.push("browser-restart");

    await forceRefresh(restoredPage);
    evidence.completedCases.push("forced-refresh");

    concurrentContext = await browser.newContext();
    await installAuthClock(concurrentContext);
    const concurrentPage = await concurrentContext.newPage();
    await login(concurrentPage, nonAdminCreds);
    await expect(
      concurrentPage.getByRole("button", { name: /user menu/i }),
    ).toBeVisible();
    evidence.completedCases.push("concurrent-contexts");

    await installMutationGuards(
      restoredPage,
      { ...nonAdminCreds, supabaseUrl: adminCreds.supabaseUrl, secretKey: adminCreds.secretKey },
      { logout: nonAdminCreds.password },
      evidence.markerChecks,
    );
    await signOutLocally(restoredPage);
    evidence.completedCases.push("local-sign-out");

    await forceRefresh(concurrentPage);
    await forceRefresh(concurrentPage);
    evidence.completedCases.push("repeated-forced-refresh");

    await closeContext(concurrentContext);
    concurrentContext = undefined;
    await persistentContext.close();
    persistentContext = undefined;
    evidence.cleanup.persistentProfileClosed = true;

    // Phase 2: password-changing recovery runs after the other authenticated
    // checks and uses only the marked administrator Smoke Account.
    recoveryOlderContext = await browser.newContext();
    await installAuthClock(recoveryOlderContext);
    const olderPage = await recoveryOlderContext.newPage();
    await login(olderPage, adminCreds);

    const actionLink = await getProductionRecoveryActionLink(
      adminCreds,
      adminCreds.email,
      buildRecoveryRedirectUrl(BASE_URL),
    );
    await page.goto(actionLink);
    await page.waitForURL(/\/auth\/update-password(?:#|$)/, {
      timeout: 15_000,
    });
    await page.locator("#password").waitFor({
      state: "visible",
      timeout: 5_000,
    });
    await page.waitForFunction(
      () => /(?:^|; )sb-[^=;]+-auth-token(?:\.\d+)?=/.test(document.cookie),
      undefined,
      { timeout: 10_000 },
    );

    await installMutationGuards(
      page,
      adminCreds,
      { passwordUpdate: adminCreds.password, logout: tempPassword },
      evidence.markerChecks,
    );
    await authenticateAndAssertSmokeAccount(adminCreds);
    await page.locator("#password").fill(tempPassword);
    const passwordUpdateResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname.endsWith(AUTH_USER_PATH),
      { timeout: 15_000 },
    );
    await page
      .getByRole("button", { name: /update password|save/i })
      .click();
    const updateResponse = await passwordUpdateResponse;
    passwordChanged = updateResponse.ok();
    expect(passwordChanged, "password update must succeed").toBe(true);
    await expect(page).toHaveURL(/\/(?:dashboard)?$/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();
    expect(evidence.markerChecks.passwordUpdateMarkerVerified).toBe(true);
    expect(evidence.markerChecks.otherSessionRevocationMarkerVerified).toBe(true);
    evidence.completedCases.push("account-recovery");

    await expect(olderPage.getByRole("button", { name: /user menu/i })).toBeVisible();
    await expectRefreshRejected(olderPage);

    await page.goto(`${BASE_URL}/account`);
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
    await expect(page.getByRole("button", { name: /user menu/i })).toBeVisible();

    // Phase 3 is intentionally last: global revocation must not race any
    // other authenticated Smoke Account check in this workflow.
    globalInitiatingContext = await browser.newContext();
    globalOtherContext = await browser.newContext();
    await installAuthClock(globalOtherContext);
    const initiatingPage = await globalInitiatingContext.newPage();
    const otherPage = await globalOtherContext.newPage();
    await login(initiatingPage, nonAdminCreds);
    await login(otherPage, nonAdminCreds);
    await initiatingPage.goto(`${BASE_URL}/account`);
    await expect(
      initiatingPage.getByRole("button", { name: /^sign out everywhere$/i }),
    ).toBeVisible();
    await expect(
      initiatingPage.getByText(/already-issued short-lived access tokens expire/i),
    ).toBeVisible();
    await installMutationGuards(
      initiatingPage,
      { ...nonAdminCreds, supabaseUrl: adminCreds.supabaseUrl, secretKey: adminCreds.secretKey },
      { logout: nonAdminCreds.password },
      evidence.markerChecks,
    );
    await authenticateAndAssertSmokeAccount({
      ...nonAdminCreds,
      supabaseUrl: adminCreds.supabaseUrl,
      secretKey: adminCreds.secretKey,
    });
    await Promise.all([
      initiatingPage.waitForURL((url) => url.pathname === "/", {
        timeout: 15_000,
      }),
      initiatingPage
        .getByRole("button", { name: /^sign out everywhere$/i })
        .click(),
    ]);
    await expectSignedOut(initiatingPage);
    expect(evidence.markerChecks.globalSignOutMarkerVerified).toBe(true);

    await expect(otherPage.getByRole("button", { name: /user menu/i })).toBeVisible();
    await expectRefreshRejected(otherPage);
    evidence.completedCases.push("sign-out-everywhere");

    await closeContext(globalInitiatingContext);
    await closeContext(globalOtherContext);
    globalInitiatingContext = undefined;
    globalOtherContext = undefined;
    evidence.cleanup.contextsClosed = true;
    journeyCompleted = true;
  } finally {
    try {
      await closeContext(recoveryOlderContext);
      await closeContext(concurrentContext);
      await closeContext(persistentContext);
      await closeContext(globalInitiatingContext);
      await closeContext(globalOtherContext);
      if (passwordChanged) {
        await restoreSmokeAccountPassword(adminCreds, tempPassword);
        evidence.cleanup.passwordRestored = true;
      }
      if (
        journeyCompleted &&
        evidence.cleanup.contextsClosed &&
        (!passwordChanged || evidence.cleanup.passwordRestored)
      ) {
        evidence.status = "passed";
      }
    } finally {
      await writeEvidence(evidence);
    }
  }
    },
  );
});
