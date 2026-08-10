import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  checkRateLimit: vi.fn(),
  streamChatCompletion: vi.fn(),
  load: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  search: vi.fn(),
  logAppEvent: vi.fn(),
}));

vi.mock("@/lib/projects/registered-researcher", () => ({
  requireRegisteredResearcher: mocks.requireRegisteredResearcher,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/projects/project-subject", () => ({
  resolveProjectSubject: mocks.resolveProjectSubject,
}));
vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/services/llm-chat-client", () => ({
  streamChatCompletion: mocks.streamChatCompletion,
}));
vi.mock("@/lib/observability", () => ({ logAppEvent: mocks.logAppEvent }));

import { GET, POST } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "30000000-0000-4000-8000-000000000001";
const VIDEO_ONE_ID = "40000000-0000-4000-8000-000000000001";
const VIDEO_TWO_ID = "40000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "50000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "60000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "70000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };

const CONTENT = `# Project Brief

## Important findings

- One source supports an April launch because the team is ready [S1 @ 00:12].

## Agreements

- Both sources connect trust to transparent testing [S1 @ 00:24] [S2 @ 00:31].

## Material disagreements

- Position A: The launch should happen in April because the team is ready [S1 @ 00:12].
- Position B: The launch should wait until June because testing is incomplete [S2 @ 00:18].

## Open questions

- Which timing is better supported after testing finishes [S1 @ 00:12] [S2 @ 00:18]?`;

const PASSAGES = [
  {
    passageId: `${VIDEO_ONE_ID}:1:0:60`,
    videoId: VIDEO_ONE_ID,
    youtubeVideoId: "aaaaaaa0001",
    title: "Launch proposal",
    channelName: "Research channel",
    text: "The launch should happen in April because the team is ready.",
    segmentOrdinal: 1,
    excerptStartCharacter: 0,
    excerptEndCharacter: 60,
    startSeconds: 12,
    endSeconds: 18,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  },
  {
    passageId: `${VIDEO_ONE_ID}:2:0:50`,
    videoId: VIDEO_ONE_ID,
    youtubeVideoId: "aaaaaaa0001",
    title: "Launch proposal",
    channelName: "Research channel",
    text: "Transparent testing helps people trust the launch.",
    segmentOrdinal: 2,
    excerptStartCharacter: 0,
    excerptEndCharacter: 50,
    startSeconds: 24,
    endSeconds: 29,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  },
  {
    passageId: `${VIDEO_TWO_ID}:1:0:64`,
    videoId: VIDEO_TWO_ID,
    youtubeVideoId: "bbbbbbb0002",
    title: "Launch counterpoint",
    channelName: "Evidence lab",
    text: "The launch should wait until June because testing is incomplete.",
    segmentOrdinal: 1,
    excerptStartCharacter: 0,
    excerptEndCharacter: 64,
    startSeconds: 18,
    endSeconds: 23,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  },
  {
    passageId: `${VIDEO_TWO_ID}:2:0:56`,
    videoId: VIDEO_TWO_ID,
    youtubeVideoId: "bbbbbbb0002",
    title: "Launch counterpoint",
    channelName: "Evidence lab",
    text: "Transparent testing builds trust before a public launch.",
    segmentOrdinal: 2,
    excerptStartCharacter: 0,
    excerptEndCharacter: 56,
    startSeconds: 31,
    endSeconds: 36,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  },
] as const;

const SOURCE_MANIFEST = {
  projectId: PROJECT_ID,
  sourceSetRevision: 3,
  sources: [
    {
      sourceId: "S1",
      videoId: VIDEO_ONE_ID,
      youtubeVideoId: "aaaaaaa0001",
      title: "Launch proposal",
      channelName: "Research channel",
      passages: PASSAGES.slice(0, 2).map((passage) => ({
        passageId: passage.passageId,
        startSeconds: passage.startSeconds,
        endSeconds: passage.endSeconds,
      })),
    },
    {
      sourceId: "S2",
      videoId: VIDEO_TWO_ID,
      youtubeVideoId: "bbbbbbb0002",
      title: "Launch counterpoint",
      channelName: "Evidence lab",
      passages: PASSAGES.slice(2).map((passage) => ({
        passageId: passage.passageId,
        startSeconds: passage.startSeconds,
        endSeconds: passage.endSeconds,
      })),
    },
  ],
} as const;

const LOADED = {
  status: "ready" as const,
  currentSourceSetRevision: 3,
  current: {
    artifactId: ARTIFACT_ID,
    projectId: PROJECT_ID,
    kind: "project_brief" as const,
    content: CONTENT,
    sourceSetRevision: 3,
    sourceManifest: SOURCE_MANIFEST,
    sourceCoverage: {
      totalVideos: 2,
      readyVideos: 2,
      evidenceVideos: 2,
      unavailableVideos: [],
      passagesExamined: 8,
      evidencePassages: 4,
    },
    evidenceSnapshot: {
      projectId: PROJECT_ID,
      sourceSetRevision: 3,
      passages: PASSAGES,
    },
    citationDiagnostics: [],
    generationMetadata: {
      model: "gpt-5.3-codex-spark",
      promptVersion: "project-brief-v1",
      generatedAt: "2026-08-09T18:00:00.000Z",
    },
    createdAt: "2026-08-09T18:00:00.000Z",
    supersededAt: null,
    updateAvailable: false,
  },
  history: [],
  tier: "free" as const,
  generationsUsed: 1,
  generationsLimit: 1 as const,
};

const SUBJECT = {
  kind: "project" as const,
  projectId: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  ownerId: USER_ID,
  name: "Private Project",
  guidance: { goal: "Compare launch timing." },
  lastActiveAt: "2026-08-09T00:00:00.000Z",
  artifacts: {
    load: mocks.load,
    reserve: mocks.reserve,
    complete: mocks.complete,
    fail: mocks.fail,
  },
  passageSearch: { search: mocks.search },
};

function request(method: "GET" | "POST", body?: unknown) {
  return new Request(
    `http://test/api/projects/${PROJECT_ID}/artifacts/project-brief`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "issue-325-route-test",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

function model(content = CONTENT) {
  mocks.streamChatCompletion.mockImplementation(async function* () {
    yield { type: "delta", text: content.slice(0, 80) };
    yield { type: "delta", text: content.slice(80) };
    yield { type: "done" };
  });
}

describe("Project Brief API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false },
    });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: SUBJECT,
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.load.mockResolvedValue(LOADED);
    mocks.reserve.mockResolvedValue({
      status: "started",
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      kind: "project_brief",
      tier: "free",
      generationsUsed: 0,
      generationsLimit: 1,
    });
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 8,
      },
      passages: PASSAGES,
    });
    mocks.complete.mockResolvedValue({
      status: "completed",
      artifact: LOADED.current,
    });
    mocks.fail.mockResolvedValue({ status: "failed" });
    model();
  });

  it("loads only the owner-scoped current Project Brief and audit state", async () => {
    const response = await GET(request("GET"), CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ projectBrief: LOADED });
    expect(mocks.load).toHaveBeenCalledWith("project_brief");
  });

  it("generates from source-balanced evidence, buffers model output, validates it, and persists provenance", async () => {
    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ projectBrief: LOADED });
    expect(mocks.reserve).toHaveBeenCalledWith("project_brief", ATTEMPT_TOKEN);
    expect(mocks.search).toHaveBeenCalledWith({
      query: expect.stringContaining("Project Brief"),
      limit: 10,
      balanceSources: true,
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: CONTENT,
        reservation: expect.objectContaining({ kind: "project_brief" }),
        artifacts: expect.objectContaining({
          sourceManifest: SOURCE_MANIFEST,
          evidenceSnapshot: expect.objectContaining({
            // #324 canonicalizes the immutable snapshot into balanced source
            // order instead of preserving the grouped retrieval input.
            passages: [PASSAGES[0], PASSAGES[2], PASSAGES[1], PASSAGES[3]],
          }),
        }),
        generationMetadata: expect.objectContaining({
          promptVersion: "project-brief-v1",
        }),
      }),
    );
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("rejects malformed requests before auth and preserves auth, owner, and adapter envelopes", async () => {
    const malformed = new Request(request("POST").url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const invalid = await POST(malformed, CONTEXT);
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("X-Error-ID")).toBe(
      "PROJECT_BRIEF_REQUEST_INVALID",
    );
    expect(mocks.requireRegisteredResearcher).not.toHaveBeenCalled();

    mocks.requireRegisteredResearcher.mockResolvedValueOnce({
      kind: "error",
      response: Response.json({ outcome: "unauthenticated" }, { status: 401 }),
    });
    expect(
      (await POST(request("POST", { attemptToken: ATTEMPT_TOKEN }), CONTEXT))
        .status,
    ).toBe(401);

    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false },
    });
    mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "forbidden" });
    expect(
      (await POST(request("POST", { attemptToken: ATTEMPT_TOKEN }), CONTEXT))
        .status,
    ).toBe(403);

    mocks.createClient.mockRejectedValueOnce(new Error("cookies unavailable"));
    expect((await GET(request("GET"), CONTEXT)).status).toBe(503);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("shares the existing Free Artifact quota across kinds without retrieving or generating", async () => {
    mocks.reserve.mockResolvedValue({
      status: "limit_reached",
      tier: "free",
      generationsUsed: 1,
      generationsLimit: 1,
    });
    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "free_artifact_generation_exceeded",
      artifactGenerationsUsed: 1,
      artifactGenerationsLimit: 1,
    });
    expect(response.headers.get("X-Error-ID")).toBe(
      "PROJECT_ARTIFACT_QUOTA_EXCEEDED",
    );
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("releases reservations for unavailable evidence, malformed model output, and revision conflict", async () => {
    mocks.search.mockResolvedValueOnce({
      status: "not_ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 2,
        readyVideos: 0,
        unavailableVideos: [
          {
            videoId: VIDEO_ONE_ID,
            youtubeVideoId: "aaaaaaa0001",
            title: "Launch proposal",
            channelName: "Research channel",
            status: "processing",
            failureCode: null,
          },
          {
            videoId: VIDEO_TWO_ID,
            youtubeVideoId: "bbbbbbb0002",
            title: "Launch counterpoint",
            channelName: "Evidence lab",
            status: "processing",
            failureCode: null,
          },
        ],
        passagesExamined: 0,
      },
    });
    const notReady = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(notReady.status).toBe(409);
    expect(notReady.headers.get("X-Error-ID")).toBe(
      "PROJECT_BRIEF_EVIDENCE_NOT_READY",
    );
    expect(mocks.fail).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 8,
      },
      passages: PASSAGES,
    });
    mocks.reserve.mockResolvedValue({
      status: "started",
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      kind: "project_brief",
      tier: "free",
      generationsUsed: 0,
      generationsLimit: 1,
    });
    mocks.fail.mockResolvedValue({ status: "failed" });
    model(CONTENT.replaceAll("S2", "S9"));
    const malformed = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(malformed.status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 8,
      },
      passages: PASSAGES,
    });
    mocks.reserve.mockResolvedValue({
      status: "started",
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      kind: "project_brief",
      tier: "pro",
      generationsUsed: 2,
      generationsLimit: null,
    });
    mocks.complete.mockResolvedValue({ status: "conflict" });
    mocks.fail.mockResolvedValue({ status: "failed" });
    model();
    const conflict = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("X-Error-ID")).toBe(
      "PROJECT_BRIEF_SOURCE_SET_CHANGED",
    );
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("does not persist a cited false agreement that contradicts the immutable Evidence Snapshot", async () => {
    model(
      CONTENT.replace(
        "Both sources connect trust to transparent testing",
        "Both sources agree that April is the settled best launch date",
      ),
    );

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("rolls back a collapsed disagreement even when the model cites both material sources", async () => {
    model(
      CONTENT.replace(
        "- Position A: The launch should happen in April because the team is ready [S1 @ 00:12].\n- Position B: The launch should wait until June because testing is incomplete [S2 @ 00:18].",
        "- Both sources support a careful launch after testing [S1 @ 00:12] [S2 @ 00:18].",
      ),
    );

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });
});
