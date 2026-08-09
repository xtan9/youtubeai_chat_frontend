import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const REGISTERED_USER_ID = "30000000-0000-4000-8000-000000000305";
const REGISTERED_EMAIL = "global-plan@example.test";
const AUTH_COOKIE_NAME = "sb-global-plan-e2e-auth-token";

let appProcess: ChildProcess | undefined;
let appOutput = "";
let appUrl = "";
let supabaseFixture: Server | undefined;

test.beforeAll(async () => {
  supabaseFixture = createServer(handleSupabaseRequest);
  const supabasePort = await listenOnAvailablePort(supabaseFixture);
  const supabaseUrl = `http://127.0.0.1:${supabasePort}`;
  const appPort = await findAvailablePort();
  appUrl = `http://127.0.0.1:${appPort}`;
  const nextCli = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );

  appProcess = spawn(
    process.execPath,
    [
      nextCli,
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(appPort),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_SITE_URL: appUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
        NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME: AUTH_COOKIE_NAME,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_TELEMETRY_DISABLED: "1",
        WORKSPACE_E2E_DIST_DIR:
          "node_modules/.cache/next-global-plan-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  appProcess.stdout?.on("data", rememberAppOutput);
  appProcess.stderr?.on("data", rememberAppOutput);

  await waitForApp(`${appUrl}/faq`, appProcess);
});

test.afterAll(async () => {
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill();
    await Promise.race([
      once(appProcess, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  if (supabaseFixture) {
    await new Promise<void>((resolve, reject) => {
      supabaseFixture?.close((error) =>
        error ? reject(error) : resolve(),
      );
    });
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`logged-out ${viewport.name} header keeps Pricing labeled and directly reachable`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`${appUrl}/faq`);

    const pricing = page
      .getByRole("banner")
      .getByRole("link", { name: "Pricing" });
    await expect(pricing).toBeVisible();
    await expect(pricing).toHaveAttribute(
      "href",
      "/pricing?source_surface=global_header",
    );
    await expectNoHorizontalOverflow(page);
    await pricing.focus();
    await expect(pricing).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(
      `${appUrl}/pricing?source_surface=global_header`,
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Simple pricing" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`global-plan-public-${viewport.name}.png`),
      fullPage: true,
    });
  });

  test(`registered Free ${viewport.name} header exposes Upgrade and separate settings destinations`, async ({
    context,
    page,
  }, testInfo) => {
    await addRegisteredSession(context);
    await fulfillEntitlements(page, {
      tier: "free",
      caps: {
        summariesUsed: 2,
        summariesLimit: 10,
        historyUsed: 1,
        historyLimit: 10,
      },
      subscriptionPresentation: { state: "free" },
    });
    await page.setViewportSize(viewport);
    await page.goto(`${appUrl}/faq`);

    const upgrade = page.getByRole("link", { name: "Upgrade to Pro" });
    await expect(upgrade).toBeVisible();
    await expect(upgrade).toHaveAttribute(
      "href",
      "/pricing?source_surface=global_header",
    );
    await expect(upgrade).toHaveCSS("color", "rgb(250, 250, 250)");
    await expectNoHorizontalOverflow(page);

    const userMenu = page.getByRole("button", { name: "User menu" });
    await userMenu.click();
    await expect(
      page.getByRole("menuitem", { name: "Account" }),
    ).toHaveAttribute("href", "/account");
    await expect(
      page.getByRole("menuitem", { name: "Plan & Billing" }),
    ).toHaveAttribute("href", "/account/billing");
    await page.keyboard.press("Escape");
    await upgrade.click();

    await expect(page).toHaveURL(
      `${appUrl}/pricing?source_surface=global_header`,
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Simple pricing" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`global-plan-free-${viewport.name}.png`),
      fullPage: true,
    });
  });
}

for (const scenario of [
  {
    name: "desktop Pro",
    viewport: { width: 1280, height: 900 },
    presentation: {
      state: "active_pro",
      plan: "yearly",
      renewsAt: "2027-01-01T00:00:00.000Z",
    },
    label: "Pro Plan",
    destination: "/account/billing",
    destinationHeading: "Plan & Billing",
  },
  {
    name: "mobile billing-issue",
    viewport: { width: 390, height: 844 },
    presentation: {
      state: "billing_issue",
      plan: "monthly",
    },
    label: "Billing issue",
    destination: "/account/billing",
    destinationHeading: "Plan & Billing",
  },
  {
    name: "desktop pending-cancellation Pro",
    viewport: { width: 1280, height: 900 },
    presentation: {
      state: "pro_pending_cancellation",
      plan: "yearly",
      accessEndsAt: "2027-01-01T00:00:00.000Z",
    },
    label: "Pro Plan",
    destination: "/account/billing",
    destinationHeading: "Plan & Billing",
  },
  {
    name: "mobile lookup failure",
    viewport: { width: 390, height: 844 },
    presentation: {
      state: "lookup_failure",
    },
    label: "Plans",
    destination: "/pricing?source_surface=global_header",
    destinationHeading: "Simple pricing",
  },
] as const) {
  test(`${scenario.name} lookup never flashes Upgrade to Pro`, async ({
    context,
    page,
  }, testInfo) => {
    await addRegisteredSession(context);
    await trackUpgradeFlash(page);
    let releaseLookup!: () => void;
    const lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    await page.route("**/api/me/entitlements", async (route) => {
      await lookupGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          tier:
            scenario.presentation.state === "active_pro" ||
            scenario.presentation.state === "pro_pending_cancellation"
              ? "pro"
              : "free",
          caps: {
            summariesUsed: 0,
            summariesLimit: -1,
            historyUsed: 0,
            historyLimit: -1,
          },
          subscriptionPresentation: scenario.presentation,
        }),
      });
    });
    await page.setViewportSize(scenario.viewport);
    await page.goto(`${appUrl}/faq`);

    await expect(
      page.getByRole("status", { name: "Loading plan status" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Upgrade to Pro" }),
    ).toHaveCount(0);
    expect(await upgradeFlashWasSeen(page)).toBe(false);

    releaseLookup();
    const planControl = page.getByRole("link", { name: scenario.label });
    await expect(planControl).toBeVisible();
    await expect(planControl).toHaveAttribute("href", scenario.destination);
    expect(await upgradeFlashWasSeen(page)).toBe(false);
    await expectNoHorizontalOverflow(page);
    await planControl.click();

    await expect(page).toHaveURL(`${appUrl}${scenario.destination}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: scenario.destinationHeading,
      }),
    ).toBeVisible();
    expect(await upgradeFlashWasSeen(page)).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(
        `global-plan-${scenario.presentation.state}.png`,
      ),
      fullPage: true,
    });
  });
}

for (const scenario of [
  {
    name: "desktop activation pending return",
    viewport: { width: 1280, height: 900 },
    finalStatus: "active" as const,
    finalHeading: "Pro Plan is active",
  },
  {
    name: "mobile activation invalid return",
    viewport: { width: 390, height: 844 },
    finalStatus: "invalid" as const,
    finalHeading: "Checkout return unavailable",
  },
] as const) {
  test(`${scenario.name} keeps the header actionless before its terminal outcome`, async ({
    context,
    page,
  }, testInfo) => {
    await addRegisteredSession(context);
    await trackUpgradeFlash(page);
    await fulfillEntitlements(page, {
      tier: scenario.finalStatus === "active" ? "pro" : "free",
      caps: {
        summariesUsed: 0,
        summariesLimit: 10,
        historyUsed: 0,
        historyLimit: 10,
      },
      subscriptionPresentation:
        scenario.finalStatus === "active"
          ? {
              state: "active_pro",
              plan: "yearly",
              renewsAt: "2027-01-01T00:00:00.000Z",
            }
          : { state: "free" },
    });

    let statusReads = 0;
    let releaseInvalid!: () => void;
    const invalidGate = new Promise<void>((resolve) => {
      releaseInvalid = resolve;
    });
    await page.route("**/api/billing/checkout/status?**", async (route) => {
      statusReads += 1;
      if (scenario.finalStatus === "invalid") {
        await invalidGate;
        await route.fulfill({ status: 400, body: "invalid checkout return" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          statusReads === 1
            ? { status: "pending" }
            : {
                status: "active",
                subscriptionPresentation: {
                  state: "active_pro",
                  plan: "yearly",
                  renewsAt: "2027-01-01T00:00:00.000Z",
                },
              },
        ),
      });
    });

    await page.setViewportSize(scenario.viewport);
    await page.goto(
      `${appUrl}/billing/success?session_id=cs_test_global_header_return`,
    );

    const header = page.getByRole("banner");
    await expect(header.getByRole("status")).toHaveText("Activating Pro");
    await expect(
      header.getByRole("link", { name: /pricing|upgrade|checkout|choose/i }),
    ).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: /pricing|upgrade|checkout|choose/i }),
    ).toHaveCount(0);
    expect(await upgradeFlashWasSeen(page)).toBe(false);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `global-plan-activation-${scenario.finalStatus}-${
          scenario.viewport.width < 600 ? "mobile" : "desktop"
        }.png`,
      ),
      fullPage: true,
    });

    if (scenario.finalStatus === "invalid") releaseInvalid();
    await expect(
      page.getByRole("heading", { level: 1, name: scenario.finalHeading }),
    ).toBeVisible({ timeout: 10_000 });
    if (scenario.finalStatus === "active") {
      await expect(header.getByRole("link", { name: "Pro Plan" })).toHaveAttribute(
        "href",
        "/account/billing",
      );
    } else {
      await expect(header.getByRole("link", { name: "Upgrade to Pro" })).toBeVisible();
    }
    expect(statusReads).toBeGreaterThan(0);
    if (scenario.finalStatus === "active") {
      expect(await upgradeFlashWasSeen(page)).toBe(false);
    }
    await page.screenshot({
      path: testInfo.outputPath(
        `global-plan-activation-${scenario.finalStatus}-terminal.png`,
      ),
      fullPage: true,
    });
  });
}

async function fulfillEntitlements(page: Page, payload: unknown) {
  await page.route("**/api/me/entitlements", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(payload),
    }),
  );
}

async function trackUpgradeFlash(page: Page) {
  await page.addInitScript(() => {
    const trackedWindow = window as Window & {
      __globalPlanUpgradeSeen?: boolean;
    };
    trackedWindow.__globalPlanUpgradeSeen = false;
    const detectUpgrade = () => {
      if (document.body?.textContent?.includes("Upgrade to Pro")) {
        trackedWindow.__globalPlanUpgradeSeen = true;
      }
    };
    const observer = new MutationObserver(detectUpgrade);
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", detectUpgrade);
  });
}

async function upgradeFlashWasSeen(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (window as Window & { __globalPlanUpgradeSeen?: boolean })
        .__globalPlanUpgradeSeen === true,
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function addRegisteredSession(context: BrowserContext) {
  await context.addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: sessionCookieValue(),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

function sessionCookieValue(): string {
  const expiresAt = Math.floor(Date.now() / 1_000) + 60 * 60;
  const accessToken = [
    encodeBase64Url({ alg: "HS256", typ: "JWT" }),
    encodeBase64Url({
      aud: "authenticated",
      email: REGISTERED_EMAIL,
      exp: expiresAt,
      role: "authenticated",
      sub: REGISTERED_USER_ID,
    }),
    "fixture-signature",
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "fixture-refresh-token",
    expires_at: expiresAt,
    expires_in: 60 * 60,
    token_type: "bearer",
    user: registeredUser(),
  };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function registeredUser() {
  return {
    id: REGISTERED_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: REGISTERED_EMAIL,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    last_sign_in_at: "2026-08-01T00:00:00.000Z",
    is_anonymous: false,
    app_metadata: { provider: "email" },
    user_metadata: {},
    identities: [{ provider: "email" }],
  };
}

function handleSupabaseRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://fixture.test");
  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    return request.headers.authorization?.startsWith("Bearer ")
      ? sendJson(response, 200, registeredUser())
      : sendJson(response, 401, { message: "Missing fixture session" });
  }
  return sendJson(response, 404, {
    code: "FIXTURE_ROUTE_NOT_FOUND",
    message: `${request.method ?? "UNKNOWN"} ${url.pathname}`,
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function rememberAppOutput(chunk: Buffer | string) {
  appOutput = `${appOutput}${chunk.toString()}`.slice(-20_000);
}

async function listenOnAvailablePort(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind a TCP port");
  }
  return address.port;
}

async function findAvailablePort(): Promise<number> {
  const server = createServer();
  const port = await listenOnAvailablePort(server);
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForApp(url: string, child: ChildProcess) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Fixture app exited early.\n${appOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Fixture app did not become ready.\n${appOutput}`);
}
