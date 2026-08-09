import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireRegisteredResearcher: vi.fn(),
  createClient: vi.fn(),
  resolveProjectSubject: vi.fn(),
  checkRateLimit: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  complete: vi.fn(),
  search: vi.fn(),
  streamChatCompletion: vi.fn(),
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

import { POST } from "../route";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const ATTEMPT_TOKEN = "50000000-0000-4000-8000-000000000001";
const ASSISTANT_ID = "60000000-0000-4000-8000-000000000001";
const VIDEO_ID = "70000000-0000-4000-8000-000000000001";
const REQUEST_ID = "issue-318-route-test";
const CONTEXT = { params: Promise.resolve({ projectId: PROJECT_ID }) };

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

const READY_SEARCH = {
  status: "ready" as const,
  sourceSetRevision: 3,
  coverage: {
    totalVideos: 1,
    readyVideos: 1,
    unavailableVideos: [],
    passagesExamined: 9,
  },
  passages: [PASSAGE],
};

const PASSAGE_TWO = {
  passageId: `${"70000000-0000-4000-8000-000000000002"}:1:0:14`,
  videoId: "70000000-0000-4000-8000-000000000002",
  youtubeVideoId: "bbbbbbb0002",
  title: "五月观点",
  channelName: "研究频道",
  text: "五月方案应等待本地测试完成。",
  segmentOrdinal: 1,
  excerptStartCharacter: 0,
  excerptEndCharacter: 14,
  startSeconds: 44,
  endSeconds: 59,
  language: "zh",
  truncatedStart: false,
  truncatedEnd: false,
} as const;

const BALANCED_SEARCH = {
  status: "ready" as const,
  sourceSetRevision: 3,
  coverage: {
    totalVideos: 2,
    readyVideos: 2,
    unavailableVideos: [],
    passagesExamined: 10,
  },
  passages: [PASSAGE, PASSAGE_TWO],
};

const STARTED = {
  status: "started" as const,
  conversationId: CONVERSATION_ID,
  userMessageId: USER_MESSAGE_ID,
  attemptToken: ATTEMPT_TOKEN,
  messagesUsed: 1,
  messagesLimit: 5 as const,
  tier: "free" as const,
  history: [],
};

const SUBJECT = {
  kind: "project" as const,
  projectId: PROJECT_ID,
  workspaceId: "80000000-0000-4000-8000-000000000001",
  ownerId: USER_ID,
  name: "Private Project",
  guidance: { goal: "Focus on launches, but this is not evidence." },
  lastActiveAt: "2026-08-09T00:00:00.000Z",
  groundedAnswers: {
    load: vi.fn(),
    start: mocks.start,
    cancel: mocks.cancel,
    complete: mocks.complete,
  },
  passageSearch: { search: mocks.search },
};

function request(
  question = "When did the launch happen?",
  signal?: AbortSignal,
  conversationId?: string,
  mode?:
    | "question"
    | "compare_viewpoints"
    | "common_themes"
    | "find_gaps"
    | "project_assessment",
) {
  return new Request(`http://test/api/projects/${PROJECT_ID}/conversation/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": REQUEST_ID,
    },
    body: JSON.stringify({
      question,
      ...(conversationId ? { conversationId } : {}),
      ...(mode ? { mode } : {}),
    }),
    signal,
  });
}

async function events(response: Response) {
  const body = await response.text();
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

function model(...chunks: string[]) {
  mocks.streamChatCompletion.mockImplementation(async function* () {
    for (const text of chunks) yield { type: "delta", text };
    yield { type: "done" };
  });
}

describe("POST /api/projects/[projectId]/conversation/stream", () => {
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
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.start.mockResolvedValue(STARTED);
    mocks.cancel.mockResolvedValue({ status: "cancelled" });
    mocks.search.mockResolvedValue(READY_SEARCH);
    mocks.complete.mockResolvedValue({
      outcome: "completed",
      assistantMessageId: ASSISTANT_ID,
    });
    model("SUPPORTED\nThe launch", " happened in April [S1 @ 00:42].");
  });

  it("validates strict code-point-bounded input before any auth or database work", async () => {
    for (const body of [
      { question: "x" },
      { question: "x".repeat(201) },
      { question: "valid", ownerId: USER_ID },
    ]) {
      const response = await POST(
        new Request("http://test", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        CONTEXT,
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("X-Request-ID")).toBeTruthy();
      expect(response.headers.get("X-Error-ID")).toBe(
        "PROJECT_QUESTION_INVALID",
      );
    }
    expect(mocks.requireRegisteredResearcher).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    ["unauthenticated", 401],
    ["anonymous", 403],
  ])("rejects %s before Project resolution", async (_name, status) => {
    mocks.requireRegisteredResearcher.mockResolvedValue({
      kind: "error",
      response: Response.json({ outcome: "blocked" }, { status }),
    });
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(status);
    expect(mocks.resolveProjectSubject).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("keeps foreign and nonexistent Projects indistinguishable", async () => {
    const bodies = [];
    for (const projectId of [PROJECT_ID, "10000000-0000-4000-8000-000000000009"]) {
      mocks.resolveProjectSubject.mockResolvedValueOnce({ kind: "missing" });
      const response = await POST(request(), {
        params: Promise.resolve({ projectId }),
      });
      expect(response.status).toBe(404);
      bodies.push(await response.json());
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("runs the existing rate gate before reserving a user turn", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0 });
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(429);
    expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
    expect(response.headers.get("X-Error-ID")).toBe("RATE_LIMITED");
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(USER_ID, false);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("passes a selected conversation identity to the durable reservation", async () => {
    const response = await POST(
      request("When did the launch happen?", undefined, CONVERSATION_ID),
      CONTEXT,
    );
    await response.text();
    expect(mocks.start).toHaveBeenCalledWith(
      "When did the launch happen?",
      CONVERSATION_ID,
    );
  });

  it("keeps guided synthesis on the grounded stream, persistence, and citation path", async () => {
    const response = await POST(
      request(
        "Compare the edited viewpoints without averaging them.",
        undefined,
        undefined,
        "compare_viewpoints",
      ),
      CONTEXT,
    );
    const streamed = await events(response);

    expect(mocks.start).toHaveBeenCalledWith(
      "Compare the edited viewpoints without averaging them.",
      undefined,
      "compare_viewpoints",
    );
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "supported",
      mode: "compare_viewpoints",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "supported",
        mode: "compare_viewpoints",
      }),
    );
    const prompt = mocks.streamChatCompletion.mock.calls[0]?.[0].messages[0]
      .content as string;
    expect(prompt).toContain("GUIDED_SYNTHESIS_MODE: COMPARE_VIEWPOINTS");
    expect(prompt).toContain("Do not average, merge, or manufacture consensus");
  });

  it("keeps Project Assessment source claims, criteria, and confidence on the grounded path", async () => {
    model(
      "SUPPORTED\nProject Assessment\n\nCompeting positions\nThe launch-in-April position is supported by the available passage [S1 @ 00:42].\n\nCriteria\nDirectness and relevance support this position [S1 @ 00:42].\n\nConfidence: medium",
    );
    const response = await POST(
      request(
        "Which launch timing is better supported?",
        undefined,
        undefined,
        "project_assessment",
      ),
      CONTEXT,
    );
    const streamed = await events(response);

    expect(mocks.start).toHaveBeenCalledWith(
      "Which launch timing is better supported?",
      undefined,
      "project_assessment",
    );
    expect(mocks.search).toHaveBeenCalledWith({
      query: "Which launch timing is better supported?",
      limit: 10,
      balanceSources: true,
    });
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "supported",
      mode: "project_assessment",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "project_assessment" }),
    );
    const prompt = mocks.streamChatCompletion.mock.calls[0]?.[0].messages[0]
      .content as string;
    expect(prompt).toContain("GUIDED_SYNTHESIS_MODE: PROJECT_ASSESSMENT");
    expect(prompt).toContain("directness and relevance");
    expect(prompt).toContain("not externally verified truth");
  });

  it("abstains deterministically instead of persisting malformed Project Assessment prose", async () => {
    model("SUPPORTED\nProject Assessment\nApril seems better supported [S1 @ 00:42].");
    const streamed = await events(
      await POST(
        request(
          "Which launch timing is better supported?",
          undefined,
          undefined,
          "project_assessment",
        ),
        CONTEXT,
      ),
    );

    expect(streamed).not.toContainEqual({
      type: "answer_start",
      classification: "supported",
      mode: "project_assessment",
    });
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "abstained",
      mode: "project_assessment",
    });
    expect(streamed).toContainEqual({
      type: "delta",
      text: "The Project evidence cannot resolve which position is better supported, so I can't provide a Project Assessment without guessing.",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "abstained",
        assistantContent:
          "The Project evidence cannot resolve which position is better supported, so I can't provide a Project Assessment without guessing.",
      }),
    );
  });

  it("buffers every structured model chunk until the response contract passes", async () => {
    model(
      "SUPPORTED\nProject Assessment\n\nCompeting positions\nLeaked before validation [S1 @ 00:42].",
      "\n\nThis unstructured continuation is also not safe [S1 @ 00:42].",
    );
    const streamed = await events(
      await POST(
        request(
          "Which launch timing is better supported?",
          undefined,
          undefined,
          "project_assessment",
        ),
        CONTEXT,
      ),
    );

    expect(JSON.stringify(streamed)).not.toContain("Leaked before validation");
    expect(JSON.stringify(streamed)).not.toContain("unstructured continuation");
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "abstained",
      mode: "project_assessment",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "abstained" }),
    );
  });

  it("requires every balanced Project Assessment position to have a valid citation", async () => {
    mocks.search.mockResolvedValue(BALANCED_SEARCH);
    model(
      "SUPPORTED\nProject Assessment\n\nCompeting positions\nApril is supported [S1 @ 00:42]. June is also represented.\n\nCriteria\nDirectness and corroboration support the comparison [S1 @ 00:42].\n\nConfidence: low",
    );
    const streamed = await events(
      await POST(
        request(
          "Which launch timing is better supported?",
          undefined,
          undefined,
          "project_assessment",
        ),
        CONTEXT,
      ),
    );

    expect(JSON.stringify(streamed)).not.toContain("April is supported");
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "abstained",
      mode: "project_assessment",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "abstained" }),
    );
  });

  it("emits a fragmented Project Assessment only after every position is cited", async () => {
    mocks.search.mockResolvedValue(BALANCED_SEARCH);
    model(
      "SUPPORTED\nProject Assessment\n\nCompeting positions\nApril is supported [S1 @ 00:42]. ",
      "五月方案应等待本地测试完成 [S2 @ 00:44].\n\nCriteria\nDirectness and corroboration support both positions [S1 @ 00:42].\n\nConfidence: low",
    );
    const streamed = await events(
      await POST(
        request(
          "Which launch timing is better supported?",
          undefined,
          undefined,
          "project_assessment",
        ),
        CONTEXT,
      ),
    );

    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "supported",
      mode: "project_assessment",
    });
    expect(streamed).toContainEqual({
      type: "delta",
      text: expect.stringContaining("April is supported"),
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "supported" }),
    );
    const completion = mocks.complete.mock.calls[0]?.[0] as {
      assistantContent: string;
      artifacts: {
        sourceManifest: { sources: Array<{ sourceId: string }> };
      };
    };
    expect(completion.assistantContent).toContain("[S1 @ 00:42]");
    expect(completion.assistantContent).toContain("[S2 @ 00:44]");
    expect(completion.artifacts.sourceManifest.sources.map((source) => source.sourceId)).toEqual([
      "S1",
      "S2",
    ]);
  });

  it("uses a deterministic Project Assessment abstention when evidence cannot resolve a position", async () => {
    model("ABSTAINED\nThe model must not expose this unsupported claim.");
    const streamed = await events(
      await POST(
        request(
          "Which launch timing is better supported?",
          undefined,
          undefined,
          "project_assessment",
        ),
        CONTEXT,
      ),
    );

    expect(JSON.stringify(streamed)).not.toContain("unsupported claim");
    expect(streamed).toContainEqual({
      type: "delta",
      text: "The Project evidence cannot resolve which position is better supported, so I can't provide a Project Assessment without guessing.",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "abstained",
        mode: "project_assessment",
      }),
    );
  });

  it("names the evidence gap for a guided unexplored-angle request with no passages", async () => {
    mocks.search.mockResolvedValue({
      status: "no_results",
      sourceSetRevision: 4,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 7,
      },
      passages: [],
    });

    const streamed = await events(
      await POST(
        request(
          "Find gaps and unexplored angles.",
          undefined,
          undefined,
          "find_gaps",
        ),
        CONTEXT,
      ),
    );

    expect(streamed[2]).toEqual({
      type: "answer_start",
      classification: "unsupported",
      mode: "find_gaps",
    });
    expect(streamed[3]).toEqual({
      type: "delta",
      text: "The retrieved Evidence Snapshot does not support a useful gap or unexplored angle, so I can't identify gaps without guessing.",
    });
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("abstains deterministically instead of persisting malformed gap sections", async () => {
    model(
      "SUPPORTED\nSource-supported observations\nThe source covers the launch timing [S1 @ 00:42].",
    );
    const streamed = await events(
      await POST(
        request(
          "Find gaps and unexplored angles.",
          undefined,
          undefined,
          "find_gaps",
        ),
        CONTEXT,
      ),
    );

    expect(streamed).not.toContainEqual({
      type: "answer_start",
      classification: "supported",
      mode: "find_gaps",
    });
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "abstained",
      mode: "find_gaps",
    });
    expect(streamed).toContainEqual({
      type: "delta",
      text: "The retrieved Evidence Snapshot does not support a useful gap or unexplored angle, so I can't identify gaps without guessing.",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "abstained",
        assistantContent:
          "The retrieved Evidence Snapshot does not support a useful gap or unexplored angle, so I can't identify gaps without guessing.",
      }),
    );
  });

  it("preserves the stable 402 chat envelope and consumes no retrieval/provider work", async () => {
    mocks.start.mockResolvedValue({
      status: "limit_reached",
      messagesUsed: 5,
      messagesLimit: 5,
      tier: "free",
    });
    const response = await POST(request(), CONTEXT);
    expect(response.status).toBe(402);
    expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
    expect(response.headers.get("X-Error-ID")).toBe(
      "PROJECT_CHAT_QUOTA_EXCEEDED",
    );
    await expect(response.json()).resolves.toMatchObject({
      errorCode: "free_chat_exceeded",
      tier: "free",
      upgradeUrl: "/pricing",
    });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
  });

  it("emits manifest and exact coverage before any assistant event, hides the control line, and persists before done", async () => {
    const response = await POST(request(), CONTEXT);
    expect(response.headers.get("X-Project-Question-Message-ID")).toBe(
      USER_MESSAGE_ID,
    );
    const streamed = await events(response);
    expect(streamed.map((event) => event.type)).toEqual([
      "source_manifest",
      "source_coverage",
      "answer_start",
      "delta",
      "delta",
      "citation_diagnostics",
      "done",
    ]);
    expect(streamed[0]).toMatchObject({
      manifest: { sourceSetRevision: 3, sources: [{ sourceId: "S1" }] },
    });
    expect(streamed[1]).toEqual({
      type: "source_coverage",
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        evidenceVideos: 1,
        unavailableVideos: [],
        passagesExamined: 9,
        evidencePassages: 1,
      },
    });
    expect(JSON.stringify(streamed)).not.toContain("SUPPORTED\\n");
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(streamed.at(-1)).toEqual({
      type: "done",
      assistantMessageId: ASSISTANT_ID,
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        reservation: expect.objectContaining({ attemptToken: ATTEMPT_TOKEN }),
        assistantContent:
          "The launch happened in April [S1 @ 00:42].",
        classification: "supported",
        citationDiagnostics: [],
      }),
    );
    const prompt = mocks.streamChatCompletion.mock.calls[0]?.[0].messages[0]
      .content as string;
    expect(prompt).toContain("PROJECT_GOAL_GUIDANCE_NOT_EVIDENCE");
    expect(prompt).toContain("EVIDENCE_SNAPSHOT");
    expect(prompt).not.toContain("Summary evidence");
  });

  it("waits for the atomic terminal write before emitting done", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    mocks.complete.mockImplementation(async () => {
      await waiting;
      return { outcome: "completed", assistantMessageId: ASSISTANT_ID };
    });
    const response = await POST(request(), CONTEXT);
    let streamSettled = false;
    const streamed = events(response).then((value) => {
      streamSettled = true;
      return value;
    });
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    expect(streamSettled).toBe(false);
    release();
    expect((await streamed).at(-1)).toEqual({
      type: "done",
      assistantMessageId: ASSISTANT_ID,
    });
  });

  it("persists malformed, unknown, and wrong-timestamp citations as plain-text diagnostics", async () => {
    const answer =
      "The launch is supported despite diagnostic examples [S9 @ 00:10], [S1 @ 00:43], and [S1 at 00:42] [S1 @ 00:42].";
    model(`SUPPORTED\n${answer}`);
    const streamed = await events(await POST(request(), CONTEXT));

    expect(streamed.map((event) => event.type)).toContain("done");
    expect(streamed.find((event) => event.type === "citation_diagnostics"))
      .toEqual({
        type: "citation_diagnostics",
        diagnostics: [
          { kind: "unknown_source", raw: "[S9 @ 00:10]", sourceId: "S9" },
          {
            kind: "timestamp_not_in_evidence",
            raw: "[S1 @ 00:43]",
            sourceId: "S1",
          },
          { kind: "malformed", raw: "[S1 at 00:42]" },
        ],
      });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantContent: answer,
        citationDiagnostics: expect.arrayContaining([
          expect.objectContaining({ kind: "unknown_source" }),
          expect.objectContaining({ kind: "timestamp_not_in_evidence" }),
          expect.objectContaining({ kind: "malformed" }),
        ]),
      }),
    );
  });

  it("discards a model-declared supported answer with no validated citation", async () => {
    model("SUPPORTED\nThe launch happened in April without a source.");

    const streamed = await events(await POST(request(), CONTEXT));

    expect(streamed.at(-1)).toMatchObject({ type: "error" });
    expect(streamed.some((event) => event.type === "done")).toBe(false);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("discards a supported answer when any additional factual sentence is uncited", async () => {
    model(
      "SUPPORTED\nThe launch happened in April [S1 @ 00:42]. It also happened in May.",
    );

    const streamed = await events(await POST(request(), CONTEXT));

    expect(streamed.at(-1)).toMatchObject({ type: "error" });
    expect(streamed.some((event) => event.type === "done")).toBe(false);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("replaces model prose after ABSTAINED with the deterministic safe abstention", async () => {
    model("ABSTAINED\nInvented claim that must never be shown or persisted.");

    const streamed = await events(await POST(request(), CONTEXT));

    expect(JSON.stringify(streamed)).not.toContain("Invented claim");
    expect(streamed).toContainEqual({
      type: "answer_start",
      classification: "abstained",
    });
    expect(streamed).toContainEqual({
      type: "delta",
      text: "The Evidence Snapshot does not support a confident answer to this question.",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "abstained",
        assistantContent:
          "The Evidence Snapshot does not support a confident answer to this question.",
      }),
    );
  });

  it("completes a deterministic unsupported answer without calling the provider when evidence is not ready", async () => {
    mocks.search.mockResolvedValue({
      status: "not_ready",
      sourceSetRevision: 4,
      coverage: {
        totalVideos: 1,
        readyVideos: 0,
        unavailableVideos: [
          {
            videoId: VIDEO_ID,
            youtubeVideoId: "aaaaaaa0001",
            title: "Launch notes",
            channelName: null,
            status: "processing",
            failureCode: null,
          },
        ],
        passagesExamined: 0,
      },
      passages: [],
    });

    const streamed = await events(await POST(request(), CONTEXT));
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
    expect(streamed.map((event) => event.type)).toEqual([
      "source_manifest",
      "source_coverage",
      "answer_start",
      "delta",
      "citation_diagnostics",
      "done",
    ]);
    expect(streamed[2]).toEqual({
      type: "answer_start",
      classification: "unsupported",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "unsupported" }),
    );
  });

  it("completes a deterministic unsupported answer for no_results without calling the provider", async () => {
    mocks.search.mockResolvedValue({
      status: "no_results",
      sourceSetRevision: 4,
      coverage: {
        totalVideos: 1,
        readyVideos: 1,
        unavailableVideos: [],
        passagesExamined: 7,
      },
      passages: [],
    });

    const streamed = await events(await POST(request(), CONTEXT));
    expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
    expect(streamed.map((event) => event.type)).toEqual([
      "source_manifest",
      "source_coverage",
      "answer_start",
      "delta",
      "citation_diagnostics",
      "done",
    ]);
    expect(streamed[2]).toEqual({
      type: "answer_start",
      classification: "unsupported",
    });
    expect(streamed[3]).toEqual({
      type: "delta",
      text: "The available Project passages do not support an answer to this question.",
    });
    expect(mocks.complete).toHaveBeenCalledWith(
      expect.objectContaining({ classification: "unsupported" }),
    );
  });

  it.each([
    ["invalid control line", async function* () { yield { type: "delta", text: "MAYBE\nanswer" }; }],
    ["control line with extra text", async function* () { yield { type: "delta", text: "SUPPORTED extra\nanswer [S1 @ 00:42]." }; }],
    ["contradictory control line", async function* () { yield { type: "delta", text: "SUPPORTED\nABSTAINED\nanswer [S1 @ 00:42]." }; }],
    ["empty answer", async function* () { yield { type: "delta", text: "SUPPORTED\n" }; }],
    ["provider failure", async function* () { yield { type: "delta", text: "SUPPORTED\npartial" }; throw new Error("gateway failed"); }],
  ])("keeps the reserved user only after %s", async (_name, generator) => {
    mocks.streamChatCompletion.mockImplementation(generator);
    const streamed = await events(await POST(request(), CONTEXT));
    expect(streamed.at(-1)).toMatchObject({ type: "error" });
    expect(streamed.some((event) => event.type === "done")).toBe(false);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("does not persist a partial assistant when the consumer cancels", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    mocks.streamChatCompletion.mockImplementation(async function* () {
      yield { type: "delta", text: "SUPPORTED\npartial" };
      await wait;
      yield { type: "delta", text: " answer [S1 @ 00:42]" };
    });
    const response = await POST(request(), CONTEXT);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.read();
    await reader.read();
    await reader.read();
    const cancelled = reader.cancel();
    release();
    await cancelled;
    await Promise.resolve();
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledWith(USER_MESSAGE_ID);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("fences a cancellation while terminal completion is blocked", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.complete.mockImplementation(async () => {
      await waiting;
      return { outcome: "completed", assistantMessageId: ASSISTANT_ID };
    });

    const response = await POST(request(), CONTEXT);
    const reader = response.body!.getReader();
    await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    await reader.cancel();
    expect(mocks.cancel).toHaveBeenCalledWith(USER_MESSAGE_ID);
    release();
    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledOnce());
  });

  it("emits an error without done when terminal persistence fails", async () => {
    mocks.complete.mockResolvedValue({ outcome: "stale" });
    const streamed = await events(await POST(request(), CONTEXT));
    expect(streamed.at(-1)).toMatchObject({ type: "error" });
    expect(streamed.some((event) => event.type === "done")).toBe(false);
  });

  it.each([
    ["missing", 404, null],
    ["invalid", 400, "PROJECT_QUESTION_INVALID"],
    ["unavailable", 503, "PROJECTS_UNAVAILABLE"],
  ])(
    "handles a %s start outcome without retrieval",
    async (status, expectedStatus, errorId) => {
      mocks.start.mockResolvedValue({ status });
      const response = await POST(request(), CONTEXT);
      expect(response.status).toBe(expectedStatus);
      expect(mocks.search).not.toHaveBeenCalled();
      if (errorId) {
        expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
        expect(response.headers.get("X-Error-ID")).toBe(errorId);
      }
    },
  );

  it.each([
    ["missing", 404, null],
    ["invalid", 503, "PROJECTS_UNAVAILABLE"],
    ["unavailable", 503, "PROJECTS_UNAVAILABLE"],
  ])(
    "handles a %s passage-search outcome without provider work",
    async (status, expectedStatus, errorId) => {
      mocks.search.mockResolvedValue({ status });
      const response = await POST(request(), CONTEXT);
      expect(response.status).toBe(expectedStatus);
      expect(mocks.streamChatCompletion).not.toHaveBeenCalled();
      if (errorId) {
        expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
        expect(response.headers.get("X-Error-ID")).toBe(errorId);
      }
    },
  );

  it.each(["client", "capabilities"])(
    "returns a traceable 503 when %s setup is unavailable",
    async (failure) => {
      if (failure === "client") {
        mocks.createClient.mockRejectedValueOnce(new Error("offline"));
      } else {
        mocks.resolveProjectSubject.mockResolvedValueOnce({
          kind: "resolved",
          value: { ...SUBJECT, groundedAnswers: undefined },
        });
      }
      const response = await POST(request(), CONTEXT);
      expect(response.status).toBe(503);
      expect(response.headers.get("X-Request-ID")).toBe(REQUEST_ID);
      expect(response.headers.get("X-Error-ID")).toBe("PROJECTS_UNAVAILABLE");
      expect(mocks.start).not.toHaveBeenCalled();
    },
  );
});
