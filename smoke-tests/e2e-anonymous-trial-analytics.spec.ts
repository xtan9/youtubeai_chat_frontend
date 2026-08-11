import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { expect, test, type Route } from "@playwright/test";
import { anonymousSessionFromCookies } from "./anonymous-trial-production-probe";

const DIST_DIR = ".next-anonymous-trial-analytics-e2e";
const captures: unknown[] = [];

let fixtureServer: Server | undefined;
let appProcess: ChildProcess | undefined;
let appUrl = "";

test.beforeAll(async () => {
  fixtureServer = createServer((_request, response) => {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: "FIXTURE_ROUTE_NOT_FOUND" }));
  });
  const fixturePort = await listenOnAvailablePort(fixtureServer);
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
    [nextCli, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(appPort)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NEXT_PUBLIC_ANALYTICS_E2E_DIAGNOSTICS: "1",
        NEXT_PUBLIC_SITE_URL: appUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
        NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME:
          "sb-anonymous-trial-analytics-fixture-auth-token",
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${fixturePort}`,
        NEXT_TELEMETRY_DISABLED: "1",
        WORKSPACE_E2E_DIST_DIR: DIST_DIR,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForApp(`${appUrl}/`, appProcess);
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
  await rm(DIST_DIR, { recursive: true, force: true });
});

test("captures the content-private admission, exhaustion, registration, and conversion journey", async ({
  context,
  page,
}) => {
  captures.length = 0;
  await context.exposeBinding(
    "__recordAnonymousTrialAnalytics",
    (_source, detail: unknown) => captures.push(detail),
  );
  await context.addInitScript(() => {
    window.addEventListener("project-analytics-capture-e2e", (event) => {
      void (
        window as typeof window & {
          __recordAnonymousTrialAnalytics: (detail: unknown) => Promise<void>;
        }
      ).__recordAnonymousTrialAnalytics((event as CustomEvent).detail);
    });
  });

  let registered = false;
  let streamRequests = 0;
  const histories = new Map<string, Array<Record<string, string>>>([
    ["Hrbq66XqtCo", []],
    ["nm1TxQj9IsQ", []],
  ]);
  await context.route("**/auth/v1/signup*", (route) =>
    fulfillJson(route, anonymousSession()),
  );
  await context.route("**/auth/v1/user*", (route) => {
    if (route.request().method() === "PUT") {
      registered = true;
      return fulfillJson(route, registeredUser());
    }
    return fulfillJson(
      route,
      registered ? registeredUser() : anonymousSession().user,
    );
  });
  await context.route("**/api/chat/messages?*", (route) => {
    const youtubeUrl = new URL(route.request().url()).searchParams.get("youtube_url");
    const videoId = youtubeUrl
      ? new URL(youtubeUrl).searchParams.get("v")
      : null;
    return fulfillJson(route, {
      messages: videoId ? histories.get(videoId) ?? [] : [],
    });
  });
  await context.route("**/api/me/entitlements*", (route) =>
    fulfillJson(route, {
      tier: registered ? "free" : "anon",
      caps: {
        summariesUsed: 0,
        summariesLimit: registered ? 10 : 1,
        projectsUsed: 0,
        projectsLimit: registered ? 3 : 0,
      },
      ...(registered
        ? {
            registeredFreeHeroDemoChat: {
              state: "available",
              remainingMessages: 5,
            },
            subscriptionPresentation: { state: "free" },
          }
        : {
            anonymousTrial: {
              state: "available",
              remainingMessages: Math.max(0, 5 - streamRequests),
            },
            subscriptionPresentation: { state: "anonymous" },
          }),
    }),
  );
  await context.route("**/api/chat/stream", (route) => {
    streamRequests += 1;
    if (streamRequests <= 5) {
      const body = route.request().postDataJSON() as {
        youtube_url: string;
        message: string;
      };
      const videoId = new URL(body.youtube_url).searchParams.get("v")!;
      const answer = `Grounded answer ${streamRequests} [0:42]`;
      const history = histories.get(videoId)!;
      history.push(
        browserMessage(`379${streamRequests}01`, "user", body.message),
        browserMessage(`379${streamRequests}02`, "assistant", answer),
      );
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            type: "anonymous_trial_admitted",
            reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
            remainingMessages: 5 - streamRequests,
          })}\n\n`,
          `data: ${JSON.stringify({ type: "delta", text: answer })}\n\n`,
          `data: ${JSON.stringify({ type: "done" })}\n\n`,
        ].join(""),
      });
    }
    return fulfillJson(
      route,
      {
        message: "You've used all 5 Anonymous Trial messages.",
        errorCode: "anonymous_trial_exhausted",
        tier: "anon",
        remainingMessages: 0,
        upgradeUrl: "/auth/sign-up",
      },
      402,
    );
  });

  await page.goto(appUrl + "/");
  await waitForAuthCookie(context);
  const input = page.getByLabel("Chat message");
  await expect(input).toBeVisible({ timeout: 30_000 });
  const send = async (question: string, answerNumber: number) => {
    await input.fill(question);
    await page.getByLabel("Send message").click();
    await expect(page.getByText(`Grounded answer ${answerNumber}`)).toBeVisible();
  };
  await send("Alpha question one", 1);
  await expect(
    page.getByRole("button", { name: "Seek video to [0:42]" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: /could not|couldn't|temporarily unavailable/i }),
  ).toHaveCount(0);
  await expect(page.getByText(/anonymous_trial_invalid_answer/i)).toHaveCount(0);
  await expect(page.getByText("4 Anonymous Trial messages remaining")).toBeVisible();
  await send("Alpha question two", 2);
  await expect(page.getByText("3 Anonymous Trial messages remaining")).toBeVisible();

  await page.getByRole("button", { name: /Master Your Sleep/i }).click();
  await expect(page.getByText("Alpha question one")).toHaveCount(0);
  await send("Beta question one", 3);
  await expect(page.getByText("2 Anonymous Trial messages remaining")).toBeVisible();

  await page.getByRole("button", { name: /Jensen Huang.*moat persist/i }).click();
  await expect(page.getByText("Alpha question one")).toBeVisible();
  await expect(page.getByText("Beta question one")).toHaveCount(0);
  await send("Alpha question three", 4);
  await expect(page.getByText("1 Anonymous Trial message remaining")).toBeVisible();
  await send("Alpha question four", 5);

  const createAccount = page.getByRole("link", { name: "Create Account" });
  await expect(createAccount).toBeVisible();
  const { access_token: anonymousAccessToken } =
    await anonymousSessionFromCookies(context);
  const sixth = await page.evaluate(async (accessToken) => {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        youtube_url: "https://www.youtube.com/watch?v=nm1TxQj9IsQ",
        message: "Sixth question",
      }),
    });
    return { status: response.status, body: await response.json() };
  }, anonymousAccessToken);
  expect(sixth).toMatchObject({
    status: 402,
    body: { errorCode: "anonymous_trial_exhausted", remainingMessages: 0 },
  });
  await createAccount.click();

  await page.getByLabel("Email").fill("registered@example.com");
  await page.getByLabel("Password", { exact: true }).fill("safe-password-1");
  await page.getByLabel("Repeat Password").fill("safe-password-1");
  await page.getByRole("button", { name: /^Sign up$/ }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up-success/);

  await expect
    .poll(() => captures.length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(10);
  expect(captures).toEqual(
    expect.arrayContaining([
      {
        event: "anonymous_trial_started",
        properties: { source_surface: "hero_demo" },
      },
      {
        event: "anonymous_trial_message_admitted",
        properties: {
          source_surface: "hero_demo",
          remaining_allowance: "two_to_four",
        },
      },
      {
        event: "anonymous_trial_exhausted",
        properties: { source_surface: "hero_demo" },
      },
      {
        event: "anonymous_trial_registration_selected",
        properties: { source_surface: "hero_demo" },
      },
      {
        event: "anonymous_trial_converted",
        properties: {
          source_surface: "hero_demo",
          registration_method: "email",
        },
      },
    ]),
  );
  expect(JSON.stringify(captures)).not.toMatch(
    /Alpha question|Beta question|Sixth question|registered@example|74000000|user_id|prompt|content/i,
  );
});

test("the kill switch denies without consuming or leaking output", async ({
  context,
  page,
}) => {
  await context.route("**/auth/v1/signup*", (route) =>
    fulfillJson(route, anonymousSession()),
  );
  await context.route("**/api/chat/messages?*", (route) =>
    fulfillJson(route, { messages: [] }),
  );
  await context.route("**/api/me/entitlements*", (route) =>
    fulfillJson(route, {
      tier: "anon",
      caps: {
        summariesUsed: 0,
        summariesLimit: 1,
        projectsUsed: 0,
        projectsLimit: 0,
      },
      anonymousTrial: { state: "available", remainingMessages: 4 },
      subscriptionPresentation: { state: "anonymous" },
    }),
  );
  await context.route("**/api/chat/stream", (route) =>
    fulfillJson(
      route,
      {
        message:
          "Anonymous chat is temporarily unavailable. Create an account to continue.",
        errorCode: "anonymous_trial_unavailable",
        remainingMessages: 4,
        upgradeUrl: "/auth/sign-up",
      },
      503,
    ),
  );

  await page.goto(appUrl + "/");
  await waitForAuthCookie(context);
  const input = page.getByLabel("Chat message");
  await expect(input).toBeVisible({ timeout: 30_000 });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/chat/stream") &&
      response.request().method() === "POST",
  );
  await input.fill("What does the selected Video support?");
  await page.getByLabel("Send message").click();
  const response = await responsePromise;

  await expect(
    page.locator(
      '[data-paywall-variant="chat-anonymous-trial-unavailable"]',
    ),
  ).toContainText("Anonymous chat is temporarily unavailable");
  expect(await response.json()).toMatchObject({
    errorCode: "anonymous_trial_unavailable",
    remainingMessages: 4,
  });
  await expect(page.getByText(/used all 5 Anonymous Trial messages/i)).toHaveCount(0);
  await expect(page.getByText(/Grounded answer|partial model output/i)).toHaveCount(0);
});

test("a trusted anonymous production probe is suppressed from business analytics", async ({
  context,
  page,
}) => {
  const suppressed: boolean[] = [];
  const syntheticCaptures: unknown[] = [];
  await context.exposeBinding(
    "__recordProbeSuppression",
    (_source, detail: boolean) => suppressed.push(detail),
  );
  expect(
    captures.filter(
      (capture) =>
        (capture as { event?: string }).event === "anonymous_trial_started",
    ),
  ).toHaveLength(1);
  await context.exposeBinding(
    "__recordProbeCapture",
    (_source, detail: unknown) => syntheticCaptures.push(detail),
  );
  await context.addInitScript(() => {
    window.addEventListener("project-analytics-suppression-e2e", (event) => {
      void (window as never as {
        __recordProbeSuppression: (detail: boolean) => Promise<void>;
      }).__recordProbeSuppression((event as CustomEvent<boolean>).detail);
    });
    window.addEventListener("project-analytics-capture-e2e", (event) => {
      void (window as never as {
        __recordProbeCapture: (detail: unknown) => Promise<void>;
      }).__recordProbeCapture((event as CustomEvent).detail);
    });
  });
  const session = anonymousSession();
  (session.user.app_metadata as Record<string, unknown>).is_smoke_account = true;
  await context.route("**/auth/v1/signup*", (route) => fulfillJson(route, session));
  await context.route("**/auth/v1/user*", (route) => fulfillJson(route, session.user));
  await context.route("**/api/chat/messages?*", (route) =>
    fulfillJson(route, { messages: [] }),
  );
  await context.route("**/api/me/entitlements*", (route) =>
    fulfillJson(route, {
      tier: "anon",
      caps: { summariesUsed: 0, summariesLimit: 1, projectsUsed: 0, projectsLimit: 0 },
      anonymousTrial: { state: "available", remainingMessages: 5 },
      subscriptionPresentation: { state: "anonymous" },
    }),
  );
  await context.route("**/api/chat/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({
          type: "anonymous_trial_admitted",
          reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
          remainingMessages: 4,
        })}\n\n`,
        `data: ${JSON.stringify({ type: "delta", text: "Synthetic answer [0:42]" })}\n\n`,
        `data: ${JSON.stringify({ type: "done" })}\n\n`,
      ].join(""),
    }),
  );

  await page.goto(appUrl + "/");
  await expect.poll(() => suppressed.includes(true)).toBe(true);
  syntheticCaptures.length = 0;
  await page.getByLabel("Chat message").fill("Synthetic probe question");
  await page.getByLabel("Send message").click();
  await expect(page.getByText("Synthetic answer")).toBeVisible();
  expect(syntheticCaptures).toEqual([]);
});

test("Pro chat remains unlimited without trial or upgrade controls", async ({
  context,
  page,
}) => {
  let completed = false;
  await context.route("**/auth/v1/signup*", (route) =>
    fulfillJson(route, registeredSession()),
  );
  await context.route("**/auth/v1/user*", (route) =>
    fulfillJson(route, registeredUser()),
  );
  await context.route("**/api/chat/messages?*", (route) =>
    fulfillJson(route, {
      messages: completed
        ? [
            {
              id: "37900000-0000-4000-8000-000000000001",
              role: "user",
              content: "What is the main argument?",
              createdAt: "2026-08-11T00:00:00.000Z",
            },
            {
              id: "37900000-0000-4000-8000-000000000002",
              role: "assistant",
              content: "Pro grounded answer",
              createdAt: "2026-08-11T00:00:01.000Z",
            },
          ]
        : [],
    }),
  );
  await context.route("**/api/me/entitlements*", (route) =>
    fulfillJson(route, {
      tier: "pro",
      caps: {
        summariesUsed: 0,
        summariesLimit: -1,
        projectsUsed: 1,
        projectsLimit: -1,
      },
      subscriptionPresentation: {
        state: "active_pro",
        plan: "monthly",
        renewsAt: "2026-09-01T00:00:00.000Z",
      },
    }),
  );
  await context.route("**/api/chat/stream", (route) => {
    completed = true;
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ type: "delta", text: "Pro grounded answer" })}\n\n`,
        `data: ${JSON.stringify({ type: "done" })}\n\n`,
      ].join(""),
    });
  });

  await page.goto(appUrl + "/");
  await waitForAuthCookie(context);
  const input = page.getByLabel("Chat message");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Anonymous Trial messages remaining/i)).toHaveCount(0);
  await expect(page.getByText(/free messages used|5\/5 free chat messages/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create account|upgrade to pro/i })).toHaveCount(0);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/chat/stream") &&
      response.request().method() === "POST",
  );
  await input.fill("What is the main argument?");
  await page.getByLabel("Send message").click();
  expect((await responsePromise).status()).toBe(200);
  await expect(page.getByText("Pro grounded answer")).toBeVisible();
});

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function anonymousSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: "anonymous-trial-analytics-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: "anonymous-trial-analytics-refresh",
    user: {
      id: "74000000-0000-4000-8000-000000000003",
      aud: "authenticated",
      role: "authenticated",
      email: "",
      phone: "",
      app_metadata: { provider: "anonymous", providers: ["anonymous"] },
      user_metadata: {},
      identities: [],
      created_at: new Date(now * 1000).toISOString(),
      updated_at: new Date(now * 1000).toISOString(),
      is_anonymous: true,
    },
  };
}

function registeredUser() {
  return {
    ...anonymousSession().user,
    email: "registered@example.com",
    is_anonymous: false,
    app_metadata: { provider: "email", providers: ["email"] },
    identities: [
      {
        identity_id: "registered-email-identity",
        provider: "email",
        user_id: anonymousSession().user.id,
      },
    ],
  };
}

function registeredSession() {
  return { ...anonymousSession(), user: registeredUser() };
}

function browserMessage(
  suffix: string,
  role: "user" | "assistant",
  content: string,
) {
  return {
    id: `37900000-0000-4000-8000-${suffix.padStart(12, "0")}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

async function waitForAuthCookie(
  context: import("@playwright/test").BrowserContext,
) {
  await expect
    .poll(
      async () =>
        (await context.cookies()).some((cookie) =>
          /^sb-.*-auth-token$/.test(cookie.name),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
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
      // The fixture app is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out starting Next.js:\n${output.join("")}`);
}
