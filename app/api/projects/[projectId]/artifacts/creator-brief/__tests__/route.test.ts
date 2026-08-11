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
const SOURCE_TEXT =
  "The team delayed the launch until testing could demonstrate reliability.";
const CONTENT = `# Creator Brief

## Source claims

- Inspiration: Team delayed launch testing reliability [S1 @ 00:42].

## Proposed ideas

- Gap: Evidence basis: reliability testing; Goal fit: original launch Video; Original move: Show how unfinished reliability testing changes an original launch Video decision [S1 @ 00:42].
- Combination: Evidence basis: delayed reliability; Goal fit: original launch Video; Original move: Pair delayed reliability choices with an original launch Video checklist [S1 @ 00:42].
- Counterargument: Evidence basis: testing reliability; Goal fit: original launch Video; Original move: Ask when testing reliability makes an original launch Video too cautious [S1 @ 00:42].
- Original angle: Evidence basis: reliability testing; Goal fit: original launch Video; Original move: Make reliability testing visible inside each original launch Video decision [S1 @ 00:42].

## Originality plan

- Source sequence: delay > evidence > demonstration [S1 @ 00:42].
- Proposed sequence: hook > decision > framework.

## Video direction

- Proposed beat: Evidence basis: reliability testing; Goal fit: original launch Video; Original move: Open with reliability testing, then build a decision framework for an original launch Video [S1 @ 00:42].`;

const PASSAGE = {
  passageId: `${VIDEO_ID}:1:0:72`,
  videoId: VIDEO_ID,
  youtubeVideoId: "aaaaaaa0001",
  title: "Launch notes",
  channelName: "Research channel",
  text: SOURCE_TEXT,
  segmentOrdinal: 1,
  excerptStartCharacter: 0,
  excerptEndCharacter: 72,
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
        { passageId: PASSAGE.passageId, startSeconds: 42, endSeconds: 58 },
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
  kind: "creator_brief" as const,
  content: CONTENT,
  sourceSetRevision: 3,
  sourceManifest: SOURCE_MANIFEST,
  sourceCoverage: SOURCE_COVERAGE,
  evidenceSnapshot: EVIDENCE_SNAPSHOT,
  citationDiagnostics: [],
  generationMetadata: {
    model: "gpt-5.3-codex-spark",
    promptVersion: "creator-brief-v1",
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
  guidance: { goal: "Create an original launch Video." },
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
    `http://test/api/projects/${PROJECT_ID}/artifacts/creator-brief`,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "issue-324-route-test",
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

describe("Project Creator Brief API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "resolved",
      principal: { userId: USER_ID, isAnonymous: false, projectAvailability: "invited" },
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
      kind: "creator_brief",
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

  it("loads Creator Brief current/history/provenance through the shared Artifact capability", async () => {
    const response = await GET(request("GET"), CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ creatorBrief: LOADED });
    expect(mocks.load).toHaveBeenCalledWith("creator_brief");
  });

  it("generates, validates, and persists only the Creator Brief kind", async () => {
    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ creatorBrief: LOADED });
    expect(mocks.reserve).toHaveBeenCalledWith("creator_brief", ATTEMPT_TOKEN);
    expect(mocks.search).toHaveBeenCalledWith({
      query: expect.stringContaining("Creator Brief"),
      limit: 10,
      balanceSources: true,
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: expect.objectContaining({ kind: "creator_brief" }),
        content: CONTENT,
        artifacts: expect.objectContaining({
          evidenceSnapshot: EVIDENCE_SNAPSHOT,
        }),
        citationDiagnostics: [],
        generationMetadata: expect.objectContaining({
          promptVersion: "creator-brief-v1",
        }),
      }),
    );
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["an ASCII-hyphen terminal range", "[S1 @ 00:42-00:58]"],
    ["an en-dash terminal range", "[S1 @ 00:42–00:58]"],
  ])("persists a Source claim with %s", async (_name, citation) => {
    const content = CONTENT.replace(
      "Team delayed launch testing reliability [S1 @ 00:42]",
      `Team delayed launch testing reliability ${citation}`,
    );
    model(content);

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ content }),
    );
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("releases the reservation and never persists source-similar model output", async () => {
    model(
      CONTENT.replace(
        "Team delayed launch testing reliability",
        SOURCE_TEXT.slice(0, -1),
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

  it.each([
    {
      name: "a fabricated cited Source claim",
      content: CONTENT.replace(
        "Team delayed launch testing reliability",
        "Celebrity wardrobe drove launch publicity",
      ),
    },
    {
      name: "a relation-inverted cited Source claim",
      content: CONTENT.replace(
        "Team delayed launch testing reliability",
        "Launch delayed reliability testing",
      ),
    },
    {
      name: "a multi-citation Source claim",
      content: CONTENT.replace(
        "Team delayed launch testing reliability [S1 @ 00:42]",
        "Team delayed launch testing reliability [S1 @ 00:42] [S1 @ 00:42]",
      ),
    },
    {
      name: "a mid-line Source claim citation",
      content: CONTENT.replace(
        "Team delayed launch testing reliability [S1 @ 00:42]",
        "[S1 @ 00:42] Team delayed launch testing reliability",
      ),
    },
    {
      name: "an unsupported celebrity-countdown Proposed beat",
      content: CONTENT.replace(
        "Open with reliability testing, then build a decision framework for an original launch Video",
        "Wrap reliability testing and an original launch Video around a celebrity countdown",
      ),
    },
  ])("releases the reservation and never persists $name", async ({ content }) => {
    model(content);

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "leading negation",
      sourceText:
        "Not after several attempts, the team delayed launch until testing demonstrated reliability.",
      claim: "Delayed launch testing reliability",
    },
    {
      name: "trailing negation",
      sourceText:
        "The team delayed launch until testing demonstrated reliability, which it did not.",
      claim: "Delayed launch testing reliability",
    },
  ])("rolls back when a Source claim omits $name", async ({ sourceText, claim }) => {
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 6,
      },
      passages: [
        {
          ...PASSAGE,
          passageId: `${VIDEO_ID}:1:0:${sourceText.length}`,
          text: sourceText,
          excerptEndCharacter: sourceText.length,
        },
      ],
    });
    model(
      CONTENT.replace("Team delayed launch testing reliability", claim),
    );

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "leading negation",
      sourceText:
        "Not after several attempts, the team delayed launch until testing demonstrated reliability.",
      claim: "Not delayed launch testing reliability",
    },
    {
      name: "trailing negation",
      sourceText:
        "The team delayed launch until testing demonstrated reliability, which it did not.",
      claim: "Delayed launch testing reliability not",
    },
  ])("persists a Source claim that preserves $name", async ({ sourceText, claim }) => {
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 6,
      },
      passages: [
        {
          ...PASSAGE,
          passageId: `${VIDEO_ID}:1:0:${sourceText.length}`,
          text: sourceText,
          excerptEndCharacter: sourceText.length,
        },
      ],
    });
    model(
      CONTENT.replace("Team delayed launch testing reliability", claim),
    );

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("uses the shared cross-kind Free Artifact quota envelope", async () => {
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
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
