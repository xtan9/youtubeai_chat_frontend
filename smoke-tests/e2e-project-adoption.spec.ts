import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const SMOKE_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const AUTH_COOKIE_NAME = "sb-project-adoption-fixture-auth-token";
const ADMIN_EMAIL = "admin@example.test";

const METRIC_COLUMNS = [
  "projects_created",
  "activated_projects",
  "searches",
  "messages",
  "first_messages",
  "subsequent_messages",
  "artifacts",
  "citation_clicks",
  "helpful_feedback",
  "not_helpful_feedback",
  "paywall_views",
  "sources_added",
  "history_sources_added",
  "youtube_url_sources_added",
  "ready_sources_added",
  "processing_sources_added",
  "search_results",
  "search_passages_examined",
  "grounded_answers",
  "coverage_integrity_answers",
  "grounded_total_videos",
  "grounded_ready_videos",
  "grounded_used_videos",
  "grounded_unavailable_videos",
  "grounded_passages_examined",
  "grounded_passages_used",
  "citation_diagnostics",
  "answers_with_citation_diagnostics",
  "processing_succeeded",
  "processing_failed",
  "generation_events",
  "measured_generations",
  "cost_eligible_activated_projects",
  "generation_duration_ms",
  "cost_usd_micros",
] as const;

let fixtureServer: Server | undefined;
let appProcess: ChildProcess | undefined;
let appUrl = "";

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
  const env = {
    ...process.env,
    ADMIN_EMAILS: ADMIN_EMAIL,
    NEXT_PUBLIC_ANALYTICS_E2E_DIAGNOSTICS: "1",
    NEXT_PUBLIC_SITE_URL: appUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
    NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME: AUTH_COOKIE_NAME,
    NEXT_PUBLIC_SUPABASE_URL: fixtureUrl,
    NEXT_TELEMETRY_DISABLED: "1",
    POSTHOG_PERSONAL_API_KEY: "phx_fixture",
    POSTHOG_PROJECT_ID: "fixture-project",
    POSTHOG_QUERY_HOST: fixtureUrl,
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role-key",
    WORKSPACE_E2E_DIST_DIR: ".next-project-adoption-e2e",
  };

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
    { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
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
      fixtureServer?.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test.beforeEach(async ({ context }) => {
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
});

test("captures only a governed Project failure for a human account", async ({
  context,
  page,
}) => {
  await installAnalyticsProbe(context);
  await addSessionCookie(context, OWNER_ID, ADMIN_EMAIL);
  await context.route("**/api/workspace/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ message: "Try again later." }),
    });
  });

  await page.goto(`${appUrl}/workspace`);
  await waitForSuppression(page, false);
  await clearCapturedEvents(page);
  await page.getByRole("button", { name: "Create Project" }).first().click();
  await page.getByLabel("Project name").fill("Private launch research");
  await page.getByLabel("Project Goal").fill("A private unreleased hypothesis");
  await page.getByRole("button", { name: "Create Project" }).last().click();

  await expect(page.getByRole("alert")).toContainText("Try again later");
  const captured = await waitForCapturedEvent(page, "project_action_failed");
  expect(captured).toContain("rate_limit");
  expect(captured).not.toContain("Private launch research");
  expect(captured).not.toContain("private unreleased hypothesis");
});

test("suppresses the same business event for a trusted Smoke Account", async ({
  context,
  page,
}) => {
  await installAnalyticsProbe(context);
  await addSessionCookie(context, SMOKE_ID, "smoke@example.test");
  await context.route("**/api/workspace/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ message: "Try again later." }),
    });
  });

  await page.goto(`${appUrl}/workspace`);
  await waitForSuppression(page, true);
  await clearCapturedEvents(page);
  await page.getByRole("button", { name: "Create Project" }).first().click();
  await page.getByLabel("Project name").fill("Synthetic private research");
  await page.getByRole("button", { name: "Create Project" }).last().click();
  await expect(page.getByRole("alert")).toContainText("Try again later");
  expect(await capturedEvents(page)).not.toContain("project_action_failed");
});

test("protects and switches the complete 7d and 30d Project report", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, ADMIN_EMAIL);
  await page.goto(`${appUrl}/admin/projects?window=7`);

  await expect(page.getByRole("heading", { name: "Project adoption" })).toBeVisible();
  await expect(page.getByRole("link", { name: "7d" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("Seven-day return")).toBeVisible();
  await expect(page.getByText("75.0%")).toBeVisible();
  await expect(page.getByText("Source Coverage integrity")).toBeVisible();
  await expect(page.getByText("Processing failure rate")).toBeVisible();
  await expect(page.getByText("Sources added")).toBeVisible();
  await expect(page.getByText("Ready when added")).toBeVisible();
  await expect(page.getByText("Processing when added")).toBeVisible();
  await expect(page.getByText("Ready-at-add rate")).toBeVisible();
  await expect(page.getByText("Active Projects in window")).toBeVisible();
  await expect(page.getByText("Cost per active Project")).toBeVisible();
  await expect(page.getByRole("table", { name: "Project failure classes" }))
    .toContainText("Quota");

  await page.getByRole("link", { name: "30d" }).click();
  await expect(page).toHaveURL(/\/admin\/projects\?window=30$/u);
  await expect(page.getByRole("link", { name: "30d" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("redirects a non-admin away from the Project report", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, SMOKE_ID, "smoke@example.test");
  await page.goto(`${appUrl}/admin/projects?window=7`);
  await expect(page).toHaveURL(`${appUrl}/dashboard`);
  await expect(page.getByRole("heading", { name: "Project adoption" }))
    .toHaveCount(0);
});

async function installAnalyticsProbe(context: BrowserContext) {
  await context.addInitScript(() => {
    const state = window as typeof window & {
      __projectAnalyticsCaptures?: unknown[];
      __projectAnalyticsSuppression?: boolean;
    };
    state.__projectAnalyticsCaptures = [];
    window.addEventListener("project-analytics-capture-e2e", (event) => {
      state.__projectAnalyticsCaptures?.push((event as CustomEvent).detail);
    });
    window.addEventListener("project-analytics-suppression-e2e", (event) => {
      state.__projectAnalyticsSuppression = Boolean((event as CustomEvent).detail);
    });
  });
}

async function waitForSuppression(
  page: import("@playwright/test").Page,
  expected: boolean,
) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __projectAnalyticsSuppression?: boolean })
          .__projectAnalyticsSuppression,
      ),
    )
    .toBe(expected);
}

async function clearCapturedEvents(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    (
      window as typeof window & { __projectAnalyticsCaptures?: unknown[] }
    ).__projectAnalyticsCaptures = [];
  });
}

async function capturedEvents(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    JSON.stringify(
      (window as typeof window & { __projectAnalyticsCaptures?: unknown[] })
        .__projectAnalyticsCaptures ?? [],
    ),
  );
}

async function waitForCapturedEvent(
  page: import("@playwright/test").Page,
  event: string,
) {
  await expect.poll(async () => (await capturedEvents(page)).includes(event)).toBe(true);
  return capturedEvents(page);
}

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://fixture.test");
  const userId = requestUserId(request);

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    if (!userId) return sendJson(response, 401, { message: "Missing session" });
    return sendJson(
      response,
      200,
      authUser(
        userId,
        userId === OWNER_ID ? ADMIN_EMAIL : "smoke@example.test",
      ),
    );
  }

  if (request.method === "GET" && url.pathname === "/rest/v1/workspaces") {
    return sendJson(response, 200, userId ? [{ id: WORKSPACE_ID }] : []);
  }
  if (request.method === "GET" && url.pathname === "/rest/v1/projects") {
    return sendJson(response, 200, []);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/api/projects/fixture-project/query/"
  ) {
    const body = JSON.parse(await readRequestBody(request)) as {
      name?: string;
      query?: { query?: string };
    };
    const query = body.query?.query ?? "";
    if (
      !query.includes("synthetic_smoke_account") ||
      !query.includes("project_id")
    ) {
      return sendJson(response, 400, { detail: "unsafe Project query" });
    }
    if (body.name?.includes("seven_day_return")) {
      if (
        !query.includes("INTERVAL 7 DAY") ||
        !query.includes("INTERVAL 8 DAY") ||
        !query.includes("project_opened") ||
        !query.includes("activated_at <=")
      ) {
        return sendJson(response, 400, { detail: "invalid return query" });
      }
      return sendJson(response, 200, {
        columns: ["eligible_activated_projects", "returned_projects"],
        results: [[4, 3]],
        is_cached: false,
      });
    }
    if (body.name?.includes("failures")) {
      return sendJson(response, 200, {
        columns: ["error_class", "events", "projects"],
        results: [["quota", 3, 2]],
        is_cached: false,
      });
    }
    if (body.name?.includes("metrics")) {
      for (const required of [
        "project_grounded_answer_completed",
        "project_source_added",
        "project_video_processing_succeeded",
        "project_generation_cost_recorded",
        "cost_eligible_activated_projects",
      ]) {
        if (!query.includes(required)) {
          return sendJson(response, 400, { detail: "incomplete metrics query" });
        }
      }
      return sendJson(response, 200, {
        columns: METRIC_COLUMNS,
        results: [[
          10, 6, 20, 12, 4, 8, 5, 7, 8, 2, 3, 20, 8, 12, 7, 13, 30, 100, 10, 9,
          25, 20, 15, 5, 80, 25, 4, 3, 18, 2, 6, 5, 4, 2400, 120000,
        ]],
        is_cached: false,
      });
    }
    return sendJson(response, 400, { detail: "unknown Project query" });
  }

  return sendJson(response, 404, {
    code: "FIXTURE_ROUTE_NOT_FOUND",
    message: `${request.method ?? "UNKNOWN"} ${url.pathname}`,
  });
}

function authUser(id: string, email: string) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    last_sign_in_at: "2026-08-01T00:00:00.000Z",
    is_anonymous: false,
    app_metadata: {
      provider: "email",
      ...(id === SMOKE_ID ? { is_smoke_account: true } : {}),
    },
    user_metadata: {},
    identities: [{ provider: "email" }],
  };
}

function requestUserId(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { sub?: unknown };
    return typeof parsed.sub === "string" ? parsed.sub : null;
  } catch {
    return null;
  }
}

async function addSessionCookie(
  context: BrowserContext,
  userId: string,
  email: string,
) {
  await context.addCookies([
    {
      name: AUTH_COOKIE_NAME,
      value: sessionCookieValue(userId, email),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

function sessionCookieValue(userId: string, email: string) {
  const expiresAt = Math.floor(Date.now() / 1_000) + 60 * 60;
  const accessToken = [
    encodeBase64Url({ alg: "HS256", typ: "JWT" }),
    encodeBase64Url({
      aud: "authenticated",
      email,
      exp: expiresAt,
      role: "authenticated",
      sub: userId,
    }),
    "fixture-signature",
  ].join(".");
  return `base64-${Buffer.from(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: "fixture-refresh-token",
      expires_at: expiresAt,
      expires_in: 3600,
      token_type: "bearer",
      user: authUser(userId, email),
    }),
  ).toString("base64url")}`;
}

function encodeBase64Url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listenOnAvailablePort(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind a port");
  }
  return address.port;
}

async function findAvailablePort() {
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
      throw new Error(`Next.js exited with ${process.exitCode}:\n${output.join("")}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The production fixture is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out starting Next.js:\n${output.join("")}`);
}
