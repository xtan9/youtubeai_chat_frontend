import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.test";
const ADMIN_USER_ID = "11111111-1111-4111-8111-111111111111";
const LEARNER_USER_ID = "22222222-2222-4222-8222-222222222222";
const AUTH_COOKIE_NAME = "sb-admin-report-e2e-auth-token";

let appProcess: ChildProcess | undefined;
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
        ADMIN_EMAILS: ADMIN_EMAIL,
        NEXT_PUBLIC_SITE_URL: appUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
        NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME: AUTH_COOKIE_NAME,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_TELEMETRY_DISABLED: "1",
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
  if (supabaseFixture) {
    await new Promise<void>((resolve, reject) => {
      supabaseFixture?.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("admin report exposes its degraded completeness status", async ({
  context,
  page,
}) => {
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

  await page.goto(`${appUrl}/admin`);

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const completenessStatus = page.getByRole("status").filter({
    hasText: "Report completeness",
  });
  await expect(completenessStatus).toBeVisible();
  await expect(completenessStatus).toContainText(
    "Cache-hit metrics are unavailable because summary enrichment failed.",
  );
});

async function handleSupabaseRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://fixture.test");

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    return sendJson(response, 200, authUser(ADMIN_USER_ID, ADMIN_EMAIL, true));
  }

  if (
    request.method === "GET" &&
    url.pathname === "/auth/v1/admin/users"
  ) {
    return sendJson(
      response,
      200,
      { users: [authUser(ADMIN_USER_ID, ADMIN_EMAIL, true)], aud: "authenticated" },
      { "x-total-count": "1" },
    );
  }

  if (
    request.method === "GET" &&
    url.pathname === `/auth/v1/admin/users/${LEARNER_USER_ID}`
  ) {
    return sendJson(
      response,
      200,
      authUser(LEARNER_USER_ID, "learner@example.test", false),
    );
  }

  if (
    request.method === "GET" &&
    url.pathname === "/rest/v1/user_video_history"
  ) {
    return sendJson(
      response,
      200,
      [
        {
          user_id: LEARNER_USER_ID,
          video_id: "fixture-video",
          created_at: "2026-08-01T12:00:00.000Z",
        },
      ],
      { "content-range": "0-0/1" },
    );
  }

  if (request.method === "GET" && url.pathname === "/rest/v1/summaries") {
    if (url.searchParams.get("select") === "video_id,created_at") {
      return sendJson(response, 500, {
        code: "FIXTURE_SUMMARY_ENRICHMENT_UNAVAILABLE",
        details: null,
        hint: null,
        message: "summary enrichment unavailable",
      });
    }
    return sendJson(response, 200, [], { "content-range": "*/0" });
  }

  return sendJson(response, 404, {
    code: "FIXTURE_ROUTE_NOT_FOUND",
    details: null,
    hint: null,
    message: `${request.method ?? "UNKNOWN"} ${url.pathname}`,
  });
}

function authUser(id: string, email: string, isAdmin: boolean) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    last_sign_in_at: "2026-08-01T00:00:00.000Z",
    is_anonymous: false,
    app_metadata: { provider: "email", is_admin: isAdmin },
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
    user: authUser(ADMIN_USER_ID, ADMIN_EMAIL, true),
  };

  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out starting Next.js fixture app:\n${output.join("")}`);
}
