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

> Trust note: Only exact source-language clauses and canonical citations are authoritative evidence. Agreement, disagreement, and open-question labels are non-authoritative model Interpretation; inspect the cited clauses.

## Important findings

- The launch should happen in April [S1 @ 00:12].

## Agreements

- Agreement A: {"issue":"launch-trust","relation":"states","clause":"Transparent testing helps people trust the launch"} [S1 @ 00:24].
- Agreement B: {"issue":"launch-trust","relation":"states","clause":"Transparent testing builds trust before a public launch"} [S2 @ 00:31].

## Material disagreements

- Position A: {"issue":"launch-timing","relation":"supports","clause":"The launch should happen in April"} [S1 @ 00:12].
- Position B: {"issue":"launch-timing","relation":"opposes","clause":"The launch should wait until June"} [S2 @ 00:18].

## Open questions

- No model-identified open question in this Evidence Snapshot.`;

const NORMALIZATION = JSON.stringify({
  records: [
    { candidateId: "C1", sourceId: "S1", citation: "[S1 @ 00:12]", clause: "The launch should happen in April", interpretation: { issueKey: "launch-timing", relation: "supports", resolution: "settled" } },
    { candidateId: "C2", sourceId: "S1", citation: "[S1 @ 00:12]", clause: "the team is ready", interpretation: { issueKey: "team-readiness", relation: "states", resolution: "settled" } },
    { candidateId: "C3", sourceId: "S2", citation: "[S2 @ 00:18]", clause: "The launch should wait until June", interpretation: { issueKey: "launch-timing", relation: "opposes", resolution: "settled" } },
    { candidateId: "C4", sourceId: "S2", citation: "[S2 @ 00:18]", clause: "testing is incomplete", interpretation: { issueKey: "testing-readiness", relation: "states", resolution: "settled" } },
    { candidateId: "C5", sourceId: "S1", citation: "[S1 @ 00:24]", clause: "Transparent testing helps people trust the launch", interpretation: { issueKey: "launch-trust", relation: "states", resolution: "settled" } },
    { candidateId: "C6", sourceId: "S2", citation: "[S2 @ 00:31]", clause: "Transparent testing builds trust before a public launch", interpretation: { issueKey: "launch-trust", relation: "states", resolution: "settled" } },
  ],
});

const PLAN = JSON.stringify({
  importantFindingRecordIds: ["R1"],
  agreementRecordIdPairs: [["R5", "R6"]],
  disagreementRecordIdPairs: [["R1", "R3"]],
  openQuestionRecordIds: [],
});

const RENDERED_CONTENT = `# Project Brief

> Trust note: Only exact source-language clauses and canonical citations are authoritative evidence. Agreement, disagreement, and open-question labels are non-authoritative model Interpretation; inspect the cited clauses.

## Important findings

- The launch should happen in April [S1 @ 00:12].

## Agreements

- Interpretation — possible agreement A: Transparent testing helps people trust the launch [S1 @ 00:24].
- Interpretation — possible agreement B: Transparent testing builds trust before a public launch [S2 @ 00:31].

## Material disagreements

- Interpretation — possible disagreement position A: The launch should happen in April [S1 @ 00:12].
- Interpretation — possible disagreement position B: The launch should wait until June [S2 @ 00:18].

## Open questions

- No model-identified open question in this Evidence Snapshot.`;

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

function model(content = PLAN, normalization = NORMALIZATION) {
  let call = 0;
  mocks.streamChatCompletion.mockImplementation(async function* () {
    const generated = call++ === 0 ? normalization : content;
    yield { type: "delta", text: generated.slice(0, 80) };
    yield { type: "delta", text: generated.slice(80) };
    yield { type: "done" };
  });
}

function modelSequence(...contents: readonly string[]) {
  for (const content of contents) {
    mocks.streamChatCompletion.mockImplementationOnce(async function* () {
      yield { type: "delta", text: content };
      yield { type: "done" };
    });
  }
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
        content: RENDERED_CONTENT,
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
          promptVersion: "project-brief-v3",
          normalizationAudit: {
            version: "project-brief-normalization-v2",
            recordSetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
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

  it("normalizes evidence before accepting a final plan made only from server-issued record IDs", async () => {
    modelSequence(NORMALIZATION, PLAN);

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    const normalizationPrompt = mocks.streamChatCompletion.mock.calls[0][0]
      .messages[0].content as string;
    const finalPrompt = mocks.streamChatCompletion.mock.calls[1][0].messages[0]
      .content as string;
    expect(normalizationPrompt).not.toContain("Compare launch timing");
    expect(finalPrompt).toContain('"recordId":"R1"');
    expect(finalPrompt).toContain("Compare launch timing");
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it.each([
    [
      "possible agreement from model-interpreted opposition",
      { ...JSON.parse(PLAN), agreementRecordIdPairs: [["R1", "R3"]] },
    ],
    [
      "possible disagreement from model-interpreted support",
      { ...JSON.parse(PLAN), disagreementRecordIdPairs: [["R5", "R6"]] },
    ],
    [
      "possible disagreement across unrelated model issue labels",
      { ...JSON.parse(PLAN), disagreementRecordIdPairs: [["R4", "R5"]] },
    ],
    [
      "Important finding with an unknown evidence record",
      { ...JSON.parse(PLAN), importantFindingRecordIds: ["R99"] },
    ],
    [
      "possible open question from a model-settled record",
      { ...JSON.parse(PLAN), openQuestionRecordIds: ["R1"] },
    ],
  ])("releases a v2 ID-only selector attack: %s", async (_label, invalidPlan) => {
    model(JSON.stringify(invalidPlan));

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(503);
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("persists a Spanish-only opposing clause under the controlled proposition contract", async () => {
    const affirmativeText = "Climate adaptation depends on exact local evidence.";
    const affirmativeLength = Array.from(affirmativeText).length;
    const affirmativePassage = {
      ...PASSAGES[0],
      passageId: `${VIDEO_ONE_ID}:1:0:${affirmativeLength}`,
      text: affirmativeText,
      excerptEndCharacter: affirmativeLength,
    };
    const spanishText =
      "La adaptación climática no debe depender solo de evidencia local exacta; debe priorizar comparaciones regionales.";
    const spanishLength = Array.from(spanishText).length;
    const spanishPassage = {
      ...PASSAGES[2],
      passageId: `${VIDEO_TWO_ID}:1:0:${spanishLength}`,
      text: spanishText,
      excerptEndCharacter: spanishLength,
      language: "es",
    };
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 2,
        readyVideos: 2,
        unavailableVideos: [],
        passagesExamined: 8,
      },
      passages: [affirmativePassage, PASSAGES[1], spanishPassage, PASSAGES[3]],
    });
    const multilingualNormalization = JSON.stringify({
      records: [
        { candidateId: "C1", sourceId: "S1", citation: "[S1 @ 00:24]", clause: "Transparent testing helps people trust the launch", interpretation: { issueKey: "launch-trust", relation: "states", resolution: "settled" } },
        { candidateId: "C2", sourceId: "S2", citation: "[S2 @ 00:31]", clause: "Transparent testing builds trust before a public launch", interpretation: { issueKey: "launch-trust", relation: "states", resolution: "settled" } },
        { candidateId: "C3", sourceId: "S1", citation: "[S1 @ 00:12]", clause: "Climate adaptation depends on exact local evidence", interpretation: { issueKey: "climate-evidence", relation: "supports", resolution: "settled" } },
        { candidateId: "C4", sourceId: "S2", citation: "[S2 @ 00:18]", clause: "La adaptación climática no debe depender solo de evidencia local exacta", interpretation: { issueKey: "climate-evidence", relation: "opposes", resolution: "settled" } },
        { candidateId: "C5", sourceId: "S2", citation: "[S2 @ 00:18]", clause: "debe priorizar comparaciones regionales", interpretation: { issueKey: "regional-comparison", relation: "states", resolution: "settled" } },
      ],
    });
    const multilingualPlan = JSON.stringify({
      importantFindingRecordIds: ["R3", "R4"],
      agreementRecordIdPairs: [["R1", "R2"]],
      disagreementRecordIdPairs: [["R3", "R4"]],
      openQuestionRecordIds: [],
    });
    model(multilingualPlan, multilingualNormalization);

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining(
        "Interpretation — possible disagreement position B: La adaptación climática no debe depender solo de evidencia local exacta [S2 @ 00:18].",
      ),
    }));
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("persists a Spanish unresolved question whose words stay inside its exact gap clause", async () => {
    const spanishGap = "La fecha exacta del lanzamiento sigue sin resolverse.";
    const gapLength = Array.from(spanishGap).length;
    const gapPassage = {
      ...PASSAGES[0],
      passageId: `${VIDEO_ONE_ID}:1:0:${gapLength}`,
      text: spanishGap,
      excerptEndCharacter: gapLength,
      language: "es",
    };
    mocks.search.mockResolvedValue({
      status: "ready",
      sourceSetRevision: 3,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 1,
      },
      passages: [gapPassage],
    });
    const spanishNormalization = JSON.stringify({
      records: [{
        candidateId: "C1",
        sourceId: "S1",
        citation: "[S1 @ 00:12]",
        clause: "La fecha exacta del lanzamiento sigue sin resolverse",
        interpretation: {
          issueKey: "launch-timing",
          relation: "states",
          resolution: "unresolved",
        },
      }],
    });
    const spanishPlan = JSON.stringify({
      importantFindingRecordIds: ["R1"],
      agreementRecordIdPairs: [],
      disagreementRecordIdPairs: [],
      openQuestionRecordIds: ["R1"],
    });
    model(spanishPlan, spanishNormalization);

    const response = await POST(
      request("POST", { attemptToken: ATTEMPT_TOKEN }),
      CONTEXT,
    );

    expect(response.status).toBe(201);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining(
        "Interpretation — possible open question: La fecha exacta del lanzamiento sigue sin resolverse [S1 @ 00:12].",
      ),
    }));
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "not-json"],
    [
      "incomplete coverage",
      JSON.stringify({ records: JSON.parse(NORMALIZATION).records.slice(0, -1) }),
    ],
    [
      "fabricated clause",
      NORMALIZATION.replace("the team is ready", "Shakira is ready"),
    ],
    [
      "cross-source identity",
      NORMALIZATION.replace('"sourceId":"S1"', '"sourceId":"S2"'),
    ],
  ])(
    "releases before final generation when normalization has %s",
    async (_label, invalidNormalization) => {
      model(PLAN, invalidNormalization);

      const response = await POST(
        request("POST", { attemptToken: ATTEMPT_TOKEN }),
        CONTEXT,
      );

      expect(response.status).toBe(503);
      expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.fail).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["unknown record", PLAN.replace('"R1"', '"R99"')],
    ["issue override", JSON.stringify({ ...JSON.parse(PLAN), issue: "celebrity-location" })],
    ["relation override", JSON.stringify({ ...JSON.parse(PLAN), relation: "states" })],
    ["resolution override", JSON.stringify({ ...JSON.parse(PLAN), resolution: "unresolved" })],
  ])(
    "releases without persistence when the final selector attempts an %s",
    async (_label, invalidPlan) => {
      model(invalidPlan);

      const response = await POST(
        request("POST", { attemptToken: ATTEMPT_TOKEN }),
        CONTEXT,
      );

      expect(response.status).toBe(503);
      expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.fail).toHaveBeenCalledOnce();
    },
  );
});
