// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectGroundedConversation } from "../useProjectGroundedConversation";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: mocks.capture,
}));
vi.mock("@/lib/observability", () => ({ logAppEvent: mocks.log }));

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const ASSISTANT_ID = "30000000-0000-4000-8000-000000000001";
const RESERVED_USER_MESSAGE_ID = "60000000-0000-4000-8000-000000000001";
const INITIAL = {
  conversationId: null,
  messages: [],
  messagesUsed: 0,
  messagesLimit: 5 as const,
  tier: "free" as const,
};
const USER_ONLY = {
  conversationId: "40000000-0000-4000-8000-000000000001",
  messagesUsed: 1,
  messagesLimit: 5 as const,
  tier: "free" as const,
  messages: [
    {
      id: USER_ID,
      inReplyToMessageId: null,
      role: "user" as const,
      content: "When was the launch?",
      createdAt: "2026-08-09T12:00:00.000Z",
      answerClassification: null,
      sourceSetRevision: null,
      sourceManifest: null,
      sourceCoverage: null,
      citationDiagnostics: null,
    },
  ],
};
const MANIFEST = {
  projectId: PROJECT_ID,
  sourceSetRevision: 3,
  sources: [
    {
      sourceId: "S1",
      videoId: "50000000-0000-4000-8000-000000000001",
      youtubeVideoId: "aaaaaaa0001",
      title: "Launch notes",
      channelName: null,
      passages: [
        {
          passageId: "50000000-0000-4000-8000-000000000001:1:0:45",
          startSeconds: 42,
          endSeconds: 58,
        },
      ],
    },
  ],
};
const COVERAGE = {
  totalVideos: 1,
  readyVideos: 1,
  evidenceVideos: 1,
  unavailableVideos: [],
  passagesExamined: 9,
  evidencePassages: 1,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sse(...items: readonly Record<string, unknown>[]) {
  return new Response(
    items.map((item) => `data: ${JSON.stringify(item)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.capture.mockReset();
  mocks.log.mockReset();
});
afterEach(cleanup);

describe("useProjectGroundedConversation canonical persistence", () => {
  it("replaces a completed draft with the durable answer and captures content-free analytics", async () => {
    const durable = {
      ...USER_ONLY,
      messages: [
        ...USER_ONLY.messages,
        {
          id: ASSISTANT_ID,
          inReplyToMessageId: USER_ID,
          role: "assistant",
          content: "April [S1 @ 00:42].",
          createdAt: "2026-08-09T12:00:01.000Z",
          answerClassification: "supported",
          sourceSetRevision: 3,
          sourceManifest: MANIFEST,
          sourceCoverage: COVERAGE,
          citationDiagnostics: [],
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "April [S1 @ 00:42]." },
          { type: "citation_diagnostics", diagnostics: [] },
          { type: "done", assistantMessageId: ASSISTANT_ID },
        ),
      )
      .mockResolvedValueOnce(json({ conversation: durable }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() => result.current.send("When was the launch?"));
    expect(result.current.draft).toBeNull();
    expect(result.current.conversation.messages).toHaveLength(2);
    expect(mocks.capture).toHaveBeenCalledWith(
      "project_grounded_answer_completed",
      {
        classification: "supported",
        source_set_revision: 3,
        total_videos: 1,
        ready_videos: 1,
        evidence_videos: 1,
        unavailable_videos: 0,
        passages_examined: 9,
        evidence_passages: 1,
        citation_diagnostics: 0,
      },
    );
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toContain("launch");
  });

  it("carries guided mode through the stream, durable reload, and content-free analytics", async () => {
    const durable = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], mode: "compare_viewpoints" as const },
        {
          id: ASSISTANT_ID,
          inReplyToMessageId: USER_ID,
          role: "assistant" as const,
          content: "The sources disagree [S1 @ 00:42].",
          createdAt: "2026-08-09T12:00:01.000Z",
          answerClassification: "supported" as const,
          sourceSetRevision: 3,
          sourceManifest: MANIFEST,
          sourceCoverage: COVERAGE,
          citationDiagnostics: [],
          mode: "compare_viewpoints" as const,
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported", mode: "compare_viewpoints" },
          { type: "delta", text: "The sources disagree [S1 @ 00:42]." },
          { type: "citation_diagnostics", diagnostics: [] },
          { type: "done", assistantMessageId: ASSISTANT_ID },
        ),
      )
      .mockResolvedValueOnce(json({ conversation: durable }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() =>
      result.current.send(
        "Compare the viewpoints without averaging them.",
        "compare_viewpoints",
      ),
    );

    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          question: "Compare the viewpoints without averaging them.",
          mode: "compare_viewpoints",
        }),
      }),
    );
    expect(result.current.conversation.messages).toMatchObject([
      { role: "user", mode: "compare_viewpoints" },
      { role: "assistant", mode: "compare_viewpoints" },
    ]);
    expect(mocks.capture).toHaveBeenCalledWith(
      "project_grounded_answer_completed",
      expect.objectContaining({ mode: "compare_viewpoints" }),
    );
  });

  it("carries Project Assessment mode through reservation, stream, and durable reload", async () => {
    const durable = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], mode: "project_assessment" as const },
        {
          id: ASSISTANT_ID,
          inReplyToMessageId: USER_ID,
          role: "assistant" as const,
          content: "Project Assessment\nApril is better supported [S1 @ 00:42].",
          createdAt: "2026-08-09T12:00:01.000Z",
          answerClassification: "supported" as const,
          sourceSetRevision: 3,
          sourceManifest: MANIFEST,
          sourceCoverage: COVERAGE,
          citationDiagnostics: [],
          mode: "project_assessment" as const,
        },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          {
            type: "answer_start",
            classification: "supported",
            mode: "project_assessment",
          },
          { type: "delta", text: "Project Assessment\nApril is better supported [S1 @ 00:42]." },
          { type: "citation_diagnostics", diagnostics: [] },
          { type: "done", assistantMessageId: ASSISTANT_ID },
        ),
      )
      .mockResolvedValueOnce(json({ conversation: durable }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() =>
      result.current.send(
        "Which timing is better supported?",
        "project_assessment",
      ),
    );

    expect(fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          question: "Which timing is better supported?",
          mode: "project_assessment",
        }),
      }),
    );
    expect(result.current.conversation.messages).toMatchObject([
      { role: "user", mode: "project_assessment" },
      { role: "assistant", mode: "project_assessment" },
    ]);
    expect(mocks.capture).toHaveBeenCalledWith(
      "project_grounded_answer_completed",
      expect.objectContaining({ mode: "project_assessment" }),
    );
  });

  it("keeps the next send fenced until canonical reload finishes", async () => {
    let releaseReload!: () => void;
    const reloadGate = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "April [S1 @ 00:42]." },
          { type: "citation_diagnostics", diagnostics: [] },
          { type: "done", assistantMessageId: ASSISTANT_ID },
        ),
      )
      .mockImplementationOnce(async () => {
        await reloadGate;
        return json({ conversation: USER_ONLY });
      });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("When was the launch?");
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(result.current.streaming).toBe(true);
    act(() => {
      result.current.send("A second question must wait");
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    releaseReload();
    await act(() => sending);
    expect(result.current.streaming).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it("discards partial assistant output and reloads exactly the reserved user after stream failure", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "Partial private answer" },
          { type: "error", message: "Generation failed" },
        ),
      )
      .mockResolvedValueOnce(json({ conversation: USER_ONLY }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() => result.current.send("When was the launch?"));
    expect(result.current.draft).toBeNull();
    expect(result.current.error).toBe("Generation failed");
    expect(result.current.conversation.messages).toEqual(USER_ONLY.messages);
    expect(JSON.stringify(result.current)).not.toContain("Partial private answer");
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("aborts the in-flight request, clears the draft, and reloads the saved user only", async () => {
    const fetch = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const stream = new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError")),
            );
          },
        });
        return Promise.resolve(
          new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "X-Project-Question-Message-ID": RESERVED_USER_MESSAGE_ID,
            },
          }),
        );
      })
      .mockResolvedValueOnce(json({ outcome: "cancelled" }))
      .mockResolvedValueOnce(json({ conversation: USER_ONLY }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    let sending!: Promise<void>;
    act(() => { sending = result.current.send("When was the launch?"); });
    await waitFor(() => expect(result.current.streaming).toBe(true));
    act(() => result.current.abort());
    await act(() => sending);
    expect(result.current.error).toBeNull();
    expect(result.current.draft).toBeNull();
    expect(result.current.conversation.messages).toEqual(USER_ONLY.messages);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/projects/${PROJECT_ID}/conversation/cancel`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ userMessageId: RESERVED_USER_MESSAGE_ID }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `/api/projects/${PROJECT_ID}/conversation`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("keeps the stable UpgradeRequiredError while reloading canonical 5/5 usage", async () => {
    const capped = { ...USER_ONLY, messagesUsed: 5 };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            message: "Five used",
            errorCode: "free_chat_exceeded",
            tier: "free",
            upgradeUrl: "/pricing",
          },
          402,
        ),
      )
      .mockResolvedValueOnce(json({ conversation: capped }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() => result.current.send("One more question"));
    expect(result.current.upgradeError).toMatchObject({
      errorCode: "free_chat_exceeded",
      tier: "free",
      upgradeUrl: "/pricing",
    });
    expect(result.current.error).toBeNull();
    expect(result.current.conversation.messagesUsed).toBe(5);
  });

  it("switches, creates, renames, and clears through the management boundaries", async () => {
    const firstId = "40000000-0000-4000-8000-000000000001";
    const secondId = "40000000-0000-4000-8000-000000000002";
    const createdId = "40000000-0000-4000-8000-000000000003";
    const sourceSetEvents = [
      {
        eventId: "70000000-0000-4000-8000-000000000001",
        projectId: PROJECT_ID,
        revision: 2,
        kind: "added" as const,
        videoId: "50000000-0000-4000-8000-000000000001",
        videoTitle: "Launch notes",
        fromPosition: null,
        toPosition: 1,
        fromStatus: null,
        toStatus: "ready" as const,
        createdAt: "2026-08-09T11:59:00.000Z",
      },
    ];
    const summary = (conversationId: string, name: string, messageCount = 0) => ({
      conversationId,
      name,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      messageCount,
    });
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes(`conversation?conversationId=${secondId}`)) {
        return Promise.resolve(
          json({
            conversation: {
              ...INITIAL,
              conversationId: secondId,
              sourceSetEvents,
            },
          }),
        );
      }
      if (url === `/api/projects/${PROJECT_ID}/conversations` && init?.method === "POST") {
        return Promise.resolve(json({ conversation: summary(createdId, "New conversation") }, 201));
      }
      if (url.endsWith(`/conversations/${createdId}`) && init?.method === "PATCH") {
        return Promise.resolve(json({ outcome: "renamed" }));
      }
      if (url.endsWith(`/conversations/${createdId}`) && init?.method === "DELETE") {
        return Promise.resolve(json({ outcome: "cleared" }));
      }
      if (url.includes(`conversation?conversationId=${createdId}`)) {
        return Promise.resolve(
          json({ conversation: { ...INITIAL, conversationId: createdId } }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: {
          ...INITIAL,
          conversationId: firstId,
          sourceSetEvents,
        },
        initialConversations: [summary(firstId, "Launch questions", 1), summary(secondId, "Comparison")],
      }),
    );

    await act(() => result.current.selectConversation(secondId));
    expect(result.current.activeConversationId).toBe(secondId);
    await act(() => result.current.createConversation());
    expect(result.current.activeConversationId).toBe(createdId);
    expect(result.current.conversation.sourceSetEvents).toEqual(sourceSetEvents);
    await act(() => result.current.renameConversation(createdId, "Launch questions"));
    expect(result.current.conversations[0]?.name).toBe("Launch questions");
    await act(() => result.current.clearConversation(createdId));
    expect(result.current.conversation.messages).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/conversation?conversationId=${secondId}`,
      { cache: "no-store" },
    );
  });

  it("retries a failed question as a fresh durable attempt", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse({ type: "error", message: "Generation failed" }),
      )
      .mockResolvedValueOnce(json({ conversation: USER_ONLY }))
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "April [S1 @ 00:42]." },
          { type: "citation_diagnostics", diagnostics: [] },
          { type: "done", assistantMessageId: ASSISTANT_ID },
        ),
      )
      .mockResolvedValueOnce(json({ conversation: USER_ONLY }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() => result.current.send("When was the launch?"));
    expect(result.current.error).toBe("Generation failed");
    await act(() => result.current.retry());
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `/api/projects/${PROJECT_ID}/conversation/stream`,
      expect.objectContaining({
        body: JSON.stringify({
          question: "When was the launch?",
          conversationId: USER_ONLY.conversationId,
        }),
      }),
    );
  });

  it("retries a failed guided question with the same mode contract", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse({ type: "error", message: "Generation failed" }),
      )
      .mockResolvedValueOnce(json({ conversation: USER_ONLY }))
      .mockResolvedValueOnce(
        sse(
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "abstained", mode: "find_gaps" },
          { type: "delta", text: "No supported gap." },
          { type: "citation_diagnostics", diagnostics: [] },
          { type: "done", assistantMessageId: ASSISTANT_ID },
        ),
      )
      .mockResolvedValueOnce(json({ conversation: USER_ONLY }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: INITIAL,
      }),
    );

    await act(() => result.current.send("Find supported gaps.", "find_gaps"));
    expect(result.current.error).toBe("Generation failed");
    await act(() => result.current.retry());
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      `/api/projects/${PROJECT_ID}/conversation/stream`,
      expect.objectContaining({
        body: JSON.stringify({
          question: "Find supported gaps.",
          conversationId: USER_ONLY.conversationId,
          mode: "find_gaps",
        }),
      }),
    );
  });
});
