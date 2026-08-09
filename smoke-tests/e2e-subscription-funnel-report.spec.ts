import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS } from "../lib/analytics/subscription-funnel-query";

const ADMIN_EMAIL = "admin@example.test";
const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111111";
const AUTH_COOKIE_NAME = "sb-fixture-auth-token";
const RELEASE_AT = "2026-07-01T12:00:00.000Z";

const CURRENT_EVENTS = [180, 82, 70, 45, 33, 24] as const;
const CURRENT_LEARNERS = [120, 76, 68, 42, 31, 24] as const;
const BASELINE_EVENTS = [142, 67, 58, 34, 22, 16] as const;
const BASELINE_LEARNERS = [100, 60, 52, 31, 20, 15] as const;
const CURRENT_PROGRESSIONS = [76, 65, 40, 29, 21] as const;
const BASELINE_PROGRESSIONS = [60, 50, 29, 18, 14] as const;

let postHogMode: "success" | "failure" = "success";

let appProcess: ChildProcess | undefined;
let appUrl = "";
let fixtureServer: Server | undefined;

test.beforeAll(async () => {
  fixtureServer = createServer(handleFixtureRequest);
  const fixturePort = await listenOnAvailablePort(fixtureServer);
  const fixtureUrl = `http://127.0.0.1:${fixturePort}`;
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
        ADMIN_EMAILS: ADMIN_EMAIL,
        NEXT_PUBLIC_SITE_URL: appUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
        NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME: AUTH_COOKIE_NAME,
        NEXT_PUBLIC_SUPABASE_URL: fixtureUrl,
        NEXT_TELEMETRY_DISABLED: "1",
        POSTHOG_PERSONAL_API_KEY: "phx_fixture",
        POSTHOG_PROJECT_ID: "fixture-project",
        POSTHOG_QUERY_HOST: fixtureUrl,
        SUBSCRIPTION_FUNNEL_RELEASE_AT: RELEASE_AT,
        SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitForApp(`${appUrl}/auth/login`, appProcess);
});

test.afterAll(async () => {
  if (appProcess && appProcess.exitCode === null) {
    appProcess.kill();
    await Promise.race([
      once(appProcess, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  if (fixtureServer) {
    await new Promise<void>((resolve, reject) => {
      fixtureServer?.close((error) =>
        error ? reject(error) : resolve(),
      );
    });
  }
});

test.beforeEach(async ({ context }) => {
  postHogMode = "success";
  await context.route("**/api/me/entitlements", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tier: "free",
        caps: {
          summariesUsed: 0,
          summariesLimit: 10,
          historyUsed: 0,
          historyLimit: 10,
          projectsUsed: 0,
          projectsLimit: 1,
        },
        subscriptionPresentation: { state: "free" },
      }),
    });
  });
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
});

test("desktop report tells the complete fourteen-day conversion story", async ({
  page,
}, testInfo) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const response = await page.goto(`${appUrl}/admin/subscriptions?window=14`);
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("heading", { level: 1, name: "Subscription conversion" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "14d" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".subscription-funnel-stage")).toHaveCount(6);
  await expect(page.getByText("Plan control viewed")).toBeVisible();
  await expect(page.getByText("Subscription activated")).toBeVisible();
  await expect(page.getByText("Current failures")).toBeVisible();
  await expect(page.getByText("Network error")).toBeVisible();
  await expect(
    page.locator(".subscription-funnel-loss").filter({
      has: page.getByText(/base$/),
    }),
  ).toHaveCount(5);
  await expect(
    page.getByRole("rowheader", { name: "Stripe webhook", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("rowheader", { name: "Unattributed", exact: true }).first(),
  ).toBeVisible();

  for (const segment of [
    "Source surface",
    "Presentation state",
    "Authentication state",
    "Device class",
    "Plan",
    "Billing interval",
  ]) {
    await expect(
      page.getByRole("heading", { level: 3, name: segment, exact: true }),
    ).toBeVisible();
  }

  const activeNavigation = page.locator(".sb-item.active");
  await expect(activeNavigation).toHaveText("Subscription funnel");
  await expect(
    page.getByText(/Smoke Account activity is excluded from every metric/i),
  ).toBeVisible();
  expect(consoleErrors).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath("subscription-funnel-desktop.png"),
    fullPage: true,
  });
});

test("provider failure renders a deterministic non-partial report boundary", async ({
  page,
}) => {
  postHogMode = "failure";
  const response = await page.goto(`${appUrl}/admin/subscriptions?window=7`);
  expect(response?.status()).toBe(500);
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Subscription report unavailable",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("No partial funnel is shown.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry report" })).toBeVisible();
});

test("mobile report contains wide data locally and switches comparison window", async ({
  page,
}, testInfo) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto(`${appUrl}/admin/subscriptions?window=7`);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Subscription conversion" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "7d" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const funnelCard = page.locator(".subscription-funnel-card");
  await expect(funnelCard).toBeVisible();
  expect(
    await funnelCard.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.getByRole("link", { name: "14d" }).click();
  await expect(page).toHaveURL(/\/admin\/subscriptions\?window=14$/);
  await expect(page.getByRole("link", { name: "14d" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Checkout failures")).toBeVisible();
  expect(consoleErrors).toEqual([]);

  await page.screenshot({
    path: testInfo.outputPath("subscription-funnel-mobile.png"),
    fullPage: true,
  });
});

function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://fixture.test");

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    return sendJson(response, 200, authUser());
  }

  if (
    request.method === "GET" &&
    url.pathname === "/auth/v1/admin/users"
  ) {
    return sendJson(
      response,
      200,
      { users: [authUser()], aud: "authenticated" },
      { "x-total-count": "1" },
    );
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/projects/fixture-project/query/"
  ) {
    if (request.headers.authorization !== "Bearer phx_fixture") {
      return sendJson(response, 401, { detail: "invalid fixture key" });
    }
    const body = JSON.parse(await readRequestBody(request)) as {
      query?: { kind?: string; query?: string };
      name?: string;
    };
    if (
      body.query?.kind !== "HogQLQuery" ||
      !body.query.query?.includes("subscription_activated") ||
      !body.query.query.includes("synthetic_smoke_account") ||
      !body.name?.startsWith("subscription_conversion_funnel_")
    ) {
      return sendJson(response, 400, { detail: "invalid fixture query" });
    }
    if (postHogMode === "failure") {
      return sendJson(response, 503, {
        detail: "deterministic analytics outage",
      });
    }
    if (body.name.includes("ordered_progression")) {
      if (!body.query.query.includes("windowFunnel")) {
        return sendJson(response, 400, {
          detail: "progression query is not ordered",
        });
      }
      return sendJson(response, 200, {
        columns: [
          "period",
          "segment_dimension",
          "segment_value",
          "progressed_subscription_discovery_clicked",
          "progressed_pricing_viewed",
          "progressed_plan_choice_attempted",
          "progressed_checkout_started",
          "progressed_subscription_activated",
        ],
        results: subscriptionProgressionRows(),
        is_cached: false,
      });
    }
    if (!body.name.includes("stage_counts")) {
      return sendJson(response, 400, { detail: "unknown fixture query" });
    }
    return sendJson(response, 200, {
      columns: [
        "period",
        "event",
        "segment_dimension",
        "segment_value",
        "event_count",
        "learner_count",
      ],
      results: subscriptionFunnelRows(),
      is_cached: false,
    });
  }

  return sendJson(response, 404, {
    code: "FIXTURE_ROUTE_NOT_FOUND",
    details: null,
    hint: null,
    message: `${request.method ?? "UNKNOWN"} ${url.pathname}`,
  });
}

function subscriptionFunnelRows(): unknown[][] {
  const rows: unknown[][] = [];
  appendStageRows(rows, "overall", "all");

  for (const [dimension, value] of [
    ["source_surface", "global_header"],
    ["presentation_state", "upgrade_to_pro"],
    ["authentication_state", "registered"],
    ["device_class", "desktop"],
  ] as const) {
    appendStageRows(rows, dimension, value);
  }

  for (const [dimension, value] of [
    ["plan", "yearly"],
    ["billing_interval", "yearly"],
  ] as const) {
    appendStageRows(rows, dimension, value, 3);
  }

  rows.push(
    ["current", "checkout_started", "source_surface", "pricing", 2, 2],
    [
      "baseline",
      "subscription_activated",
      "source_surface",
      "stripe_webhook",
      1,
      1,
    ],
    [
      "current",
      "checkout_started",
      "presentation_state",
      "unattributed",
      2,
      2,
    ],
    [
      "baseline",
      "subscription_activated",
      "device_class",
      "unattributed",
      1,
      1,
    ],
  );

  rows.push(
    [
      "current",
      "checkout_failed",
      "failure_category",
      "network_error",
      7,
      6,
    ],
    [
      "baseline",
      "checkout_failed",
      "failure_category",
      "network_error",
      4,
      3,
    ],
  );
  return rows;
}

function subscriptionProgressionRows(): unknown[][] {
  const rows: unknown[][] = [];
  appendProgressionRows(rows, "overall", "all");

  for (const [dimension, value] of [
    ["source_surface", "global_header"],
    ["presentation_state", "upgrade_to_pro"],
    ["authentication_state", "registered"],
    ["device_class", "desktop"],
  ] as const) {
    appendProgressionRows(rows, dimension, value);
  }

  for (const [dimension, value] of [
    ["plan", "yearly"],
    ["billing_interval", "yearly"],
  ] as const) {
    appendProgressionRows(rows, dimension, value, 3);
  }

  return rows;
}

function appendStageRows(
  rows: unknown[][],
  dimension: string,
  value: string,
  firstStageIndex = 0,
) {
  SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.forEach((event, index) => {
    if (index < firstStageIndex) return;
    rows.push(
      [
        "current",
        event,
        dimension,
        value,
        CURRENT_EVENTS[index],
        CURRENT_LEARNERS[index],
      ],
      [
        "baseline",
        event,
        dimension,
        value,
        BASELINE_EVENTS[index],
        BASELINE_LEARNERS[index],
      ],
    );
  });
  rows.push(
    ["current", "checkout_failed", dimension, value, 7, 6],
    ["baseline", "checkout_failed", dimension, value, 4, 3],
  );
}

function appendProgressionRows(
  rows: unknown[][],
  dimension: string,
  value: string,
  firstStageIndex = 0,
) {
  rows.push(
    [
      "current",
      dimension,
      value,
      ...CURRENT_PROGRESSIONS.map((count, index) =>
        index + 1 <= firstStageIndex ? 0 : count,
      ),
    ],
    [
      "baseline",
      dimension,
      value,
      ...BASELINE_PROGRESSIONS.map((count, index) =>
        index + 1 <= firstStageIndex ? 0 : count,
      ),
    ],
  );
}

function authUser() {
  return {
    id: ADMIN_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: ADMIN_EMAIL,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    last_sign_in_at: "2026-08-01T00:00:00.000Z",
    is_anonymous: false,
    app_metadata: { provider: "email", is_admin: true },
    user_metadata: {},
    identities: [{ provider: "email" }],
  };
}

function sessionCookieValue(): string {
  const expiresAt = Math.floor(Date.now() / 1_000) + 60 * 60;
  const accessToken = [
    encodeBase64Url({ alg: "HS256", typ: "JWT" }),
    encodeBase64Url({
      aud: "authenticated",
      email: ADMIN_EMAIL,
      exp: expiresAt,
      role: "authenticated",
      sub: ADMIN_USER_ID,
    }),
    "fixture-signature",
  ].join(".");
  const session = {
    access_token: accessToken,
    refresh_token: "fixture-refresh-token",
    expires_at: expiresAt,
    expires_in: 60 * 60,
    token_type: "bearer",
    user: authUser(),
  };

  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
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

async function waitForApp(url: string, process: ChildProcess) {
  const output: string[] = [];
  process.stdout?.on("data", (chunk) => output.push(String(chunk)));
  process.stderr?.on("data", (chunk) => output.push(String(chunk)));

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(
        `Next.js fixture app exited with ${process.exitCode}:\n${output.join("")}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out starting Next.js fixture app:\n${output.join("")}`);
}
