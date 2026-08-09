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
const VIDEO_ID = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "50000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "60000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "70000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };
const CONTENT = `# Study Guide

## Overview

The launch happened in April [S1 @ 00:42].

## Key ideas

- The passage dates the launch to April [S1 @ 00:42].

## Review questions

1. When did the launch happen [S1 @ 00:42]?`;

const PASSAGE = {
  passageId: `${VIDEO_ID}:1:0:45`,
  videoId: VIDEO_ID,
  youtubeVideoId: "aaaaaaa0001",
  title: "Launch notes",
  channelName: "Research channel",
  text: "The source says the launch happened in April.",
  segmentOrdinal: 1,
  excerptStartCharacter: 0,
  excerptEndCharacter: 45,
  startSeconds: 42,
  endSeconds: 58,
  language: "en",
  truncatedStart: false,
  truncatedEnd: false,
} as const;

const SOURCE_MANIFEST = {
  projectId: PROJECT_ID,
  sourceSetRevision: 3,
  sources: [
    {
      sourceId: "S1",
      videoId: VIDEO_ID,
      youtubeVideoId: "aaaaaaa0001",
      title: "Launch notes",
      channelName: "Research channel",
      passages: [
        {
          passageId: PASSAGE.passageId,
          startSeconds: 42,
          endSeconds: 58,
        },
      ],
    },
  ],
} as const;

const SOURCE_COVERAGE = {
  totalVideos: 1,
  readyVideos: 1,
  evidenceVideos: 1,
  unavailableVideos: [],
  passagesExamined: 6,
  evidencePassages: 1,
} as const;

const EVIDENCE_SNAPSHOT = {
  projectId: PROJECT_ID,
  sourceSetRevision: 3,
  passages: [PASSAGE],
} as const;

const ARTIFACT = {
  artifactId: ARTIFACT_ID,
  projectId: PROJECT_ID,
  kind: "study_guide" as const,
  content: CONTENT,
  sourceSetRevision: 3,
  sourceManifest: SOURCE_MANIFEST,
  sourceCoverage: SOURCE_COVERAGE,
  evidenceSnapshot: EVIDENCE_SNAPSHOT,
  citationDiagnostics: [],
  generationMetadata: {
    model: "gpt-5.3-codex-spark",
    promptVersion: "study-guide-v1",
    generatedAt: "2026-08-09T18:00:00.000Z",
  },
  createdAt: "2026-08-09T18:00:00.000Z",
  supersededAt: null,
  updateAvailable: false,
};

const LOADED = {
  status: "ready" as const,
  currentSourceSetRevision: 3,
  current: ARTIFACT,
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
  guidance: { goal: "Focus on launch timing." },
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
    `http://test/api/projects/${PROJECT_ID}/artifacts/study-guide`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "issue-323-route-test",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

function rawPost(body: string) {
  return new Request(
    `http://test/api/projects/${PROJECT_ID}/artifacts/study-guide`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "issue-323-route-test",
      },
      body,
    },
  );
}

function model(content = CONTENT) {
  mocks.streamChatCompletion.mockImplementation(async function* () {
    yield { type: "delta", text: content.slice(0, 40) };
    yield { type: "delta", text: content.slice(40) };
    yield { type: "done" };
  });
}

describe("Project Study Guide API", () => {
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
      kind: "study_guide",
      tier: "free",
      generationsUsed: 0,
      generationsLimit: 1,
    });
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 6,
      },
      passages: [PASSAGE],
    });
    mocks.complete.mockResolvedValue({ status: "completed", artifact: ARTIFACT });
    mocks.fail.mockResolvedValue({ status: "failed" });
    model();
  });

  it("loads the current guide, audit history, staleness, and quota state", async () => {
    const response = await GET(request("GET"), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ studyGuide: LOADED });
    expect(mocks.load).toHaveBeenCalledWith("study_guide");
  });

  it("rejects malformed and unknown request fields before auth or database work", async () => {
    for (const invalidRequest of [
      rawPost("not-json"),
      request("POST", { attemptToken: "not-a-uuid" }),
      request("POST", { attemptToken: ATTEMPT_TOKEN, extra: true }),
    ]) {
      const response = await POST(invalidRequest, CONTEXT);
      expect(response.status).toBe(400);
      expect(response.headers.get("X-Error-ID")).toBe(
        "PROJECT_STUDY_GUIDE_REQUEST_INVALID",
      );
      await expect(response.json()).resolves.toEqual({
        message: "Study Guide generation request is not valid.",
      });
    }
    expect(mocks.requireRegisteredResearcher).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("preserves authentication and owner-denial envelopes without reserving", async () => {
    mocks.requireRegisteredResearcher.mockResolvedValueOnce({
      kind: "error",
      response: Response.json(
        { outcome: "unauthenticated", message: "Sign in to use Projects." },
        { status: 401 },
      ),
    });
    const unauthenticated = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      outcome: "unauthenticated",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();

    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false },
    });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "forbidden" });
    const forbidden = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      outcome: "forbidden",
      message: "Project access is not allowed.",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("fails closed for client and subject adapter failures on GET and POST", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("cookies unavailable"));
    const getClientFailure = await GET(request("GET"), CONTEXT);
    expect(getClientFailure.status).toBe(503);
    expect(getClientFailure.headers.get("X-Error-ID")).toBe(
      "PROJECTS_UNAVAILABLE",
    );

    mocks.createClient.mockRejectedValueOnce(new Error("cookies unavailable"));
    const postClientFailure = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(postClientFailure.status).toBe(503);
    expect(postClientFailure.headers.get("X-Error-ID")).toBe(
      "PROJECTS_UNAVAILABLE",
    );

    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockRejectedValueOnce(new Error("subject failed"));
    const getSubjectFailure = await GET(request("GET"), CONTEXT);
    expect(getSubjectFailure.status).toBe(503);
    expect(getSubjectFailure.headers.get("X-Error-ID")).toBe(
      "PROJECTS_UNAVAILABLE",
    );

    mocks.resolveProjectSubject.mockRejectedValueOnce(new Error("subject failed"));
    const postSubjectFailure = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(postSubjectFailure.status).toBe(503);
    expect(postSubjectFailure.headers.get("X-Error-ID")).toBe(
      "PROJECTS_UNAVAILABLE",
    );
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("preserves missing and unavailable GET envelopes", async () => {
    mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "missing" });
    const missingSubject = await GET(request("GET"), CONTEXT);
    expect(missingSubject.status).toBe(404);
    await expect(missingSubject.json()).resolves.toMatchObject({
      outcome: "missing",
    });

    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: SUBJECT,
    });
    mocks.load.mockResolvedValueOnce({ status: "unavailable" });
    const unavailableLoad = await GET(request("GET"), CONTEXT);
    expect(unavailableLoad.status).toBe(503);
    expect(unavailableLoad.headers.get("X-Error-ID")).toBe(
      "PROJECTS_UNAVAILABLE",
    );
  });

  it("generates only from ready Transcript passages, validates citations, and durably completes", async () => {
    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ studyGuide: LOADED });
    expect(mocks.reserve).toHaveBeenCalledWith("study_guide", ATTEMPT_TOKEN);
    expect(mocks.search).toHaveBeenCalledWith({
      query: expect.stringContaining("Study Guide"),
      limit: 10,
    });
    expect(mocks.streamChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining("EVIDENCE_SNAPSHOT"),
          }),
        ]),
      }),
    );
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        content: CONTENT,
        artifacts: expect.objectContaining({
          evidenceSnapshot: EVIDENCE_SNAPSHOT,
        }),
        citationDiagnostics: [],
      }),
    );
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("releases a reservation when evidence is not ready or generated citations are invalid", async () => {
    mocks.search.mockResolvedValueOnce({
      status: "not_ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 0,
        unavailableVideos: [
          {
            videoId: VIDEO_ID,
            youtubeVideoId: "aaaaaaa0001",
            title: "Launch notes",
            channelName: "Research channel",
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
      "PROJECT_STUDY_GUIDE_EVIDENCE_NOT_READY",
    );
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 6,
      },
      passages: [PASSAGE],
    });
    mocks.reserve.mockResolvedValue({
      status: "started",
      attemptId: ATTEMPT_ID,
      attemptToken: ATTEMPT_TOKEN,
      kind: "study_guide",
      tier: "free",
      generationsUsed: 0,
      generationsLimit: 1,
    });
    mocks.fail.mockResolvedValue({ status: "failed" });
    model(CONTENT.replaceAll("S1", "S9"));
    const invalid = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );
    expect(invalid.status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("uses the existing 402 envelope with Artifact-specific quota signals", async () => {
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
    await expect(response.json()).resolves.toEqual({
      message:
        "Free includes 1 Artifact generation total. Upgrade to Pro for unlimited Artifact generations within technical and abuse limits.",
      errorCode: "free_artifact_generation_exceeded",
      tier: "free",
      upgradeUrl: "/pricing",
      artifactGenerationsUsed: 1,
      artifactGenerationsLimit: 1,
    });
    expect(response.headers.get("X-Error-ID")).toBe(
      "PROJECT_ARTIFACT_QUOTA_EXCEEDED",
    );
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("maps the database invalid reservation outcome to the intended 400 envelope", async () => {
    mocks.reserve.mockResolvedValue({ status: "invalid" });

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Error-ID")).toBe(
      "PROJECT_STUDY_GUIDE_REQUEST_INVALID",
    );
    await expect(response.json()).resolves.toEqual({
      message: "Study Guide generation request is not valid.",
    });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("returns the exact conflict envelope and logs a failed reservation release", async () => {
    mocks.complete.mockResolvedValue({ status: "conflict" });
    mocks.fail.mockResolvedValue({ status: "unavailable" });

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("X-Error-ID")).toBe(
      "PROJECT_STUDY_GUIDE_SOURCE_SET_CHANGED",
    );
    expect(response.headers.get("X-Request-ID")).toBe(
      "issue-323-route-test",
    );
    await expect(response.json()).resolves.toEqual({
      message:
        "The Source Set changed while the Study Guide was being generated. Try again to use the latest evidence.",
    });
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(mocks.logAppEvent).toHaveBeenCalledWith(
      "error",
      "[project-study-guide] reservation release failed",
      expect.objectContaining({
        errorId: "PROJECT_ARTIFACT_RELEASE_FAILED",
        requestId: "issue-323-route-test",
      }),
    );
  });

  it("fails closed without both Project capabilities", async () => {
    mocks.resolveProjectSubject.mockResolvedValue({
      kind: "resolved",
      value: { ...SUBJECT, artifacts: undefined },
    });
    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(503);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
});
