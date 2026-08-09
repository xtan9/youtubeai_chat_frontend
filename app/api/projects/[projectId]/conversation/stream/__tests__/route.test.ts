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

function request(question = "When did the launch happen?", signal?: AbortSignal) {
  return new Request(`http://test/api/projects/${PROJECT_ID}/conversation/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": REQUEST_ID,
    },
    body: JSON.stringify({ question }),
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
