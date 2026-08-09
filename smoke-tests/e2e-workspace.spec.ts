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

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "20000000-0000-4000-8000-000000000002";
const OWNER_WORKSPACE_ID = "b0000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "b0000000-0000-4000-8000-000000000002";

type FixtureProject = {
  id: string;
  workspace_id: string;
  name: string;
  goal: string | null;
  created_at: string;
  updated_at: string;
  last_active_at: string;
};

const projects: FixtureProject[] = [];
let projectSequence = 0;
let clockSequence = 0;
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
        NEXT_PUBLIC_SITE_URL: appUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        NEXT_TELEMETRY_DISABLED: "1",
        WORKSPACE_E2E_DIST_DIR: ".next-workspace-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitForApp(`${appUrl}/auth/login`, appProcess);
});

test.beforeEach(() => {
  projects.splice(0);
  projectSequence = 0;
  clockSequence = 0;
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

test("registered Researcher completes a private responsive Project lifecycle", async ({
  browser,
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  await page.goto(`${appUrl}/workspace`);

  await expect(
    page.getByRole("heading", { name: "Your research, ready to resume" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Start your first Project" })).toBeVisible();

  const emptyCreate = page.getByRole("button", { name: "Create Project" });
  await emptyCreate.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Create a Project" })).toBeVisible();
  await page.getByLabel("Project name").fill("Evidence review");
  await page.getByLabel("Project Goal (optional)").fill("Compare the two explanations.");
  await page.getByRole("button", { name: "Create Project" }).last().click();

  const firstCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "Evidence review" }) });
  await expect(firstCard).toContainText("Compare the two explanations.");

  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Project name").fill("Creator brief");
  await page.getByLabel("Project Goal (optional)").fill("Find an original angle.");
  await page.getByRole("button", { name: "Create Project" }).last().click();

  const recentHeadings = page.locator('[aria-labelledby="recent-projects-heading"] h3');
  await expect(recentHeadings).toHaveText(["Creator brief", "Evidence review"]);

  await firstCard.getByRole("link", { name: "Open Evidence review" }).click();
  await expect(page).toHaveURL(/\/workspace\/projects\/a0000000-0000-4000-8000-000000000001$/);
  await expect(page.getByRole("heading", { name: "Evidence review", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Guidance, not evidence" })).toBeVisible();
  await expect(page.getByText("Only Project sources can support grounded claims.")).toBeVisible();

  await page.getByLabel("Project name").fill("Evidence synthesis");
  await page.getByLabel("Project Goal (optional)").fill("Map agreement and disagreement.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  await expect(page.getByRole("heading", { name: "Evidence synthesis", level: 1 })).toBeVisible();

  const projectId = projects.find((project) => project.name === "Evidence synthesis")?.id;
  expect(projectId).toBeTruthy();
  if (!projectId) return;

  const otherContext = await browser.newContext();
  try {
    await addSessionCookie(otherContext, OTHER_ID, "other@example.test");
    const otherPage = await otherContext.newPage();
    await otherPage.goto(`${appUrl}/workspace/projects/${projectId}`);
    await expect(otherPage.getByRole("heading", { name: "Project not found" })).toBeVisible();

    const crossOwnerUpdate = await otherContext.request.patch(
      `${appUrl}/api/projects/${projectId}`,
      { data: { name: "Taken" } },
    );
    expect(crossOwnerUpdate.status()).toBe(404);
    expect(await crossOwnerUpdate.json()).toMatchObject({ outcome: "missing" });
  } finally {
    await otherContext.close();
  }

  await page.getByRole("link", { name: "Back to Workspace" }).click();
  await expect(page).toHaveURL(`${appUrl}/workspace`);
  await expect(recentHeadings).toHaveText(["Evidence synthesis", "Creator brief"]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Create Project" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  const renamedCard = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("heading", { name: "Evidence synthesis" }) });
  await renamedCard.getByRole("link", { name: "Open Evidence synthesis" }).click();
  await page.getByRole("button", { name: "Delete Project" }).click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete “Evidence synthesis”?",
  });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete Project" }).click();
  await expect(page).toHaveURL(`${appUrl}/workspace`);
  await expect(page.getByRole("heading", { name: "Evidence synthesis" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Creator brief" })).toBeVisible();

  await page.goto(`${appUrl}/workspace/projects/not-a-project-id`);
  await expect(
    page.getByRole("heading", { name: "That Project link isn’t valid" }),
  ).toBeVisible();
});

test("visitor is sent to sign in before Workspace data is loaded", async ({ page }) => {
  await page.goto(`${appUrl}/workspace`);
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
});

async function handleSupabaseRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://fixture.test");
  const userId = requestUserId(request);

  if (request.method === "GET" && url.pathname === "/auth/v1/user") {
    if (!userId) {
      return sendJson(response, 401, { message: "Missing fixture session" });
    }
    return sendJson(
      response,
      200,
      authUser(
        userId,
        userId === OWNER_ID ? "owner@example.test" : "other@example.test",
      ),
    );
  }

  if (url.pathname === "/rest/v1/workspaces" && request.method === "GET") {
    const requestedOwner = filterValue(url, "owner_id");
    if (!userId || requestedOwner !== userId) return sendJson(response, 200, []);
    const id = userId === OWNER_ID ? OWNER_WORKSPACE_ID : OTHER_WORKSPACE_ID;
    return sendJson(response, 200, [{ id }]);
  }

  if (url.pathname === "/rest/v1/projects") {
    return handleProjects(request, response, url, userId);
  }

  return sendJson(response, 404, {
    code: "FIXTURE_ROUTE_NOT_FOUND",
    message: `${request.method ?? "UNKNOWN"} ${url.pathname}`,
  });
}

async function handleProjects(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  userId: string | null,
) {
  const userWorkspace =
    userId === OWNER_ID
      ? OWNER_WORKSPACE_ID
      : userId === OTHER_ID
        ? OTHER_WORKSPACE_ID
        : null;
  const workspaceFilter = filterValue(url, "workspace_id");
  const idFilter = filterValue(url, "id");
  const visible = projects.filter(
    (project) =>
      project.workspace_id === userWorkspace &&
      (!workspaceFilter || project.workspace_id === workspaceFilter) &&
      (!idFilter || project.id === idFilter),
  );

  if (request.method === "GET") {
    const ordered = [...visible].sort(
      (a, b) =>
        b.last_active_at.localeCompare(a.last_active_at) || b.id.localeCompare(a.id),
    );
    return sendJson(response, 200, ordered);
  }

  if (request.method === "POST") {
    const body = (await readJson(request)) as { workspace_id?: string; name?: string; goal?: string | null };
    if (!userWorkspace || body.workspace_id !== userWorkspace || !body.name) {
      return sendJson(response, 403, postgrestError("42501", "row-level security denied insert"));
    }
    projectSequence += 1;
    const id = `a0000000-0000-4000-8000-${String(projectSequence).padStart(12, "0")}`;
    const timestamp = nextTimestamp();
    const project: FixtureProject = {
      id,
      workspace_id: userWorkspace,
      name: body.name,
      goal: body.goal ?? null,
      created_at: timestamp,
      updated_at: timestamp,
      last_active_at: timestamp,
    };
    projects.push(project);
    return sendJson(response, 201, project);
  }

  if (request.method === "PATCH") {
    const body = (await readJson(request)) as Partial<FixtureProject>;
    if (visible.length !== 1) return sendJson(response, 200, []);
    const project = visible[0];
    if (body.name !== undefined) project.name = body.name;
    if (body.goal !== undefined) project.goal = body.goal;
    if (body.last_active_at !== undefined) project.last_active_at = nextTimestamp();
    if (body.name !== undefined || body.goal !== undefined) {
      project.updated_at = nextTimestamp();
      project.last_active_at = project.updated_at;
    }
    return sendJson(response, 200, [project]);
  }

  if (request.method === "DELETE") {
    if (visible.length !== 1) return sendJson(response, 200, []);
    const index = projects.findIndex((project) => project.id === visible[0].id);
    const [deleted] = projects.splice(index, 1);
    return sendJson(response, 200, [{ id: deleted.id }]);
  }

  return sendJson(response, 405, postgrestError("FIXTURE_METHOD", "Unsupported method"));
}

function filterValue(url: URL, field: string) {
  const value = url.searchParams.get(field);
  return value?.startsWith("eq.") ? value.slice(3) : null;
}

function postgrestError(code: string, message: string) {
  return { code, details: null, hint: null, message };
}

function nextTimestamp() {
  clockSequence += 1;
  return new Date(Date.UTC(2026, 7, 8, 12, 0, clockSequence)).toISOString();
}

function requestUserId(request: IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof parsed.sub === "string" ? parsed.sub : null;
  } catch {
    return null;
  }
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
    app_metadata: { provider: "email" },
    user_metadata: {},
    identities: [{ provider: "email" }],
  };
}

async function addSessionCookie(
  context: import("@playwright/test").BrowserContext,
  userId: string,
  email: string,
) {
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: sessionCookieValue(userId, email),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}

function sessionCookieValue(userId: string, email: string): string {
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
  const session = {
    access_token: accessToken,
    refresh_token: "fixture-refresh-token",
    expires_at: expiresAt,
    expires_in: 60 * 60,
    token_type: "bearer",
    user: authUser(userId, email),
  };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json",
    "content-range": Array.isArray(body) ? `0-${Math.max(body.length - 1, 0)}/${body.length}` : "0-0/1",
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
