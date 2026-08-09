import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "20000000-0000-4000-8000-000000000002";
const OWNER_WORKSPACE_ID = "b0000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "b0000000-0000-4000-8000-000000000002";
const FIXTURE_SERVICE_ROLE_KEY = "fixture-service-role-key";
const FIXTURE_AUTH_COOKIE_NAME = "sb-workspace-fixture-auth-token";

type FixtureSubscription = {
  tier: "free" | "pro";
  plan: "monthly" | "yearly" | null;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const userSubscriptions = new Map<string, FixtureSubscription>([
  [
    OWNER_ID,
    {
      tier: "pro",
      plan: "monthly",
      status: "active",
      current_period_end: "2026-09-01T00:00:00.000Z",
      cancel_at_period_end: false,
    },
  ],
  [
    OTHER_ID,
    {
      tier: "free",
      plan: null,
      status: null,
      current_period_end: null,
      cancel_at_period_end: false,
    },
  ],
]);

type FixtureProject = {
  id: string;
  workspace_id: string;
  name: string;
  goal: string | null;
  created_at: string;
  updated_at: string;
  last_active_at: string;
};

type FixtureVideo = {
  id: string;
  youtube_url: string;
  title: string;
  channel_name: string;
};

type FixtureHistory = {
  user_id: string;
  video_id: string;
  accessed_at: string;
};

type FixtureProjectVideo = {
  project_id: string;
  video_id: string;
  position: number;
  status: "processing" | "ready" | "failed";
  failure_code: string | null;
  added_at: string;
  status_updated_at: string;
};

type FixtureConversationMessage = {
  id: string;
  inReplyToMessageId: string | null;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  answerClassification: "supported" | "abstained" | "unsupported" | null;
  sourceSetRevision: number | null;
  sourceManifest: unknown | null;
  sourceCoverage: unknown | null;
  evidenceSnapshot?: unknown;
  citationDiagnostics: unknown[] | null;
  mode?:
    | "question"
    | "compare_viewpoints"
    | "common_themes"
    | "find_gaps"
    | "project_assessment";
  attemptToken?: string;
  completionState?: "reserved" | "completed" | "cancelled";
};

type FixtureSourceSetEvent = {
  eventId: string;
  projectId: string;
  revision: number;
  kind: "added" | "removed" | "reordered" | "status_changed";
  videoId: string;
  videoTitle: string | null;
  fromPosition: number | null;
  toPosition: number | null;
  fromStatus: "processing" | "ready" | "failed" | null;
  toStatus: "processing" | "ready" | "failed" | null;
  createdAt: string;
};

type FixtureConversation = {
  id: string;
  projectId: string;
  messages: FixtureConversationMessage[];
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  clearedAt?: string;
  sourceSetEvents?: FixtureSourceSetEvent[];
};

type FixtureGatewayGate = {
  waitForRelease: Promise<void>;
  release: () => void;
};

const projects: FixtureProject[] = [];
const canonicalVideos: FixtureVideo[] = [];
const historyRows: FixtureHistory[] = [];
const projectVideos: FixtureProjectVideo[] = [];
const processedVideoIds = new Set<string>();
const sourceSetRevisions = new Map<string, number>();
const projectConversations = new Map<string, FixtureConversation>();
const projectConversationThreads = new Map<string, FixtureConversation[]>();
let projectSequence = 0;
let clockSequence = 0;
let conversationSequence = 0;
let messageSequence = 0;
let gatewayOutcome: "success" | "failure" = "success";
let gatewayGate = createGatewayGate();
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
        NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME: FIXTURE_AUTH_COOKIE_NAME,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        SUPABASE_SERVICE_ROLE_KEY: FIXTURE_SERVICE_ROLE_KEY,
        LLM_GATEWAY_URL: supabaseUrl,
        LLM_GATEWAY_API_KEY: "fixture-gateway-key",
        NEXT_TELEMETRY_DISABLED: "1",
        WORKSPACE_E2E_DIST_DIR: ".next-workspace-e2e",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitForApp(`${appUrl}/auth/login`, appProcess);
});

test.beforeEach(() => {
  gatewayGate.release();
  gatewayGate = createGatewayGate();
  projects.splice(0);
  canonicalVideos.splice(0);
  historyRows.splice(0);
  projectVideos.splice(0);
  processedVideoIds.clear();
  sourceSetRevisions.clear();
  projectConversations.clear();
  projectConversationThreads.clear();
  projectSequence = 0;
  clockSequence = 0;
  conversationSequence = 0;
  messageSequence = 0;
  gatewayOutcome = "success";
  seedCanonicalHistory();
});

test.afterEach(() => {
  gatewayGate.release();
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

async function createGroundedFixtureProject(
  context: BrowserContext,
  name: string,
) {
  const created = await context.request.post(`${appUrl}/api/workspace/projects`, {
    data: {
      name,
      goal: "A false Goal claim may guide relevance but is not evidence.",
    },
  });
  expect(created.status()).toBe(201);
  const payload = (await created.json()) as { project: { id: string } };
  const projectId = payload.project.id;
  const source = canonicalVideos[0];
  projectVideos.push({
    project_id: projectId,
    video_id: source.id,
    position: 1,
    status: "ready",
    failure_code: null,
    added_at: nextTimestamp(),
    status_updated_at: nextTimestamp(),
  });
  sourceSetRevisions.set(projectId, 1);
  return projectId;
}

function seedSourceSetAuditConversation(projectId: string) {
  const source = canonicalVideos[0];
  const added = canonicalVideos[1];
  if (!source || !added) throw new Error("Audit fixture requires canonical sources.");

  const oldPassageText = "Climate adaptation depends on exact local evidence.";
  const oldPassage = {
    passageId: `${source.id}:1:0:${Array.from(oldPassageText).length}`,
    videoId: source.id,
    youtubeVideoId: "aaaaaaa0001",
    title: source.title,
    channelName: source.channel_name,
    text: oldPassageText,
    segmentOrdinal: 1,
    excerptStartCharacter: 0,
    excerptEndCharacter: Array.from(oldPassageText).length,
    startSeconds: 42.75,
    endSeconds: 48.25,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  };
  const oldManifest = {
    projectId,
    sourceSetRevision: 1,
    sources: [
      {
        sourceId: "S1",
        videoId: source.id,
        youtubeVideoId: "aaaaaaa0001",
        title: source.title,
        channelName: source.channel_name,
        passages: [
          {
            passageId: oldPassage.passageId,
            startSeconds: oldPassage.startSeconds,
            endSeconds: oldPassage.endSeconds,
          },
        ],
      },
    ],
  };
  const oldCoverage = {
    totalVideos: 1,
    readyVideos: 1,
    evidenceVideos: 1,
    unavailableVideos: [],
    passagesExamined: 2,
    evidencePassages: 1,
  };
  const conversation: FixtureConversation = {
    id: "c1000000-0000-4000-8000-000000000001",
    projectId,
    name: "Project Conversation",
    createdAt: nextTimestamp(),
    updatedAt: nextTimestamp(),
    messages: [
      {
        id: "c3000000-0000-4000-8000-000000000001",
        inReplyToMessageId: null,
        role: "user",
        content: "What did revision one support?",
        createdAt: nextTimestamp(),
        answerClassification: null,
        sourceSetRevision: 1,
        sourceManifest: null,
        sourceCoverage: null,
        citationDiagnostics: null,
        completionState: "completed",
      },
      {
        id: "c2000000-0000-4000-8000-000000000001",
        inReplyToMessageId: "c3000000-0000-4000-8000-000000000001",
        role: "assistant",
        content: "Historical answer from revision one.",
        createdAt: nextTimestamp(),
        answerClassification: "supported",
        sourceSetRevision: 1,
        sourceManifest: oldManifest,
        sourceCoverage: oldCoverage,
        evidenceSnapshot: {
          projectId,
          sourceSetRevision: 1,
          passages: [oldPassage],
        },
        citationDiagnostics: [],
      },
    ],
    sourceSetEvents: [
      {
        eventId: "e3200000-0000-4000-8000-000000000001",
        projectId,
        revision: 2,
        kind: "added",
        videoId: added.id,
        videoTitle: added.title,
        fromPosition: null,
        toPosition: 2,
        fromStatus: null,
        toStatus: "ready",
        createdAt: nextTimestamp(),
      },
    ],
  };
  projectVideos.push({
    project_id: projectId,
    video_id: added.id,
    position: 2,
    status: "ready",
    failure_code: null,
    added_at: nextTimestamp(),
    status_updated_at: nextTimestamp(),
  });
  sourceSetRevisions.set(projectId, 2);
  projectConversations.set(projectId, conversation);
  projectConversationThreads.set(projectId, [conversation]);
  // Keep the generated turn IDs distinct from the historical answer pair.
  messageSequence = 1;
}

async function expectProjectQuestionComposerReady(page: Page) {
  const question = page.getByLabel("Ask the Project");
  await expect(question).toBeEnabled();
  await question.fill("Can I ask another grounded question?");
  await expect(page.getByRole("button", { name: "Ask Project" })).toBeEnabled();
  await question.clear();
}

test("database-backed Pro Researcher completes a private responsive Project lifecycle", async ({
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
  await expect(
    page.getByText(/Unlimited Projects within technical and abuse limits/i),
  ).toBeVisible();

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
  await expect(page.getByText("Only Project Videos can support grounded claims.")).toBeVisible();

  await page.getByLabel("Project name").fill("Evidence synthesis");
  await page.getByLabel("Project Goal (optional)").fill("Map agreement and disagreement.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
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

test("Project Conversation shows coverage before text and reloads a citation-diagnostic answer", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  const projectId = await createGroundedFixtureProject(
    context,
    "Grounded conversation lab",
  );

  await page.goto(`${appUrl}/workspace/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: "Project Conversation" }))
    .toBeVisible();
  await page.getByLabel("Ask the Project").fill("What does the evidence support?");
  await page.getByRole("button", { name: "Ask Project" }).click();

  // The fixture gateway holds its first token until these synchronous
  // artifacts are visible. This proves ordering without a timing assumption.
  await expect(page.getByLabel("Answer source manifest")).toContainText(
    "Alpha evidence",
  );
  await expect(page.getByLabel("Source Coverage")).toContainText(
    "Passages examined2",
  );
  await expect(page.getByLabel("Source Coverage")).toContainText(
    "Evidence Snapshot passages2",
  );
  await expect(page.getByText("Preparing answer")).toBeVisible();
  await expect(page.getByText(/Climate adaptation is supported/i)).toHaveCount(0);

  gatewayGate.release();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();
  const exactCitation = page.getByRole("link", { name: /S1 @ 00:42/i });
  await expect(exactCitation).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
  );
  await expect(page.getByRole("link", { name: /S9 @ 00:10/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /S1 @ 00:43/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /S1 at 00:42/i })).toHaveCount(0);
  await expect(page.getByText(/3 citations could not be linked/i)).toBeVisible();
  await expectProjectQuestionComposerReady(page);

  const persisted = projectConversations.get(projectId);
  expect(persisted?.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
  expect(persisted?.messages[1]).toMatchObject({
    answerClassification: "supported",
    sourceSetRevision: 1,
    citationDiagnostics: [
      { kind: "unknown_source" },
      { kind: "timestamp_not_in_evidence" },
      { kind: "malformed" },
    ],
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Project Conversation" }))
    .toBeVisible();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();
  await expect(page.getByLabel("Source Coverage")).toContainText(
    "Passages examined2",
  );
  await expect(page.getByRole("link", { name: /S1 @ 00:42/i })).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
  );
  await expect(page.getByText(/3 citations could not be linked/i)).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("guided Project Conversation actions preserve editable mode metadata on desktop and mobile", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  const projectId = await createGroundedFixtureProject(
    context,
    "Guided synthesis lab",
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/workspace/projects/${projectId}`);
  await expect(
    page.getByRole("button", { name: "Compare viewpoints" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find common themes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find gaps and unexplored angles" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Project Assessment" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Project Assessment" }).click();
  const question = page.getByLabel("Ask the Project");
  await expect(question).toHaveValue(/Which position is better supported/);
  await question.fill("Which edited position is better supported?");
  await page.getByRole("button", { name: "Ask Project" }).click();
  await expect(page.getByText("Project Assessment", { exact: true })).toBeVisible();
  await expect(page.getByText("Preparing answer")).toBeVisible();

  gatewayGate.release();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();
  await expect(
    page.getByText(/not externally verified truth/i),
  ).toBeVisible();
  const persisted = projectConversations.get(projectId);
  expect(persisted?.messages).toMatchObject([
    { role: "user", mode: "project_assessment" },
    { role: "assistant", mode: "project_assessment" },
  ]);

  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(
    page.getByRole("button", { name: "Find gaps and unexplored angles" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find gaps and unexplored angles" }).click();
  await expect(page.getByLabel("Ask the Project")).toHaveValue(/Find gaps/);
  await page.getByLabel("Ask the Project").fill("Find supported gaps and counterarguments.");
  gatewayGate = createGatewayGate();
  await page.getByRole("button", { name: "Ask Project" }).click();
  await expect(
    page.getByText("Find gaps and unexplored angles", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Preparing answer")).toBeVisible();
  gatewayGate.release();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();
  expect(
    [...projectConversationThreads.get(projectId) ?? []].some((thread) =>
      thread.messages.some((message) => message.mode === "find_gaps"),
    ),
  ).toBe(true);
  await expect(
    page.getByText("Find gaps and unexplored angles", { exact: true }).first(),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByText("Project Assessment", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(await page.locator('[class*="overflow-y"]').count()).toBe(0);
});

test("Project Conversation preserves Source Set boundaries across desktop and mobile", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  const projectId = await createGroundedFixtureProject(
    context,
    "Source Set audit lab",
  );
  seedSourceSetAuditConversation(projectId);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${appUrl}/workspace/projects/${projectId}`);
  await expect(page.getByText("Historical answer from revision one.")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Source Set change revision 2" }),
  ).toContainText("Added Beta processing to the Source Set");
  const oldAnswer = page
    .locator("article")
    .filter({ hasText: "Historical answer from revision one." });
  await expect(oldAnswer.getByLabel("Immutable Evidence Snapshot")).toContainText(
    "Source Set revision 1",
  );

  await page.getByLabel("Ask the Project").fill("What changed for the new Source Set?");
  await page.getByRole("button", { name: "Ask Project" }).click();
  await expect(page.getByText("Preparing answer")).toBeVisible();
  await expect(page.getByLabel("Answer source manifest")).toHaveCount(2);
  gatewayGate.release();

  await expect(page.getByLabel("Immutable Evidence Snapshot")).toHaveCount(2);
  const newAnswer = page
    .locator("article")
    .filter({ hasText: "Climate adaptation is supported" });
  await expect(newAnswer).toBeVisible();
  await expect(newAnswer.getByLabel("Immutable Evidence Snapshot")).toContainText(
    "Source Set revision 2",
  );
  await expect(
    page.getByRole("status", { name: "Source Set change revision 2" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("Historical answer from revision one.")).toBeVisible();
  await expect(page.getByText("Climate adaptation is supported")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Source Set change revision 2" }),
  ).toContainText("Revision 2");
  await expect(
    page
      .locator("article")
      .filter({ hasText: "Historical answer from revision one." })
      .getByLabel("Immutable Evidence Snapshot"),
  ).toContainText("Source Set revision 1");
  await expect(
    page
      .locator("article")
      .filter({ hasText: "Climate adaptation is supported" })
      .getByLabel("Immutable Evidence Snapshot"),
  ).toContainText("Source Set revision 2");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});

test("Project Conversation persists a classified fallback without calling the gateway", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  const projectId = await createGroundedFixtureProject(
    context,
    "Grounded fallback lab",
  );

  await page.goto(`${appUrl}/workspace/projects/${projectId}`);
  await page.getByLabel("Ask the Project").fill("absent");
  await page.getByRole("button", { name: "Ask Project" }).click();

  await expect(page.getByLabel("Source Coverage")).toContainText(
    "Passages examined2",
  );
  await expect(page.getByLabel("Source Coverage")).toContainText(
    "Evidence Snapshot passages0",
  );
  await expect(
    page.getByText(/available Project passages do not support an answer/i),
  ).toBeVisible();
  await expect(page.getByText("Unsupported by sources")).toBeVisible();
  await expectProjectQuestionComposerReady(page);

  expect(projectConversations.get(projectId)?.messages).toMatchObject([
    { role: "user", content: "absent", completionState: "completed" },
    { role: "assistant", answerClassification: "unsupported" },
  ]);
});

test("Project Conversation preserves only the user message after gateway failure", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  const projectId = await createGroundedFixtureProject(
    context,
    "Grounded failure lab",
  );
  gatewayOutcome = "failure";
  gatewayGate.release();

  await page.goto(`${appUrl}/workspace/projects/${projectId}`);
  await page.getByLabel("Ask the Project").fill("What fails safely?");
  await page.getByRole("button", { name: "Ask Project" }).click();

  await expect(
    page.getByText(/Something went wrong answering your Project question/),
  ).toBeVisible();
  await expectProjectQuestionComposerReady(page);
  await expect(page.getByText("What fails safely?", { exact: true })).toBeVisible();
  await expect(page.getByText("Grounded Answer", { exact: true })).toHaveCount(0);
  expect(projectConversations.get(projectId)?.messages).toMatchObject([
    { role: "user", content: "What fails safely?", completionState: "reserved" },
  ]);
});

test("Researcher switches, clears, and retries named Project Conversations on desktop and mobile", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  const projectId = await createGroundedFixtureProject(
    context,
    "Conversation management lab",
  );

  await page.goto(`${appUrl}/workspace/projects/${projectId}`);
  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(
    page.getByRole("button", { name: /New conversation \d+ messages/ }),
  ).toBeVisible();
  // Reload before the legacy default has ever received a question. The named
  // thread must be selected with its history rather than leaving a blank
  // compatibility conversation active.
  await page.reload();
  await expect(
    page.getByRole("button", { name: /New conversation 0 messages/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rename New conversation" }).click();
  const renameInput = page.getByRole("textbox", { name: "Conversation name" });
  await renameInput.fill("Launch questions");
  await page.getByRole("button", { name: "Save conversation name" }).click();
  await expect(page.getByRole("button", { name: /Launch questions \d+ messages/ })).toBeVisible();

  await page.getByLabel("Ask the Project").fill("What does the evidence support?");
  await page.getByRole("button", { name: "Ask Project" }).click();
  await expect(page.getByLabel("Answer source manifest")).toBeVisible();
  gatewayGate.release();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();

  await page.getByRole("button", { name: "New conversation" }).click();
  await expect(page.getByRole("button", { name: "Rename New conversation" })).toBeVisible();
  await page.getByRole("button", { name: "Rename New conversation" }).click();
  await page.getByRole("textbox", { name: "Conversation name" }).fill("Comparison");
  await page.getByRole("button", { name: "Save conversation name" }).click();
  await expect(page.getByRole("button", { name: /Comparison \d+ messages/ })).toBeVisible();

  await page.getByRole("button", { name: /Launch questions/ }).first().click();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();
  await page.getByRole("button", { name: "Clear Launch questions" }).click();
  await expect(page.getByText(/Climate adaptation is supported/i)).toHaveCount(0);
  await expect(page.getByText("Ask your first Project question")).toBeVisible();

  gatewayOutcome = "failure";
  gatewayGate.release();
  await page.getByLabel("Ask the Project").fill("What should retry safely?");
  await page.getByRole("button", { name: "Ask Project" }).click();
  await expect(page.getByText(/Something went wrong answering your Project question/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  gatewayOutcome = "success";
  gatewayGate = createGatewayGate();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Answer source manifest")).toBeVisible();
  gatewayGate.release();
  await expect(page.getByText(/Climate adaptation is supported/i)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Conversation threads" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "New conversation" })).toBeVisible();
});

test("Free Project cap is clear, deletion frees it, and concurrent creation stays atomic", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OTHER_ID, "other@example.test");
  await page.goto(`${appUrl}/workspace`);

  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Project name").fill("Free research home");
  await page.getByRole("button", { name: "Create Project" }).last().click();
  await expect(page.getByRole("heading", { name: "Free research home" })).toBeVisible();

  await expect(page.getByText("1 of 1 Free Project used")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Upgrade to Pro" }),
  ).toHaveAttribute("href", "/pricing?source_surface=project_limit");
  const capResponse = await context.request.post(
    `${appUrl}/api/workspace/projects`,
    { data: { name: "Blocked second Project" } },
  );
  expect(capResponse.status()).toBe(402);
  expect(await capResponse.json()).toMatchObject({
    errorCode: "free_project_limit_reached",
    tier: "free",
    upgradeUrl: "/pricing",
    projectsUsed: 1,
    projectsLimit: 1,
  });

  await page.getByRole("link", { name: "Open Free research home" }).click();
  await page.getByLabel("Search exact Transcript passages").fill("waiting");
  await page.getByRole("button", { name: "Search Transcripts" }).click();
  await expect(
    page.getByText("No ready Project Transcripts", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/never uses AI generation or a message allowance/i)).toBeVisible();
  await page.getByRole("button", { name: "Delete Project" }).click();
  await page
    .getByRole("alertdialog", { name: "Delete “Free research home”?" })
    .getByRole("button", { name: "Delete Project" })
    .click();
  await expect(page.getByRole("heading", { name: "Start your first Project" })).toBeVisible();

  const concurrent = await Promise.all([
    context.request.post(`${appUrl}/api/workspace/projects`, {
      data: { name: "Concurrent A" },
    }),
    context.request.post(`${appUrl}/api/workspace/projects`, {
      data: { name: "Concurrent B" },
    }),
  ]);
  expect(concurrent.map((response) => response.status()).sort()).toEqual([
    201,
    402,
  ]);
  const blocked = concurrent.find((response) => response.status() === 402);
  expect(await blocked?.json()).toMatchObject({
    errorCode: "free_project_limit_reached",
    tier: "free",
    upgradeUrl: "/pricing",
  });

  await page.reload();
  await expect(page.locator('[aria-labelledby="recent-projects-heading"] h3')).toHaveCount(1);
});

test("visitor receives a clear registration action before Workspace data is loaded", async ({
  page,
}) => {
  await page.goto(`${appUrl}/workspace`);
  await expect(
    page.getByRole("heading", { name: "Create an account for Projects" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Create free account" })).toHaveAttribute(
    "href",
    "/auth/sign-up?redirect_to=%2Fworkspace",
  );

  const response = await page.request.post(`${appUrl}/api/workspace/projects`, {
    data: { name: "Anonymous Project" },
  });
  expect(response.status()).toBe(402);
  expect(await response.json()).toMatchObject({
    errorCode: "anon_project_registration_required",
    tier: "anon",
    upgradeUrl: "/auth/sign-up?redirect_to=%2Fworkspace",
  });
});

test("Researcher curates a durable, bounded, concurrent-safe Project Source Set", async ({
  browser,
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  await page.goto(`${appUrl}/workspace`);
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Project name").fill("Climate evidence map");
  await page.getByLabel("Project Goal (optional)").fill("Compare the source claims.");
  await page.getByRole("button", { name: "Create Project" }).last().click();
  await page.getByRole("link", { name: "Open Climate evidence map" }).click();

  await expect(page.getByRole("heading", { name: "Source Set" })).toBeVisible();
  await expect(
    page.getByRole("status", { name: "0 of 5 Project Videos" }),
  ).toBeVisible();
  await expect(page.getByText(/grounding limit for every plan/i)).toBeVisible();
  await expect(page.getByText("Add your first source")).toBeVisible();

  const projectId = projects.find((project) => project.name === "Climate evidence map")?.id;
  expect(projectId).toBeTruthy();
  if (!projectId) return;

  async function addFromHistory(title: string) {
    await page.getByRole("button", { name: "Add from History" }).click();
    await expect(page.getByRole("dialog", { name: "Add a History Video" })).toBeVisible();
    await page.getByRole("button", { name: `Add ${title} to Source Set` }).click();
    await expect(page.getByRole("dialog", { name: "Add a History Video" })).toBeHidden();
    await expect(page.getByText(`Added ${title}.`, { exact: true })).toBeVisible();
    await expect(
      page.getByTestId("project-source-title").filter({ hasText: title }),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Add from History" }).click();
  const historyDialog = page.getByRole("dialog", { name: "Add a History Video" });
  await expect(historyDialog.getByText("36 processed Videos available.")).toBeVisible();
  await expect(historyDialog.getByText("Legacy deep evidence")).toHaveCount(0);
  await historyDialog.getByLabel("Search History").fill("Unprocessed draft");
  await historyDialog.getByRole("button", { name: "Search" }).click();
  await expect(
    historyDialog.getByText(/No processed History Videos match “Unprocessed draft”/),
  ).toBeVisible();
  await historyDialog.getByLabel("Search History").fill("Legacy deep evidence");
  await historyDialog.getByRole("button", { name: "Search" }).click();
  await expect(
    historyDialog.getByText("Legacy deep evidence", { exact: true }),
  ).toBeVisible();
  await historyDialog
    .getByRole("button", { name: "Add Legacy deep evidence to Source Set" })
    .click();
  await expect(historyDialog).toBeHidden();
  await expect(page.getByText("Added Legacy deep evidence.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Legacy deep evidence")).toBeVisible();
  await page
    .getByRole("button", { name: "Remove Legacy deep evidence from Source Set" })
    .click();
  await expect(page.getByText("Removed Legacy deep evidence.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Legacy deep evidence")).toHaveCount(0);

  await addFromHistory("Alpha evidence");
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Alpha evidence")).toBeVisible();

  const duplicate = await context.request.post(
    `${appUrl}/api/projects/${projectId}/source-set`,
    {
      data: {
        videoId: canonicalVideos[0].id,
        expectedRevision: sourceSetRevisions.get(projectId),
      },
    },
  );
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({ outcome: "duplicate" });

  await addFromHistory("Beta processing");
  await addFromHistory("Gamma failed");
  const betaMembership = projectVideos.find(
    (membership) => membership.project_id === projectId && membership.video_id === canonicalVideos[1].id,
  );
  const gammaMembership = projectVideos.find(
    (membership) => membership.project_id === projectId && membership.video_id === canonicalVideos[2].id,
  );
  expect(betaMembership).toBeTruthy();
  expect(gammaMembership).toBeTruthy();
  if (!betaMembership || !gammaMembership) return;
  transitionFixtureStatus(projectId, betaMembership.video_id, "processing", null);
  transitionFixtureStatus(
    projectId,
    gammaMembership.video_id,
    "failed",
    "transcript_unavailable",
  );
  await page.reload();
  await expect(page.getByText("Processing", { exact: true })).toBeVisible();
  await expect(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect(page.getByText("2 of 3 Project Videos unavailable")).toBeVisible();
  await expect(page.getByText(/Grounded actions will use only the 1 ready Video/i)).toBeVisible();

  await addFromHistory("Delta context");
  await addFromHistory("Epsilon counterpoint");
  await expect(
    page.getByRole("status", { name: "5 of 5 Project Videos" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add from History" })).toBeDisabled();
  await expect(page.getByText("Source Set limit reached")).toBeVisible();
  await expect(page.getByText(/upgrading does not increase this grounding limit/i)).toBeVisible();

  const generatedRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/(?:api\/chat|api\/generate|v1\/chat\/completions)(?:[/?]|$)/.test(request.url())) {
      generatedRequests.push(request.url());
    }
  });
  const searchRegion = page.getByLabel("Project Search");
  await expect(searchRegion).toHaveClass(/ph-no-capture/);
  await expect(searchRegion).toHaveAttribute("data-ph-no-autocapture", "true");
  const searchRequestPromise = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith(`/api/projects/${projectId}/search`),
  );
  await page.getByLabel("Search exact Transcript passages").fill("climate");
  await page.getByRole("button", { name: "Search Transcripts" }).click();
  const searchRequest = await searchRequestPromise;
  expect(searchRequest.method()).toBe("POST");
  expect(new URL(searchRequest.url()).search).toBe("");
  expect(searchRequest.postDataJSON()).toEqual({ query: "climate" });
  await expect(page.getByRole("status").filter({ hasText: "exact Transcript" })).toContainText(
    "2 exact Transcript passages found across 3 ready Videos",
  );
  await expect(page.getByTestId("project-search-passage")).toHaveText([
    "Climate adaptation depends on exact local evidence.",
    "气候适应需要准确的本地证据。",
  ]);
  const firstTimestamp = page.getByRole("link", {
    name: "Open Alpha evidence at [0:42]",
  });
  const secondTimestamp = page.getByRole("link", {
    name: "Open Delta context at [0:42]",
  });
  await expect(firstTimestamp).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=aaaaaaa0001&t=42s",
  );
  await expect(secondTimestamp).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=aaaaaaa0004&t=42s",
  );
  await context.route("https://www.youtube.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Video fixture</title>" }),
  );
  const [selectedVideo] = await Promise.all([
    page.waitForEvent("popup"),
    secondTimestamp.click(),
  ]);
  await expect(selectedVideo).toHaveURL(
    "https://www.youtube.com/watch?v=aaaaaaa0004&t=42s",
  );
  await selectedVideo.close();
  expect(generatedRequests).toEqual([]);

  await page.getByLabel("Search exact Transcript passages").fill("absent");
  await page.getByRole("button", { name: "Search Transcripts" }).click();
  await expect(searchRegion.getByText("No matching Transcript passages")).toBeVisible();
  await expect(searchRegion.getByText("3 of 5 Project Videos searched")).toBeVisible();
  await expect(
    searchRegion.getByText("Beta processing", { exact: true }),
  ).toBeVisible();
  await expect(searchRegion.getByText("Gamma failed", { exact: true })).toBeVisible();
  expect(generatedRequests).toEqual([]);

  await page.getByRole("button", { name: "Move Epsilon counterpoint up" }).click();
  await expect(page.getByText("Source order updated.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(orderedSourceTitles(page)).toHaveText([
    "Alpha evidence",
    "Beta processing",
    "Gamma failed",
    "Epsilon counterpoint",
    "Delta context",
  ]);

  const revisionBeforeRace = sourceSetRevisions.get(projectId);
  expect(revisionBeforeRace).toBe(10);
  const currentIds = orderedMemberships(projectId).map((membership) => membership.video_id);
  const firstOrder = [...currentIds].reverse();
  const secondOrder = [
    currentIds[1],
    currentIds[0],
    currentIds[2],
    currentIds[3],
    currentIds[4],
  ];
  const raceResponses = await Promise.all([
    context.request.patch(`${appUrl}/api/projects/${projectId}/source-set`, {
      data: { videoIds: firstOrder, expectedRevision: revisionBeforeRace },
    }),
    context.request.patch(`${appUrl}/api/projects/${projectId}/source-set`, {
      data: { videoIds: secondOrder, expectedRevision: revisionBeforeRace },
    }),
  ]);
  expect(raceResponses.map((response) => response.status()).sort()).toEqual([200, 409]);
  const winner = raceResponses.find((response) => response.status() === 200);
  expect(winner).toBeTruthy();
  if (!winner) return;
  const winningPayload = (await winner.json()) as {
    sourceSet: { videos: Array<{ title: string }> };
  };
  await page.reload();
  await expect(orderedSourceTitles(page)).toHaveText(
    winningPayload.sourceSet.videos.map((video) => video.title),
  );

  await page.getByRole("button", { name: "Remove Gamma failed from Source Set" }).click();
  await expect(page.getByText("Removed Gamma failed.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Gamma failed")).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "4 of 5 Project Videos" }),
  ).toBeVisible();

  const alphaHistoryIndex = historyRows.findIndex(
    (history) => history.video_id === canonicalVideos[0].id,
  );
  expect(alphaHistoryIndex).toBeGreaterThanOrEqual(0);
  historyRows.splice(alphaHistoryIndex, 1);
  await page.reload();
  await expect(page.getByText("Alpha evidence")).toBeVisible();

  const otherContext = await browser.newContext();
  try {
    await addSessionCookie(otherContext, OTHER_ID, "other@example.test");
    const otherPage = await otherContext.newPage();
    await otherPage.goto(`${appUrl}/workspace/projects/${projectId}`);
    await expect(otherPage.getByRole("heading", { name: "Project not found" })).toBeVisible();
    const privateSourceSet = await otherContext.request.get(
      `${appUrl}/api/projects/${projectId}/source-set`,
    );
    expect(privateSourceSet.status()).toBe(404);
    const revisionBeforeAttack = sourceSetRevisions.get(projectId);
    const membershipBeforeAttack = JSON.stringify(orderedMemberships(projectId));
    const attackerResponses = await Promise.all([
      otherContext.request.post(`${appUrl}/api/projects/${projectId}/source-set`, {
        data: {
          videoId: canonicalVideos[5].id,
          expectedRevision: revisionBeforeAttack,
        },
      }),
      otherContext.request.patch(`${appUrl}/api/projects/${projectId}/source-set`, {
        data: {
          videoIds: orderedMemberships(projectId).map(
            (membership) => membership.video_id,
          ),
          expectedRevision: revisionBeforeAttack,
        },
      }),
      otherContext.request.delete(
        `${appUrl}/api/projects/${projectId}/source-set/${canonicalVideos[0].id}?revision=${revisionBeforeAttack}`,
      ),
    ]);
    for (const response of attackerResponses) {
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({
        outcome: "missing",
        message: "Project not found.",
      });
    }
    expect(sourceSetRevisions.get(projectId)).toBe(revisionBeforeAttack);
    expect(JSON.stringify(orderedMemberships(projectId))).toBe(
      membershipBeforeAttack,
    );
  } finally {
    await otherContext.close();
  }

  const canonicalCount = canonicalVideos.length;
  await page.getByRole("button", { name: "Delete Project" }).click();
  const deleteDialog = page.getByRole("alertdialog", {
    name: "Delete “Climate evidence map”?",
  });
  await deleteDialog.getByRole("button", { name: "Delete Project" }).click();
  await expect(page).toHaveURL(`${appUrl}/workspace`);
  expect(projectVideos.some((membership) => membership.project_id === projectId)).toBe(false);
  expect(sourceSetRevisions.has(projectId)).toBe(false);
  expect(canonicalVideos).toHaveLength(canonicalCount);
});

test("Researcher pastes, refreshes, retries, and removes a durable Project URL", async ({
  context,
  page,
}) => {
  await addSessionCookie(context, OWNER_ID, "owner@example.test");
  await page.goto(`${appUrl}/workspace`);
  await page.getByRole("button", { name: "Create Project" }).click();
  await page.getByLabel("Project name").fill("URL evidence lab");
  await page.getByRole("button", { name: "Create Project" }).last().click();
  await page.getByRole("link", { name: "Open URL evidence lab" }).click();

  const projectId = projects.find((project) => project.name === "URL evidence lab")?.id;
  expect(projectId).toBeTruthy();
  if (!projectId) return;

  const attempts = new Map<string, number>();
  let processingOwners = 0;
  await page.route(
    `**/api/projects/${projectId}/source-set/process`,
    async (route) => {
      const requestBody = route.request().postDataJSON() as {
        youtubeUrl: string;
        expectedRevision: number;
      };
      const parsedUrl = new URL(requestBody.youtubeUrl);
      const youtubeVideoId = parsedUrl.searchParams.get("v");
      if (
        !youtubeVideoId ||
        !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
          parsedUrl.hostname,
        )
      ) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "invalid",
            message: "Enter a valid HTTPS YouTube Video URL.",
          }),
        });
        return;
      }

      const existingVideo = canonicalVideos.find(
        (video) => video.youtube_url === requestBody.youtubeUrl,
      );
      const existingMembership = existingVideo
        ? projectVideos.find(
            (membership) =>
              membership.project_id === projectId &&
              membership.video_id === existingVideo.id,
          )
        : undefined;
      if (existingMembership?.status === "processing") {
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "already_processing",
            sourceSet: fixtureSourceSet(projectId),
          }),
        });
        return;
      }
      if (existingMembership?.status === "ready") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "already_ready",
            sourceSet: fixtureSourceSet(projectId),
          }),
        });
        return;
      }
      if (!existingMembership && orderedMemberships(projectId).length >= 5) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "limit_reached",
            message:
              "This Source Set already has five Videos, the universal grounding limit.",
            sourceSet: fixtureSourceSet(projectId),
          }),
        });
        return;
      }
      if (requestBody.expectedRevision !== (sourceSetRevisions.get(projectId) ?? 0)) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            outcome: "conflict",
            message: "The Source Set changed in another request.",
            sourceSet: fixtureSourceSet(projectId),
          }),
        });
        return;
      }

      const attempt = (attempts.get(youtubeVideoId) ?? 0) + 1;
      attempts.set(youtubeVideoId, attempt);
      let video = existingVideo;
      if (!video) {
        const ordinal = canonicalVideos.length + 1;
        video = {
          id: `7f000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`,
          youtube_url: requestBody.youtubeUrl,
          title:
            youtubeVideoId === "projquota01"
              ? "Quota source"
              : youtubeVideoId === "projfail001"
                ? "Retry source"
                : youtubeVideoId === "projdupe001"
                  ? "Duplicate source"
                  : youtubeVideoId === "projother01"
                    ? "Other source"
                    : "Pasted source",
          channel_name: "URL Fixture Lab",
        };
        canonicalVideos.push(video);
      }

      const timestamp = nextTimestamp();
      let membership = existingMembership;
      if (!membership) {
        membership = {
          project_id: projectId,
          video_id: video.id,
          position: orderedMemberships(projectId).length + 1,
          status: "processing",
          failure_code: null,
          added_at: timestamp,
          status_updated_at: timestamp,
        };
        projectVideos.push(membership);
      } else {
        membership.status = "processing";
        membership.failure_code = null;
        membership.status_updated_at = timestamp;
      }
      processingOwners += 1;
      sourceSetRevisions.set(
        projectId,
        (sourceSetRevisions.get(projectId) ?? 0) + 1,
      );

      if (youtubeVideoId === "projquota01") {
        membership.status = "failed";
        membership.failure_code = "summary_quota";
        membership.status_updated_at = nextTimestamp();
        sourceSetRevisions.set(projectId, (sourceSetRevisions.get(projectId) ?? 0) + 1);
        await route.fulfill({
          status: 402,
          contentType: "application/json",
          headers: { "X-Error-ID": "QUOTA_EXCEEDED" },
          body: JSON.stringify({
            message:
              "You've used your 10 free summaries this month. Upgrade for unlimited.",
            errorCode: "free_quota_exceeded",
            tier: "free",
            upgradeUrl: "/pricing",
          }),
        });
        return;
      }

      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          outcome: attempt === 1 ? "started" : "retry_started",
          sourceSet: fixtureSourceSet(projectId),
        }),
      });

      setTimeout(() => {
        const current = projectVideos.find(
          (candidate) =>
            candidate.project_id === projectId && candidate.video_id === video.id,
        );
        if (!current || current.status !== "processing") return;
        if (youtubeVideoId === "projfail001" && attempt === 1) {
          current.status = "failed";
          current.failure_code = "summary_processing";
        } else {
          current.status = "ready";
          current.failure_code = null;
        }
        current.status_updated_at = nextTimestamp();
        sourceSetRevisions.set(projectId, (sourceSetRevisions.get(projectId) ?? 0) + 1);
      }, youtubeVideoId === "projurl0001" ? 1_200 : 150);
    },
  );

  const input = page.getByLabel("YouTube Video URL");
  const sourceSetRegion = page.getByRole("region", { name: "Source Set" });
  await input.fill("https://example.com/watch?v=projurl0001");
  await page.getByRole("button", { name: "Add Video" }).click();
  await expect(sourceSetRegion.getByRole("alert")).toContainText(
    "valid HTTPS YouTube Video URL",
  );
  expect(projectVideos).toHaveLength(0);

  await input.fill("https://www.youtube.com/watch?v=projurl0001");
  await page.getByRole("button", { name: "Add Video" }).click();
  await expect(page.getByText("Pasted source")).toBeVisible();
  await expect(page.getByText("Processing", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pasted source")).toBeVisible();
  await expect(page.getByText("Processing", { exact: true })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();

  await input.fill("https://www.youtube.com/watch?v=projfail001");
  await page.getByRole("button", { name: "Add Video" }).click();
  await expect(page.getByRole("button", { name: "Retry Retry source" })).toBeVisible();
  await page.getByRole("button", { name: "Retry Retry source" }).click();
  await expect(page.getByText("Retry source")).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(2);
  expect(
    projectVideos.filter(
      (membership) =>
        membership.project_id === projectId &&
        canonicalVideos.find((video) => video.id === membership.video_id)
          ?.youtube_url.endsWith("projfail001"),
    ),
  ).toHaveLength(1);

  await input.fill("https://www.youtube.com/watch?v=projquota01");
  await page.getByRole("button", { name: "Add Video" }).click();
  await expect(sourceSetRegion.getByRole("alert")).toContainText(
    "10 free summaries",
  );
  await expect(page.getByRole("link", { name: "View plans" })).toHaveAttribute(
    "href",
    "/pricing",
  );
  await expect(page.getByRole("button", { name: "Retry Quota source" })).toBeVisible();

  const duplicateRevision = sourceSetRevisions.get(projectId);
  const duplicateResponses = await page.evaluate(
    async ({ id, revision }) => {
      const payload = {
        youtubeUrl: "https://www.youtube.com/watch?v=projdupe001",
        expectedRevision: revision,
      };
      return Promise.all(
        [1, 2].map(async () => {
          const response = await fetch(`/api/projects/${id}/source-set/process`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          return { status: response.status, body: await response.json() };
        }),
      );
    },
    { id: projectId, revision: duplicateRevision },
  );
  expect(duplicateResponses.map((response) => response.status)).toEqual([202, 202]);
  expect(
    duplicateResponses.map((response) => response.body.outcome).sort(),
  ).toEqual(["already_processing", "started"]);
  expect(
    projectVideos.filter(
      (membership) =>
        membership.project_id === projectId &&
        canonicalVideos.find((video) => video.id === membership.video_id)
          ?.youtube_url.endsWith("projdupe001"),
    ),
  ).toHaveLength(1);
  expect(processingOwners).toBe(5);

  await page.reload();
  await expect(page.getByText("Duplicate source")).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toHaveCount(3);
  await input.fill("https://www.youtube.com/watch?v=projother01");
  await page.getByRole("button", { name: "Add Video" }).click();
  await expect(
    page.getByRole("status", { name: "5 of 5 Project Videos" }),
  ).toBeVisible();
  await expect(input).toBeDisabled();
  await expect(page.getByText("Source Set limit reached")).toBeVisible();
  const otherSource = page.getByRole("listitem").filter({ hasText: "Other source" });
  await expect(otherSource.getByText("Ready", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove Quota source from Source Set" }).click();
  await expect(page.getByText("Removed Quota source.", { exact: true })).toBeVisible();
  await expect(page.getByText("Quota source", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Pasted source")).toBeVisible();
  await expect(page.getByText("Retry source")).toBeVisible();
  await expect(page.getByText("Duplicate source")).toBeVisible();
  await expect(page.getByText("Other source")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "4 of 5 Project Videos" }),
  ).toBeVisible();
});

async function handleSupabaseRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://fixture.test");
  const userId = requestUserId(request);
  const serviceRole = isServiceRoleRequest(request);

  if (url.pathname === "/chat/completions" && request.method === "POST") {
    const gatewayBody = (await readJson(request)) as {
      messages?: Array<{ content?: unknown }>;
    };
    const prompt = gatewayBody.messages
      ?.map((message) => (typeof message.content === "string" ? message.content : ""))
      .join("\n") ?? "";
    const responseContent = prompt.includes("GUIDED_SYNTHESIS_MODE: PROJECT_ASSESSMENT")
      ? "SUPPORTED\nProject Assessment\n\nCompeting positions\nClimate adaptation is supported [S1 @ 00:42].\n\nCriteria\nDirectness and relevance support this position [S1 @ 00:42].\n\nConfidence: medium"
      : prompt.includes("GUIDED_SYNTHESIS_MODE: FIND_GAPS")
        ? "SUPPORTED\nSource-supported observations\nClimate adaptation is supported [S1 @ 00:42].\n\nProposed questions and creative opportunities\nWhat local evidence would challenge this finding [S1 @ 00:42]?"
        : "SUPPORTED\nClimate adaptation is supported despite diagnostic examples [S9 @ 00:10], [S1 @ 00:43], and [S1 at 00:42] [S1 @ 00:42].";
    const activeGatewayGate = gatewayGate;
    await activeGatewayGate.waitForRelease;
    if (response.destroyed || response.writableEnded) return;
    if (gatewayOutcome === "failure") {
      return sendJson(response, 502, { message: "Fixture gateway failure" });
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    response.flushHeaders();
    response.write(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              content: responseContent,
            },
          },
        ],
      })}\n\n`,
    );
    response.end("data: [DONE]\n\n");
    return;
  }

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
    if (!requestedOwner || (!serviceRole && requestedOwner !== userId)) {
      return sendJson(response, 200, []);
    }
    const id =
      requestedOwner === OWNER_ID
        ? OWNER_WORKSPACE_ID
        : requestedOwner === OTHER_ID
          ? OTHER_WORKSPACE_ID
          : null;
    if (!id) return sendJson(response, 200, []);
    return sendJson(response, 200, [{ id }]);
  }

  if (
    url.pathname === "/rest/v1/user_subscriptions" &&
    request.method === "GET"
  ) {
    const requestedUser = filterValue(url, "user_id");
    if (!requestedUser || (!serviceRole && requestedUser !== userId)) {
      return sendJson(response, 200, []);
    }
    const subscription = userSubscriptions.get(requestedUser);
    return sendJson(response, 200, subscription ? [subscription] : []);
  }

  if (url.pathname === "/rest/v1/projects") {
    return handleProjects(request, response, url, userId, serviceRole);
  }

  if (url.pathname === "/rest/v1/user_video_history" && request.method === "GET") {
    const requestedUser = filterValue(url, "user_id");
    if (!userId || requestedUser !== userId) return sendJson(response, 200, []);
    const rows = historyRows
      .filter((history) => history.user_id === userId)
      .sort((a, b) => b.accessed_at.localeCompare(a.accessed_at))
      .map((history) => ({
        accessed_at: history.accessed_at,
        videos: canonicalVideos.find((video) => video.id === history.video_id) ?? null,
      }));
    return sendJson(response, 200, rows);
  }

  if (url.pathname === "/rest/v1/project_source_sets" && request.method === "GET") {
    const projectId = filterValue(url, "project_id");
    if (!projectId || projectOwnerId(projectId) !== userId) {
      return sendJson(response, 200, []);
    }
    const revision = sourceSetRevisions.get(projectId);
    return sendJson(
      response,
      200,
      revision === undefined
        ? []
        : [
            {
              revision,
              project_videos: orderedMemberships(projectId).map((membership) => ({
                ...membership,
                videos:
                  canonicalVideos.find(
                    (video) => video.id === membership.video_id,
                  ) ?? null,
              })),
            },
          ],
    );
  }

  if (url.pathname === "/rest/v1/project_videos" && request.method === "GET") {
    const projectId = filterValue(url, "project_id");
    if (!projectId || projectOwnerId(projectId) !== userId) {
      return sendJson(response, 200, []);
    }
    return sendJson(
      response,
      200,
      orderedMemberships(projectId).map((membership) => ({
        ...membership,
        videos:
          canonicalVideos.find((video) => video.id === membership.video_id) ?? null,
      })),
    );
  }

  if (url.pathname.startsWith("/rest/v1/rpc/") && request.method === "POST") {
    return handleSourceSetRpc(request, response, url, userId, serviceRole);
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
  serviceRole: boolean,
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
      (serviceRole || project.workspace_id === userWorkspace) &&
      (!workspaceFilter || project.workspace_id === workspaceFilter) &&
      (!idFilter || project.id === idFilter),
  );

  if (request.method === "HEAD") {
    response.writeHead(200, {
      "content-range":
        visible.length === 0
          ? "*/0"
          : `0-${visible.length - 1}/${visible.length}`,
    });
    response.end();
    return;
  }

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
    const tier = userId
      ? userSubscriptions.get(userId)?.tier ?? "free"
      : "free";
    if (
      tier !== "pro" &&
      projects.some((project) => project.workspace_id === userWorkspace)
    ) {
      return sendJson(
        response,
        400,
        postgrestError("P0001", "FREE_PROJECT_LIMIT_REACHED"),
      );
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
    for (let membershipIndex = projectVideos.length - 1; membershipIndex >= 0; membershipIndex -= 1) {
      if (projectVideos[membershipIndex].project_id === deleted.id) {
        projectVideos.splice(membershipIndex, 1);
      }
    }
    sourceSetRevisions.delete(deleted.id);
    projectConversations.delete(deleted.id);
    projectConversationThreads.delete(deleted.id);
    return sendJson(response, 200, [{ id: deleted.id }]);
  }

  return sendJson(response, 405, postgrestError("FIXTURE_METHOD", "Unsupported method"));
}

async function handleSourceSetRpc(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  userId: string | null,
  serviceRole: boolean,
) {
  const body = (await readJson(request)) as {
    p_project_id?: string;
    p_name?: string;
    p_query?: string;
    p_limit?: number;
    p_video_id?: string;
    p_video_ids?: string[];
    p_expected_revision?: number;
    p_search?: string;
    p_page?: number;
    p_page_size?: number;
    p_question?: string;
    p_owner_id?: string;
    p_conversation_id?: string;
    p_user_message_id?: string;
    p_attempt_token?: string;
    p_assistant_content?: string;
    p_answer_classification?: "supported" | "abstained" | "unsupported";
    p_source_set_revision?: number;
    p_source_manifest?: unknown;
    p_source_coverage?: unknown;
    p_evidence_snapshot?: unknown;
    p_citation_diagnostics?: unknown[];
    p_mode?:
      | "question"
      | "compare_viewpoints"
      | "common_themes"
      | "find_gaps"
      | "project_assessment";
    p_user_id?: string;
  };
  const projectId = body.p_project_id;

  if (url.pathname.endsWith("/increment_rate_limit")) {
    return sendJson(response, 200, 1);
  }

  if (url.pathname.endsWith("/complete_project_grounded_answer")) {
    if (!serviceRole || !projectId || body.p_owner_id !== projectOwnerId(projectId)) {
      return sendJson(response, 200, { outcome: "stale" });
    }
    const conversation = findConversation(projectId, body.p_conversation_id);
    const userMessage = conversation?.messages.find(
      (message) =>
        message.id === body.p_user_message_id &&
        message.role === "user" &&
        message.attemptToken === body.p_attempt_token,
    );
    if (
      !conversation ||
      conversation.id !== body.p_conversation_id ||
      !userMessage ||
      userMessage.completionState !== "reserved" ||
      body.p_source_set_revision !== (sourceSetRevisions.get(projectId) ?? 0)
    ) {
      return sendJson(response, 200, { outcome: "stale" });
    }
    const existing = conversation.messages.find(
      (message) =>
        message.role === "assistant" &&
        message.inReplyToMessageId === userMessage.id,
    );
    if (existing) {
      return sendJson(response, 200, {
        outcome: "already_completed",
        assistantMessageId: existing.id,
      });
    }
    if (
      !body.p_assistant_content ||
      !body.p_answer_classification ||
      !body.p_source_manifest ||
      !body.p_source_coverage ||
      !body.p_evidence_snapshot ||
      !Array.isArray(body.p_citation_diagnostics)
    ) {
      return sendJson(response, 200, { outcome: "invalid" });
    }
    messageSequence += 1;
    const assistantMessageId = `c2000000-0000-4000-8000-${String(messageSequence).padStart(12, "0")}`;
    conversation.messages.push({
      id: assistantMessageId,
      inReplyToMessageId: userMessage.id,
      role: "assistant",
      content: body.p_assistant_content,
      createdAt: nextTimestamp(),
      answerClassification: body.p_answer_classification,
      sourceSetRevision: body.p_source_set_revision,
      sourceManifest: body.p_source_manifest,
      sourceCoverage: body.p_source_coverage,
      evidenceSnapshot: body.p_evidence_snapshot,
      citationDiagnostics: body.p_citation_diagnostics,
      mode: body.p_mode ?? userMessage.mode ?? "question",
    });
    userMessage.completionState = "completed";
    return sendJson(response, 200, {
      outcome: "completed",
      assistantMessageId,
    });
  }

  if (!projectId || !userId || projectOwnerId(projectId) !== userId) {
    return sendJson(response, 200, { outcome: "missing" });
  }

  if (url.pathname.endsWith("/list_project_conversations")) {
    const tier = userSubscriptions.get(userId)?.tier ?? "free";
    const threads = conversationThreads(projectId);
    const messagesUsed = threads.reduce(
      (total, thread) =>
        total + thread.messages.filter((message) => message.role === "user").length,
      0,
    );
    return sendJson(response, 200, {
      outcome: "ready",
      conversations: threads
        .slice()
        .sort((a, b) =>
          (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.id.localeCompare(a.id),
        )
        .map((thread) => ({
          id: thread.id,
          name: thread.name ?? "Project Conversation",
          createdAt: thread.createdAt ?? nextTimestamp(),
          updatedAt: thread.updatedAt ?? thread.createdAt ?? nextTimestamp(),
          messageCount: thread.clearedAt
            ? thread.messages.filter((message) => message.createdAt > thread.clearedAt!).length
            : thread.messages.length,
        })),
      messagesUsed,
      messagesLimit: tier === "pro" ? null : 5,
      tier,
    });
  }

  if (url.pathname.endsWith("/create_project_conversation")) {
    conversationSequence += 1;
    const timestamp = nextTimestamp();
    const conversation: FixtureConversation = {
      id: `c1000000-0000-4000-8000-${String(conversationSequence).padStart(12, "0")}`,
      projectId,
      name: body.p_name?.trim() || "New conversation",
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [],
    };
    conversationThreads(projectId).push(conversation);
    return sendJson(response, 200, {
      outcome: "created",
      conversation: {
        id: conversation.id,
        name: conversation.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        messageCount: 0,
      },
    });
  }

  if (url.pathname.endsWith("/rename_project_conversation")) {
    const conversation = findConversation(projectId, body.p_conversation_id);
    if (!conversation) return sendJson(response, 200, { outcome: "missing" });
    const name = body.p_name?.trim() ?? "";
    if (!name || name.length > 120) return sendJson(response, 200, { outcome: "invalid" });
    conversation.name = name;
    conversation.updatedAt = nextTimestamp();
    return sendJson(response, 200, { outcome: "renamed" });
  }

  if (url.pathname.endsWith("/clear_project_conversation")) {
    const conversation = findConversation(projectId, body.p_conversation_id);
    if (!conversation) return sendJson(response, 200, { outcome: "missing" });
    conversation.clearedAt = nextTimestamp();
    conversation.updatedAt = conversation.clearedAt;
    return sendJson(response, 200, { outcome: "cleared" });
  }

  if (url.pathname.endsWith("/cancel_project_grounded_question")) {
    const conversation = findConversation(projectId, body.p_conversation_id);
    const userMessage = conversation?.messages.find(
      (message) =>
        message.id === body.p_user_message_id && message.role === "user",
    );
    if (!conversation || !userMessage) {
      return sendJson(response, 200, { outcome: "missing" });
    }
    conversation.messages = conversation.messages.filter(
      (message) =>
        message.role !== "assistant" ||
        message.inReplyToMessageId !== userMessage.id,
    );
    userMessage.completionState = "cancelled";
    return sendJson(response, 200, { outcome: "cancelled" });
  }

  if (url.pathname.endsWith("/load_default_project_conversation")) {
    const conversation = findConversation(projectId);
    const tier = userSubscriptions.get(userId)?.tier ?? "free";
    const messages = conversation
      ? visibleConversationMessagesAfterClear(conversation)
      : [];
    return sendJson(response, 200, {
      outcome: "ready",
      conversationId: conversation?.id ?? null,
      messages: messages.map(visibleConversationMessage),
      sourceSetEvents: conversation?.sourceSetEvents ?? [],
      messagesUsed: conversationThreads(projectId).reduce(
        (total, thread) =>
          total + thread.messages.filter((message) => message.role === "user").length,
        0,
      ),
      messagesLimit: tier === "pro" ? null : 5,
      tier,
    });
  }

  if (url.pathname.endsWith("/load_project_conversation")) {
    const conversation = findConversation(projectId, body.p_conversation_id);
    const tier = userSubscriptions.get(userId)?.tier ?? "free";
    return sendJson(response, 200, {
      outcome: "ready",
      conversationId: conversation?.id ?? null,
      messages: conversation
        ? visibleConversationMessagesAfterClear(conversation).map(visibleConversationMessage)
        : [],
      sourceSetEvents: conversation?.sourceSetEvents ?? [],
      messagesUsed: conversationThreads(projectId).reduce(
        (total, thread) =>
          total + thread.messages.filter((message) => message.role === "user").length,
        0,
      ),
      messagesLimit: tier === "pro" ? null : 5,
      tier,
    });
  }

  if (url.pathname.endsWith("/start_project_grounded_question")) {
    const tier = userSubscriptions.get(userId)?.tier ?? "free";
    let conversation = findConversation(projectId, body.p_conversation_id);
    const messagesUsed = conversationThreads(projectId).reduce(
      (total, thread) =>
        total + thread.messages.filter((message) => message.role === "user").length,
      0,
    );
    if (tier !== "pro" && messagesUsed >= 5) {
      return sendJson(response, 200, {
        outcome: "limit_reached",
        messagesUsed: 5,
        messagesLimit: 5,
        tier: "free",
      });
    }
    if (!body.p_question || body.p_question.trim().length < 2) {
      return sendJson(response, 200, { outcome: "invalid" });
    }
    if (!conversation) {
      conversationSequence += 1;
      const timestamp = nextTimestamp();
      conversation = {
        id: `c1000000-0000-4000-8000-${String(conversationSequence).padStart(12, "0")}`,
        projectId,
        name: "Project Conversation",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [],
      };
      projectConversations.set(projectId, conversation);
      projectConversationThreads.set(projectId, [conversation]);
    }
    const history = visibleConversationMessagesAfterClear(conversation)
      .slice(-16)
      .map(visibleConversationMessage);
    messageSequence += 1;
    const userMessageId = `c3000000-0000-4000-8000-${String(messageSequence).padStart(12, "0")}`;
    const attemptToken = `c4000000-0000-4000-8000-${String(messageSequence).padStart(12, "0")}`;
    conversation.messages.push({
      id: userMessageId,
      inReplyToMessageId: null,
      role: "user",
      content: body.p_question.trim(),
      createdAt: nextTimestamp(),
      answerClassification: null,
      sourceSetRevision: sourceSetRevisions.get(projectId) ?? 0,
      sourceManifest: null,
      sourceCoverage: null,
      citationDiagnostics: null,
      mode: body.p_mode ?? "question",
      attemptToken,
      completionState: "reserved",
    });
    conversation.updatedAt = nextTimestamp();
    return sendJson(response, 200, {
      outcome: "started",
      conversationId: conversation.id,
      userMessageId,
      attemptToken,
      messagesUsed: messagesUsed + 1,
      messagesLimit: tier === "pro" ? null : 5,
      tier,
      history,
    });
  }

  if (
    url.pathname.endsWith("/search_project_transcript_passages") ||
    url.pathname.endsWith("/search_project_transcript_passages_balanced")
  ) {
    const memberships = orderedMemberships(projectId);
    const ready = memberships.filter((membership) => membership.status === "ready");
    const unavailableVideos = memberships
      .filter((membership) => membership.status !== "ready")
      .map((membership) => {
        const video = canonicalVideos.find(
          (candidate) => candidate.id === membership.video_id,
        );
        return {
          videoId: membership.video_id,
          youtubeVideoId: youtubeVideoId(video?.youtube_url),
          title: video?.title ?? null,
          channelName: video?.channel_name ?? null,
          status: membership.status,
          failureCode: membership.failure_code,
        };
      });
    const coverage = {
      totalVideos: memberships.length,
      readyVideos: ready.length,
      unavailableVideos,
      passagesExamined: ready.length * 2,
    };
    const sourceSetRevision = sourceSetRevisions.get(projectId) ?? 0;
    if (ready.length === 0) {
      return sendJson(response, 200, {
        outcome: "not_ready",
        sourceSetRevision,
        coverage,
        passages: [],
      });
    }
    if (body.p_query?.trim().toLowerCase() === "absent") {
      return sendJson(response, 200, {
        outcome: "no_results",
        sourceSetRevision,
        coverage,
        passages: [],
      });
    }

    const passageFixtures = [
      {
        membership: ready[0],
        text: "Climate adaptation depends on exact local evidence.",
        language: "en",
      },
      {
        membership: ready[1] ?? ready[0],
        text: "气候适应需要准确的本地证据。",
        language: "zh-Hans",
      },
    ];
    const passages = passageFixtures
      .slice(0, Math.max(1, Math.min(body.p_limit ?? 8, 10)))
      .map(({ membership, text, language }, index) => {
        const video = canonicalVideos.find(
          (candidate) => candidate.id === membership.video_id,
        );
        return {
          passageId: `${membership.video_id}:${index + 1}:0:${Array.from(text).length}`,
          videoId: membership.video_id,
          youtubeVideoId: youtubeVideoId(video?.youtube_url),
          title: video?.title ?? null,
          channelName: video?.channel_name ?? null,
          text,
          segmentOrdinal: index + 1,
          excerptStartCharacter: 0,
          excerptEndCharacter: Array.from(text).length,
          startSeconds: 42.75,
          endSeconds: 48.25,
          language,
          truncatedStart: false,
          truncatedEnd: false,
        };
      });
    return sendJson(response, 200, {
      outcome: "ready",
      sourceSetRevision,
      coverage,
      passages,
    });
  }

  if (url.pathname.endsWith("/list_project_history_candidates")) {
    const search = body.p_search?.trim().toLowerCase() ?? "";
    const page = Math.max(1, body.p_page ?? 1);
    const pageSize = Math.min(25, Math.max(1, body.p_page_size ?? 10));
    const eligible = historyRows
      .filter(
        (history) =>
          history.user_id === userId &&
          processedVideoIds.has(history.video_id) &&
          !projectVideos.some(
            (membership) =>
              membership.project_id === projectId &&
              membership.video_id === history.video_id,
          ),
      )
      .map((history) => ({
        history,
        video: canonicalVideos.find((video) => video.id === history.video_id),
      }))
      .filter(
        (candidate): candidate is {
          history: FixtureHistory;
          video: FixtureVideo;
        } => {
          if (!candidate.video) return false;
          return (
            !search ||
            candidate.video.title.toLowerCase().includes(search) ||
            candidate.video.channel_name.toLowerCase().includes(search)
          );
        },
      )
      .sort(
        (left, right) =>
          right.history.accessed_at.localeCompare(left.history.accessed_at) ||
          left.video.id.localeCompare(right.video.id),
      );
    const offset = (page - 1) * pageSize;
    return sendJson(response, 200, {
      outcome: "resolved",
      page,
      pageSize,
      total: eligible.length,
      totalPages: eligible.length === 0 ? 0 : Math.ceil(eligible.length / pageSize),
      candidates: eligible.slice(offset, offset + pageSize).map(({ history, video }) => ({
        videoId: video.id,
        youtubeUrl: video.youtube_url,
        title: video.title,
        channelName: video.channel_name,
        viewedAt: history.accessed_at,
      })),
    });
  }

  const revision = sourceSetRevisions.get(projectId) ?? 0;
  if (body.p_expected_revision !== revision) {
    return sendJson(response, 200, { outcome: "conflict", revision });
  }

  if (url.pathname.endsWith("/add_project_history_video")) {
    const videoId = body.p_video_id;
    if (!videoId) return sendJson(response, 200, { outcome: "not_in_history", revision });
    if (
      projectVideos.some(
        (membership) =>
          membership.project_id === projectId && membership.video_id === videoId,
      )
    ) {
      return sendJson(response, 200, { outcome: "duplicate", revision });
    }
    if (
      !historyRows.some(
        (history) => history.user_id === userId && history.video_id === videoId,
      )
    ) {
      return sendJson(response, 200, { outcome: "not_in_history", revision });
    }
    if (!processedVideoIds.has(videoId)) {
      return sendJson(response, 200, { outcome: "not_ready", revision });
    }
    const memberships = orderedMemberships(projectId);
    if (memberships.length >= 5) {
      return sendJson(response, 200, { outcome: "limit_reached", revision });
    }
    const timestamp = nextTimestamp();
    projectVideos.push({
      project_id: projectId,
      video_id: videoId,
      position: memberships.length + 1,
      status: "ready",
      failure_code: null,
      added_at: timestamp,
      status_updated_at: timestamp,
    });
    sourceSetRevisions.set(projectId, revision + 1);
    return sendJson(response, 200, { outcome: "added", revision: revision + 1 });
  }

  if (url.pathname.endsWith("/remove_project_video")) {
    const membership = projectVideos.find(
      (candidate) =>
        candidate.project_id === projectId && candidate.video_id === body.p_video_id,
    );
    if (!membership) {
      return sendJson(response, 200, { outcome: "membership_missing", revision });
    }
    const membershipIndex = projectVideos.indexOf(membership);
    projectVideos.splice(membershipIndex, 1);
    for (const candidate of projectVideos) {
      if (
        candidate.project_id === projectId &&
        candidate.position > membership.position
      ) {
        candidate.position -= 1;
      }
    }
    sourceSetRevisions.set(projectId, revision + 1);
    return sendJson(response, 200, { outcome: "removed", revision: revision + 1 });
  }

  if (url.pathname.endsWith("/reorder_project_videos")) {
    const requested = body.p_video_ids;
    const memberships = orderedMemberships(projectId);
    if (
      !requested ||
      requested.length !== memberships.length ||
      new Set(requested).size !== requested.length ||
      requested.some(
        (videoId) => !memberships.some((membership) => membership.video_id === videoId),
      )
    ) {
      return sendJson(response, 200, { outcome: "invalid_order", revision });
    }
    const current = memberships.map((membership) => membership.video_id);
    if (current.every((videoId, index) => videoId === requested[index])) {
      return sendJson(response, 200, { outcome: "unchanged", revision });
    }
    requested.forEach((videoId, index) => {
      const membership = memberships.find((candidate) => candidate.video_id === videoId);
      if (membership) membership.position = index + 1;
    });
    sourceSetRevisions.set(projectId, revision + 1);
    return sendJson(response, 200, { outcome: "reordered", revision: revision + 1 });
  }

  return sendJson(
    response,
    404,
    postgrestError("FIXTURE_RPC_NOT_FOUND", `Unsupported RPC ${url.pathname}`),
  );
}

function youtubeVideoId(youtubeUrl: string | undefined) {
  if (!youtubeUrl) return null;
  return new URL(youtubeUrl).searchParams.get("v");
}

function visibleConversationMessage(message: FixtureConversationMessage) {
  return {
    id: message.id,
    inReplyToMessageId: message.inReplyToMessageId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    answerClassification: message.answerClassification,
    sourceSetRevision: message.sourceSetRevision,
    sourceManifest: message.sourceManifest,
    sourceCoverage: message.sourceCoverage,
    ...(message.evidenceSnapshot
      ? { evidenceSnapshot: message.evidenceSnapshot }
      : {}),
    citationDiagnostics: message.citationDiagnostics,
    ...(message.mode ? { mode: message.mode } : {}),
  };
}

function visibleConversationMessagesAfterClear(conversation: FixtureConversation) {
  return conversation.clearedAt
    ? conversation.messages.filter((message) => message.createdAt > conversation.clearedAt!)
    : conversation.messages;
}

function conversationThreads(projectId: string) {
  let threads = projectConversationThreads.get(projectId);
  if (!threads) {
    threads = [];
    projectConversationThreads.set(projectId, threads);
  }
  const legacyDefault = projectConversations.get(projectId);
  if (legacyDefault && !threads.some((thread) => thread.id === legacyDefault.id)) {
    threads.unshift(legacyDefault);
    projectConversationThreads.set(projectId, threads);
  }
  return threads;
}

function findConversation(projectId: string, conversationId?: string | null) {
  const threads = conversationThreads(projectId);
  if (conversationId) return threads.find((thread) => thread.id === conversationId);
  return (
    threads.find((thread) => thread.name === "Project Conversation") ??
    threads[0]
  );
}

function seedCanonicalHistory() {
  const titles = [
    "Alpha evidence",
    "Beta processing",
    "Gamma failed",
    "Delta context",
    "Epsilon counterpoint",
    "Zeta overflow",
  ];
  titles.forEach((title, index) => {
    const ordinal = index + 1;
    const suffix = String(ordinal).padStart(12, "0");
    const videoId = `71000000-0000-4000-8000-${suffix}`;
    canonicalVideos.push({
      id: videoId,
      youtube_url: `https://www.youtube.com/watch?v=aaaaaaa000${ordinal}`,
      title,
      channel_name: "Fixture Evidence Lab",
    });
    historyRows.push({
      user_id: OWNER_ID,
      video_id: videoId,
      accessed_at: new Date(Date.UTC(2026, 7, 8, 12, 0, 10 - ordinal)).toISOString(),
    });
    processedVideoIds.add(videoId);
  });

  for (let index = 1; index <= 30; index += 1) {
    const suffix = String(index).padStart(12, "0");
    const videoId = `72000000-0000-4000-8000-${suffix}`;
    canonicalVideos.push({
      id: videoId,
      youtube_url: `https://www.youtube.com/watch?v=archive${String(index).padStart(4, "0")}`,
      title: index === 30 ? "Legacy deep evidence" : `Archive source ${index}`,
      channel_name: "Long History Archive",
    });
    historyRows.push({
      user_id: OWNER_ID,
      video_id: videoId,
      accessed_at: new Date(Date.UTC(2026, 0, 31 - index, 12)).toISOString(),
    });
    processedVideoIds.add(videoId);
  }

  const unprocessedId = "73000000-0000-4000-8000-000000000001";
  canonicalVideos.push({
    id: unprocessedId,
    youtube_url: "https://www.youtube.com/watch?v=unprocessed",
    title: "Unprocessed draft",
    channel_name: "Fixture Evidence Lab",
  });
  historyRows.push({
    user_id: OWNER_ID,
    video_id: unprocessedId,
    accessed_at: new Date(Date.UTC(2026, 7, 9, 12)).toISOString(),
  });
}

function projectOwnerId(projectId: string): string | null {
  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;
  if (project.workspace_id === OWNER_WORKSPACE_ID) return OWNER_ID;
  if (project.workspace_id === OTHER_WORKSPACE_ID) return OTHER_ID;
  return null;
}

function orderedMemberships(projectId: string) {
  return projectVideos
    .filter((membership) => membership.project_id === projectId)
    .sort((a, b) => a.position - b.position);
}

function fixtureSourceSet(projectId: string) {
  return {
    projectId,
    revision: sourceSetRevisions.get(projectId) ?? 0,
    videos: orderedMemberships(projectId).map((membership) => {
      const video = canonicalVideos.find(
        (candidate) => candidate.id === membership.video_id,
      );
      if (!video) {
        throw new Error("Fixture Source Set membership is missing its canonical Video.");
      }
      return {
        videoId: video.id,
        youtubeUrl: video.youtube_url,
        youtubeVideoId: new URL(video.youtube_url).searchParams.get("v"),
        title: video.title,
        channelName: video.channel_name,
        position: membership.position,
        status: membership.status,
        failureCode: membership.failure_code,
        addedAt: membership.added_at,
        statusUpdatedAt: membership.status_updated_at,
      };
    }),
  };
}

function transitionFixtureStatus(
  projectId: string,
  videoId: string,
  status: FixtureProjectVideo["status"],
  failureCode: string | null,
) {
  const membership = projectVideos.find(
    (candidate) =>
      candidate.project_id === projectId && candidate.video_id === videoId,
  );
  const revision = sourceSetRevisions.get(projectId);
  if (!membership || revision === undefined) {
    throw new Error("Fixture status transition requires an existing Source Set member.");
  }
  membership.status = status;
  membership.failure_code = failureCode;
  membership.status_updated_at = nextTimestamp();
  sourceSetRevisions.set(projectId, revision + 1);
}

function orderedSourceTitles(page: Page) {
  return page.getByTestId("project-source-title");
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

function isServiceRoleRequest(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${FIXTURE_SERVICE_ROLE_KEY}`;
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
      name: FIXTURE_AUTH_COOKIE_NAME,
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

function createGatewayGate(): FixtureGatewayGate {
  let resolveRelease!: () => void;
  const waitForRelease = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });
  return {
    waitForRelease,
    release: resolveRelease,
  };
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
