import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { expect, test, type Route } from "@playwright/test";

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
  await context.route("**/api/chat/messages?*", (route) =>
    fulfillJson(route, { messages: [] }),
  );
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
            anonymousTrial: { state: "available", remainingMessages: 2 },
            subscriptionPresentation: { state: "anonymous" },
          }),
    }),
  );
  await context.route("**/api/chat/stream", (route) => {
    streamRequests += 1;
    if (streamRequests === 1) {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({
            type: "anonymous_trial_admitted",
            reservationId: "018f3f4e-8454-7e8b-a98d-f319b5c32291",
            remainingMessages: 1,
          })}\n\n`,
          `data: ${JSON.stringify({ type: "delta", text: "Grounded answer" })}\n\n`,
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
  const input = page.getByLabel("Chat message");
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill("What is the main argument?");
  await page.getByLabel("Send message").click();
  await expect(page.getByText("Grounded answer")).toBeVisible();

  await input.fill("What else does the Video support?");
  await page.getByLabel("Send message").click();
  const createAccount = page.getByRole("link", { name: "Create Account" });
  await expect(createAccount).toBeVisible();
  await createAccount.click();

  await page.getByLabel("Email").fill("registered@example.com");
  await page.getByLabel("Password", { exact: true }).fill("safe-password-1");
  await page.getByLabel("Repeat Password").fill("safe-password-1");
  await page.getByRole("button", { name: /^Sign up$/ }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up-success/);

  await expect
    .poll(() => captures.length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(4);
  expect(captures).toEqual(
    expect.arrayContaining([
      {
        event: "anonymous_trial_message_admitted",
        properties: {
          source_surface: "hero_demo",
          remaining_allowance: "one",
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
    /main argument|registered@example|74000000|user_id|prompt|content/i,
  );
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
