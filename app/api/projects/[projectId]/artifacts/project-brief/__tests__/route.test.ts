import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => vi.restoreAllMocks());

const { mocks, afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => void | Promise<void>>,
  mocks: {
    after: vi.fn(),
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
    researchUsage: vi.fn(),
    recordProjectAnalyticsTransition: vi.fn(),
    recordProjectGenerationUsage: vi.fn(),
  },
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: mocks.after };
});

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
vi.mock("@/lib/projects/project-passage-search", () => ({
  createProjectResearchPassageSearchCapability: vi.fn(() => ({ search: mocks.search })),
}));
vi.mock("@/lib/projects/project-research-retrieval", () => ({
  retrieveProjectResearchEvidence: async (args: { question: string; onPlanningStart?: () => void; onUsage: (usage: unknown) => void }) => {
    args.onPlanningStart?.();
    const usage = mocks.researchUsage();
    if (usage) args.onUsage(usage);
    return mocks.search({ query: args.question, limit: 10, balanceSources: true });
  },
}));
vi.mock("@/lib/analytics/project-server", () => ({
  recordProjectAnalyticsTransition: mocks.recordProjectAnalyticsTransition,
  recordProjectGenerationUsage: mocks.recordProjectGenerationUsage,
}));

import { GET, POST } from "../route";
import { ChatGatewayError } from "@/lib/services/llm-chat-error";
import { createProjectArtifactRoute } from "@/lib/projects/project-artifact-route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "30000000-0000-4000-8000-000000000001";
const VIDEO_ONE_ID = "40000000-0000-4000-8000-000000000001";
const VIDEO_TWO_ID = "40000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "50000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "60000000-0000-4000-8000-000000000001";
const ARTIFACT_ID = "70000000-0000-4000-8000-000000000001";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };

const RENDERED_CONTENT = `# Project Brief

> Trust note: Only exact source-language clauses and canonical citations are authoritative evidence. Agreement, disagreement, possible-conflict, and open-question labels are non-authoritative model Interpretation; inspect the cited clauses. A non-certified possible agreement, conflict, or open question does not establish that its cited clauses agree, contradict each other, or leave an issue unresolved.

## Important findings

- The launch should happen in April [S1 @ 00:12].

## Agreements

- Interpretation — possible agreement A: Transparent testing helps people trust the launch [S1 @ 00:24].
- Interpretation — possible agreement B: Transparent testing helps people trust the launch [S2 @ 00:31].

## Material disagreements

- Interpretation — possible disagreement position A: The launch should happen in April [S1 @ 00:12].
- Interpretation — possible disagreement position B: The launch should not happen in April [S2 @ 00:18].

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
    passageId: `${VIDEO_TWO_ID}:1:0:68`,
    videoId: VIDEO_TWO_ID,
    youtubeVideoId: "bbbbbbb0002",
    title: "Launch counterpoint",
    channelName: "Evidence lab",
    text: "The launch should not happen in April because testing is incomplete.",
    segmentOrdinal: 1,
    excerptStartCharacter: 0,
    excerptEndCharacter: 68,
    startSeconds: 18,
    endSeconds: 23,
    language: "en",
    truncatedStart: false,
    truncatedEnd: false,
  },
  {
    passageId: `${VIDEO_TWO_ID}:2:0:50`,
    videoId: VIDEO_TWO_ID,
    youtubeVideoId: "bbbbbbb0002",
    title: "Launch counterpoint",
    channelName: "Evidence lab",
    text: "Transparent testing helps people trust the launch.",
    segmentOrdinal: 2,
    excerptStartCharacter: 0,
    excerptEndCharacter: 50,
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
    content: RENDERED_CONTENT,
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
      model: "gpt-6-luna",
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

function plan() {
  const reference = (evidenceId: string, passageIndex: number): { evidenceId: string; quote: string } => ({ evidenceId, quote: PASSAGES[passageIndex].text });
  return {
    overview: { text: "The speakers disagree about April timing while sharing an emphasis on transparent testing.", evidence: [reference("E1", 0), reference("E2", 2)] },
    findings: [
      { text: "The proposal favors April because its team is ready.", evidence: [reference("E1", 0)] },
      { text: "The counterpoint opposes April because testing remains incomplete.", evidence: [reference("E2", 2)] },
    ],
    agreements: [{ text: "Both speakers describe transparent testing as a way to build trust.", evidence: [reference("E3", 1), reference("E4", 3)] }],
    disagreements: [{ text: "Readiness leads the speakers to different recommendations on April timing.", evidence: [reference("E1", 0), reference("E2", 2)] }],
    openQuestions: [{ text: "Which tests must be completed before the team can commit to a date?", evidence: [reference("E2", 2)] }],
  };
}

function model(content = JSON.stringify(plan())) {
  mocks.streamChatCompletion.mockImplementation(async function* () {
    yield { type: "delta", text: content.slice(0, 80) };
    yield { type: "delta", text: content.slice(80) };
    yield { type: "done" };
  });
}

function readySearch() {
  return {
    status: "ready", sourceSetRevision: 3,
    coverage: { totalVideos: 2, readyVideos: 2, unavailableVideos: [], passagesExamined: 8 },
    passages: PASSAGES,
  };
}

function reservation() {
  return { status: "started", attemptId: ATTEMPT_ID, attemptToken: ATTEMPT_TOKEN, kind: "project_brief", tier: "free", generationsUsed: 0, generationsLimit: 1 };
}

function post() { return POST(request("POST", { attemptToken: ATTEMPT_TOKEN }), CONTEXT); }

describe("Project Brief API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    afterCallbacks.length = 0;
    mocks.after.mockImplementation((callback: () => void | Promise<void>) => afterCallbacks.push(callback));
    mocks.requireRegisteredResearcher.mockResolvedValue({ kind: "resolved", principal: { userId: USER_ID, isAnonymous: false } });
    mocks.createClient.mockResolvedValue({ fixture: true });
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "resolved", value: SUBJECT });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.load.mockResolvedValue(LOADED);
    mocks.reserve.mockResolvedValue(reservation());
    mocks.search.mockResolvedValue(readySearch());
    mocks.complete.mockResolvedValue({ status: "completed", artifact: LOADED.current });
    mocks.fail.mockResolvedValue({ status: "failed" });
    model();
  });

  it("keeps historical stored Briefs readable without reinterpreting their content", async () => {
    const response = await GET(request("GET"), CONTEXT);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ projectBrief: LOADED });
    expect(mocks.load).toHaveBeenCalledWith("project_brief");
  });

  it("persists useful synthesis with exact supporting quotations, canonical citations and immutable provenance", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(mocks.search).toHaveBeenCalledWith({ query: expect.stringContaining("Compare launch timing"), limit: 10, balanceSources: true });
    const completed = mocks.complete.mock.calls[0][0];
    expect(completed.content).toContain("The proposal favors April because its team is ready. [S1 @ 00:12]");
    expect(completed.content).toContain("The counterpoint opposes April because testing remains incomplete. [S2 @ 00:18]");
    expect(completed.content).toContain("Both speakers describe transparent testing as a way to build trust. [S1 @ 00:24] [S2 @ 00:31]");
    expect(completed.content).toContain("not an independent fact check");
    expect(completed.content).toContain("> The launch should happen in April because the team is ready. [S1 @ 00:12]");
    expect(completed.artifacts.sourceManifest).toEqual(SOURCE_MANIFEST);
    expect(completed.artifacts.evidenceSnapshot.passages).toEqual([PASSAGES[0], PASSAGES[2], PASSAGES[1], PASSAGES[3]]);
    expect(completed.generationMetadata).toMatchObject({ promptVersion: "project-brief-v6", normalizationAudit: { version: "project-brief-context-v3", recordSetHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("keeps planned findings ahead of an English leading goal while retaining goal guidance", async () => {
    const goal = "Prove seed oils are dangerous and inflammatory.";
    const texts = ["The controlled trial reported a different outcome.", ...Array(8).fill("Seed oils are dangerous and inflammatory.")];
    const passages = texts.map((text: string, index) => ({
      ...PASSAGES[0], text, segmentOrdinal: index + 1,
      passageId: `${VIDEO_ONE_ID}:${index + 1}:0:${text.length}`,
      excerptEndCharacter: text.length, startSeconds: 120 + index * 10, endSeconds: 125 + index * 10,
    }));
    mocks.resolveProjectSubject.mockResolvedValue({ kind: "resolved", value: { ...SUBJECT, guidance: { goal } } });
    mocks.search.mockResolvedValue({ ...readySearch(),
      coverage: { totalVideos: 1, readyVideos: 1, unavailableVideos: [], passagesExamined: 9 }, passages,
    });
    mocks.streamChatCompletion.mockImplementation(async function* ({ messages }) {
      const prompt = messages[0].content as string;
      const [first] = JSON.parse(prompt.split("IMMUTABLE_CONTEXTUAL_EVIDENCE:\n")[1]);
      const observation = { text: "The source presents its finding with the quoted context.", evidence: [{ evidenceId: first.evidenceId, quote: first.text }] };
      yield { type: "delta", text: JSON.stringify({ overview: observation, findings: [observation], agreements: [], disagreements: [], openQuestions: [] }) };
    });
    expect((await post()).status).toBe(201);
    const persisted = mocks.complete.mock.calls[0][0];
    expect(persisted.artifacts.evidenceSnapshot.passages).toHaveLength(8);
    expect(persisted.artifacts.evidenceSnapshot.passages[0]).toEqual(passages[0]);
    expect(mocks.streamChatCompletion.mock.calls[0][0].messages[0].content).toContain(goal);
  });

  it("rejects malformed requests before auth and preserves owner checks", async () => {
    const malformed = new Request(request("POST").url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "not-json" });
    expect((await POST(malformed, CONTEXT)).status).toBe(400);
    expect(mocks.requireRegisteredResearcher).not.toHaveBeenCalled();
    mocks.requireRegisteredResearcher.mockResolvedValueOnce({ kind: "error", response: Response.json({}, { status: 401 }) });
    expect((await post()).status).toBe(401);
    mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "forbidden" });
    expect((await post()).status).toBe(403);
    mocks.createClient.mockRejectedValueOnce(new Error("cookies unavailable"));
    expect((await GET(request("GET"), CONTEXT)).status).toBe(503);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("checks the shared Free quota before retrieval or provider work", async () => {
    mocks.reserve.mockResolvedValue({ status: "limit_reached", tier: "free", generationsUsed: 1, generationsLimit: 1 });
    const response = await post();
    expect(response.status).toBe(402);
    expect(response.headers.get("X-Error-ID")).toBe("PROJECT_ARTIFACT_QUOTA_EXCEEDED");
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("releases a reservation when evidence is not ready or retrieval fails", async () => {
    mocks.search.mockResolvedValueOnce({ status: "not_ready", sourceSetRevision: 3, coverage: { totalVideos: 0, readyVideos: 0, unavailableVideos: [], passagesExamined: 0 }, passages: [] });
    const response = await post();
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Error-ID")).toBe("PROJECT_BRIEF_EVIDENCE_NOT_READY");
    expect(mocks.fail).toHaveBeenCalledOnce();
    mocks.search.mockRejectedValueOnce(new Error("query planning failed"));
    expect((await post()).status).toBe(503);
    expect(mocks.fail).toHaveBeenCalledTimes(2);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown evidence", "unknown_evidence"],
    ["altered quote", "altered_quotation"],
    ["single-source comparison", "comparison_requires_distinct_sources"],
    ["model citation", "untrusted_presentation"],
    ["missing source", "missing_source"],
    ["malformed JSON", "invalid_structure"],
  ])("rejects %s with a safe server-only validation reason", async (attack, validationReason) => {
    const output = plan();
    if (attack === "unknown evidence") output.findings[0].evidence[0].evidenceId = "E99";
    if (attack === "altered quote") output.findings[0].evidence[0].quote = "The source actually opposed the launch.";
    if (attack === "single-source comparison") output.disagreements[0].evidence = [output.findings[0].evidence[0]];
    if (attack === "model citation") output.findings[0].text += " [S9 @ 99:99]";
    if (attack === "missing source") {
      output.overview.evidence = [output.findings[0].evidence[0]];
      output.findings = [output.findings[0]];
      output.agreements = []; output.disagreements = []; output.openQuestions = [];
    }
    model(attack === "malformed JSON" ? "not-json" : JSON.stringify(output));
    const response = await post();
    expect(response.status).toBe(503);
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[project-brief] generation failed", expect.objectContaining({ stage: "validation", reason: validationReason }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(output.findings[0].text);
    expect(await response.text()).not.toContain(validationReason);
  });

  it.each(["retrieval", "persistence", "reload"])("identifies the %s failure stage without logging exception text", async (failureStage) => {
    const error = new Error("private-provider-or-project-content");
    if (failureStage === "retrieval") mocks.search.mockRejectedValue(error);
    if (failureStage === "persistence") mocks.complete.mockRejectedValue(error);
    if (failureStage === "reload") mocks.load.mockRejectedValue(error);
    const response = await post();
    expect(response.status).toBe(503);
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[project-brief] generation failed", expect.objectContaining({ stage: failureStage }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(error.message);
    expect(await response.text()).not.toContain(error.message);
  });

  it.each([true, false])("logs safe generation diagnostics for HTTP failure=%s", async (httpFailure) => {
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta", text: "private-generated-content" };
      throw httpFailure ? new ChatGatewayError("provider_http_error", 502) : new Error("private-upstream-response");
    });
    const response = await post();
    expect(response.status).toBe(503);
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[project-brief] generation failed", expect.objectContaining({
      stage: "generation",
      ...(httpFailure ? { errorCode: "provider_http_error", status: 502 } : {}),
    }));
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("private-generated-content");
    expect(logged).not.toContain("private-upstream-response");
    const body = await response.text();
    expect(body).not.toContain("private-");
    expect(body).not.toContain("provider_http_error");
  });

  it("redacts arbitrary validation reasons before logging", async () => {
    const { POST: validatePost } = createProjectArtifactRoute({
      kind: "project_brief", title: "Project Brief", responseKey: "projectBrief",
      promptVersion: "test", errorPrefix: "PROJECT_BRIEF", logScope: "project-brief",
      evidenceNotReadyMessage: "Evidence not ready.", evidenceInsufficientMessage: "Evidence insufficient.",
      buildMessages: () => [{ role: "user", content: "fixture" }],
      validate: () => ({ status: "invalid", reason: "private-generated-validation-reason" }),
    });
    const response = await validatePost(request("POST", { attemptToken: ATTEMPT_TOKEN }), CONTEXT);
    expect(response.status).toBe(503);
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith("[project-brief] generation failed", expect.objectContaining({ stage: "validation", reason: "unrecognized_validation_reason" }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-generated-validation-reason");
    expect(await response.text()).not.toContain("private-generated-validation-reason");
  });

  it("identifies an oversized generated artifact without logging its content", async () => {
    model("private-generated-content".repeat(5_000));
    expect((await post()).status).toBe(503);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("[project-brief] generation failed", expect.objectContaining({ stage: "generation", errorCode: "artifact_too_long" }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-generated-content");
  });

  it("accepts formatted JSON and never stores provider evidence IDs as user prose", async () => {
    model(JSON.stringify(plan(), null, 2));
    expect((await post()).status).toBe(201);
    expect(mocks.complete.mock.calls[0][0].content).not.toContain("evidenceId");
  });

  it("repairs one invalid brief with unchanged evidence, persists once, and accounts for both calls", async () => {
    const invalid = plan();
    invalid.findings[0].text = "private-invalid-response";
    invalid.findings[0].evidence[0].evidenceId = "E99";
    mocks.researchUsage.mockReturnValue({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 });
    let calls = 0;
    mocks.streamChatCompletion.mockImplementation(async function* () {
      const call = calls++;
      yield { type: "delta", text: JSON.stringify(call === 0 ? invalid : plan()) };
      yield { type: "usage", usage: { inputTokens: 30, cachedInputTokens: 2, outputTokens: 7 } };
      yield { type: "usage", usage: call === 0
        ? { inputTokens: 60, cachedInputTokens: 5, outputTokens: 15 }
        : { inputTokens: 70, cachedInputTokens: 10, outputTokens: 20 } };
    });
    expect((await post()).status).toBe(201);
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    const [first, second] = mocks.streamChatCompletion.mock.calls.map(([input]) => input.messages);
    expect(second.slice(0, -1)).toEqual(first);
    expect(second.at(-1).content).toContain("unknown_evidence");
    expect(JSON.stringify(second)).not.toContain("private-invalid-response");
    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.search).toHaveBeenCalledOnce();
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.complete.mock.calls[0][0].artifacts.evidenceSnapshot.passages).toEqual([PASSAGES[0], PASSAGES[2], PASSAGES[1], PASSAGES[3]]);
    for (const callback of afterCallbacks) await callback();
    expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledOnce();
    expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledWith(expect.objectContaining({
      usage: { inputTokens: 230, cachedInputTokens: 35, outputTokens: 45 },
    }));
  });

  it.each([["planner", -1], ["first synthesis", 0], ["repair", 1]] as const)("keeps the whole operation unmeasured when %s omits usage", async (_missing, missingCall) => {
    if (missingCall !== -1) mocks.researchUsage.mockReturnValue({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 });
    let calls = 0;
    mocks.streamChatCompletion.mockImplementation(async function* () {
      const call = calls++;
      yield { type: "delta", text: call === 0 ? "invalid-json" : JSON.stringify(plan()) };
      if (call !== missingCall) yield { type: "usage", usage: { inputTokens: 60, cachedInputTokens: 5, outputTokens: 15 } };
    });
    expect((await post()).status).toBe(201);
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    for (const callback of afterCallbacks) await callback();
    expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: undefined }));
  });

  it("stops after a failed repair and leaves the existing artifact untouched", async () => {
    model("invalid-json");
    const response = await post();
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Error-ID")).toBe("PROJECT_BRIEF_GENERATION_FAILED");
    expect(await response.json()).toEqual({ message: "Project Brief could not be generated. Please try again." });
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("stops on a failed repair provider call and does not count its missing usage as measured", async () => {
    mocks.researchUsage.mockReturnValue({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 });
    let calls = 0;
    mocks.streamChatCompletion.mockImplementation(async function* () {
      if (calls++ === 1) throw new ChatGatewayError("provider_http_error", 502);
      yield { type: "delta", text: "invalid-json" };
      yield { type: "usage", usage: { inputTokens: 60, cachedInputTokens: 5, outputTokens: 15 } };
    });
    expect((await post()).status).toBe(503);
    expect(mocks.streamChatCompletion).toHaveBeenCalledTimes(2);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
    for (const callback of afterCallbacks) await callback();
    expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: undefined }));
    expect(console.error).toHaveBeenCalledWith("[project-brief] generation failed", expect.objectContaining({ stage: "generation", errorCode: "provider_http_error", status: 502 }));
  });

  it("does not start repair after cancellation", async () => {
    const controller = new AbortController();
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta", text: "invalid-json" };
      controller.abort();
    });
    await POST(new Request(request("POST", { attemptToken: ATTEMPT_TOKEN }), { signal: controller.signal }), CONTEXT);
    expect(mocks.streamChatCompletion).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("preserves source-set conflict protection during completion", async () => {
    mocks.complete.mockResolvedValue({ status: "conflict" });
    const response = await post();
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Error-ID")).toBe("PROJECT_BRIEF_SOURCE_SET_CHANGED");
    expect(mocks.fail).toHaveBeenCalledOnce();
  });

  it("retains multilingual interpretation and original-language quotations separately", async () => {
    const output = plan();
    output.findings[0].text = "第一位讲者支持四月发布，因为团队已经准备好。";
    output.findings[1].text = "第二位讲者反对四月发布，因为测试尚未完成。";
    model(JSON.stringify(output));
    expect((await post()).status).toBe(201);
    const content = mocks.complete.mock.calls[0][0].content;
    expect(content).toContain("第一位讲者支持四月发布，因为团队已经准备好。 [S1 @ 00:12]");
    expect(content).toContain(PASSAGES[0].text);
    expect(content).toContain(PASSAGES[2].text);
  });

  it("aggregates query-planning and synthesis usage once, including failure consumption", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
      mocks.requireRegisteredResearcher.mockResolvedValue({ kind: "resolved", principal: { userId: USER_ID, isAnonymous: false, businessAnalyticsSuppressed: false } });
      mocks.researchUsage.mockImplementation(() => {
        vi.advanceTimersByTime(40);
        return { inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 };
      });
      mocks.streamChatCompletion.mockImplementation(async function* () {
        vi.advanceTimersByTime(30);
        yield { type: "delta", text: JSON.stringify(plan()) };
        yield { type: "usage", usage: { inputTokens: 60, cachedInputTokens: 5, outputTokens: 15 } };
      });
      expect((await post()).status).toBe(201);
      for (const callback of afterCallbacks) await callback();
      expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledOnce();
      expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: { inputTokens: 160, cachedInputTokens: 25, outputTokens: 25 }, durationMs: 70 }));
      afterCallbacks.length = 0;
      mocks.recordProjectGenerationUsage.mockClear();
      model("not-json");
      expect((await post()).status).toBe(503);
      for (const callback of afterCallbacks) await callback();
      expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: undefined, durationMs: 40 }));
      expect(mocks.fail).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each(["planner", "synthesis"])("does not report a partial total when %s usage is missing", async (missing) => {
    if (missing !== "planner") mocks.researchUsage.mockReturnValue({ inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 });
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta", text: JSON.stringify(plan()) };
      if (missing !== "synthesis") yield { type: "usage", usage: { inputTokens: 60, cachedInputTokens: 5, outputTokens: 15 } };
    });
    expect((await post()).status).toBe(201);
    for (const callback of afterCallbacks) await callback();
    expect(mocks.recordProjectGenerationUsage).toHaveBeenCalledWith(expect.objectContaining({ usage: undefined }));
  });
});
