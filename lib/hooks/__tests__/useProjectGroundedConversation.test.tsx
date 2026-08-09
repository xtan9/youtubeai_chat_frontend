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
const ASSISTANT_ID = "30000000-0000-4000-8000-000000000001";
const RESERVED_USER_MESSAGE_ID = "60000000-0000-4000-8000-000000000001";
const INITIAL = {
  conversationId: null,
  messages: [],
  messagesUsed: 0,
  messagesLimit: 5 as const,
  tier: "free" as const,
  nextCursor: null,
};
const USER_ONLY = {
  conversationId: "40000000-0000-4000-8000-000000000001",
  messagesUsed: 1,
  messagesLimit: 5 as const,
  tier: "free" as const,
  nextCursor: null,
  messages: [
    {
      id: RESERVED_USER_MESSAGE_ID,
      inReplyToMessageId: null,
      role: "user" as const,
      content: "When was the launch?",
      createdAt: "2026-08-09T12:00:00.000Z",
      answerClassification: null,
      completionState: "reserved" as const,
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
  usedVideos: 1,
  unavailableVideos: [],
  passagesExamined: 9,
  passagesUsed: 1,
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
  vi.spyOn(crypto, "randomUUID").mockReturnValue(RESERVED_USER_MESSAGE_ID);
  mocks.capture.mockReset();
  mocks.log.mockReset();
});
afterEach(cleanup);

describe("useProjectGroundedConversation canonical persistence", () => {
  it("replaces a completed draft with the durable answer and captures content-free analytics", async () => {
    const durable = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "completed" as const },
        {
          id: ASSISTANT_ID,
          inReplyToMessageId: RESERVED_USER_MESSAGE_ID,
          role: "assistant",
          content: "April [S1 @ 00:42].",
          createdAt: "2026-08-09T12:00:01.000Z",
          answerClassification: "supported",
          completionState: null,
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
          {
            type: "question_reserved",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "April [S1 @ 00:42]." },
          {
            type: "persistence_started",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
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
        used_videos: 1,
        unavailable_videos: 0,
        passages_examined: 9,
        passages_used: 1,
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
          inReplyToMessageId: USER_ONLY.messages[0].id,
          role: "assistant" as const,
          content: "The sources disagree [S1 @ 00:42].",
          createdAt: "2026-08-09T12:00:01.000Z",
          answerClassification: "supported" as const,
          completionState: null,
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
          {
            type: "answer_start",
            classification: "supported",
            mode: "compare_viewpoints",
          },
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

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      questionId: RESERVED_USER_MESSAGE_ID,
      question: "Compare the viewpoints without averaging them.",
      mode: "compare_viewpoints",
    });
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
        {
          ...USER_ONLY.messages[0],
          completionState: "completed" as const,
          mode: "project_assessment" as const,
        },
        {
          id: ASSISTANT_ID,
          inReplyToMessageId: RESERVED_USER_MESSAGE_ID,
          role: "assistant" as const,
          content:
            "Project Assessment\nApril is better supported [S1 @ 00:42].",
          createdAt: "2026-08-09T12:00:01.000Z",
          answerClassification: "supported" as const,
          completionState: null,
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
          {
            type: "delta",
            text: "Project Assessment\nApril is better supported [S1 @ 00:42].",
          },
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
          questionId: RESERVED_USER_MESSAGE_ID,
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
          {
            type: "question_reserved",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "April [S1 @ 00:42]." },
          {
            type: "persistence_started",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
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
    const cancelled = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "cancelled" as const },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          {
            type: "question_reserved",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          { type: "answer_start", classification: "supported" },
          { type: "delta", text: "Partial private answer" },
          { type: "error", message: "Generation failed" },
        ),
      )
      .mockResolvedValueOnce(
        json({
          attempt: {
            status: "ready",
            userMessageId: RESERVED_USER_MESSAGE_ID,
            state: "cancelled",
            assistant: null,
          },
        }),
      )
      .mockResolvedValueOnce(json({ conversation: cancelled }));
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
    expect(result.current.conversation.messages).toEqual(cancelled.messages);
    expect(JSON.stringify(result.current)).not.toContain(
      "Partial private answer",
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("polls the exact reserved question until pre-persistence cancellation is terminal", async () => {
    const cancelled = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "cancelled" as const },
      ],
    };
    const fetch = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({
                  type: "question_reserved",
                  userMessageId: RESERVED_USER_MESSAGE_ID,
                })}\n\n`,
              ),
            );
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
      .mockResolvedValueOnce(
        json({
          attempt: {
            status: "ready",
            userMessageId: RESERVED_USER_MESSAGE_ID,
            state: "cancelled",
            assistant: null,
          },
        }),
      )
      .mockResolvedValueOnce(json({ conversation: cancelled }));
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
    await waitFor(() => expect(result.current.streaming).toBe(true));
    act(() => result.current.abort());
    await act(() => sending);
    expect(result.current.error).toBeNull();
    expect(result.current.draft).toBeNull();
    expect(result.current.conversation.messages).toEqual(cancelled.messages);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/projects/${PROJECT_ID}/conversation/attempt/${RESERVED_USER_MESSAGE_ID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reconciles a commit after 25+ newer reservations without scanning a page", async () => {
    const newerReservations = Array.from({ length: 26 }, (_, index) => ({
      ...USER_ONLY.messages[0],
      id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      content: `Newer tab question ${index + 1}`,
      createdAt: `2026-08-09T12:00:${String(index + 2).padStart(2, "0")}.000Z`,
    }));
    const targetAssistant = {
      id: ASSISTANT_ID,
      inReplyToMessageId: RESERVED_USER_MESSAGE_ID,
      role: "assistant" as const,
      content: "April [S1 @ 00:42].",
      createdAt: "2026-08-09T12:00:01.000Z",
      answerClassification: "supported" as const,
      completionState: null,
      sourceSetRevision: 3,
      sourceManifest: MANIFEST,
      sourceCoverage: COVERAGE,
      citationDiagnostics: [],
    };
    const targetCompleted = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "completed" as const },
        targetAssistant,
        ...newerReservations,
      ],
    };
    const fetch = vi
      .fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        const stream = new ReadableStream({
          start(controller) {
            for (const event of [
              {
                type: "question_reserved",
                userMessageId: RESERVED_USER_MESSAGE_ID,
              },
              { type: "source_manifest", manifest: MANIFEST },
              { type: "source_coverage", coverage: COVERAGE },
              { type: "answer_start", classification: "supported" },
              { type: "delta", text: "April [S1 @ 00:42]." },
            ]) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            }
            init.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError")),
            );
          },
        });
        return Promise.resolve(new Response(stream));
      })
      .mockResolvedValueOnce(
        json({
          attempt: {
            status: "ready",
            userMessageId: RESERVED_USER_MESSAGE_ID,
            state: "completed",
            assistant: targetAssistant,
          },
        }),
      )
      .mockResolvedValueOnce(json({ conversation: targetCompleted }));
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: {
          ...INITIAL,
          conversationId: USER_ONLY.conversationId,
        },
      }),
    );

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("When was the launch?");
    });
    await waitFor(() =>
      expect(result.current.draft?.assistant).toContain("April"),
    );
    act(() => result.current.abort());
    await act(() => sending);

    expect(result.current.conversation).toEqual(targetCompleted);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      `/api/projects/${PROJECT_ID}/conversation/attempt/${RESERVED_USER_MESSAGE_ID}?conversationId=${USER_ONLY.conversationId}`,
    );
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.capture.mock.calls[0]?.[1]).toMatchObject({
      classification: "supported",
    });
  });

  it("reconciles an early EOF before the first event by its client-known UUID", async () => {
    const assistant = {
      id: ASSISTANT_ID,
      inReplyToMessageId: RESERVED_USER_MESSAGE_ID,
      role: "assistant" as const,
      content: "April [S1 @ 00:42].",
      createdAt: "2026-08-09T12:00:01.000Z",
      answerClassification: "supported" as const,
      completionState: null,
      sourceSetRevision: 3,
      sourceManifest: MANIFEST,
      sourceCoverage: COVERAGE,
      citationDiagnostics: [],
    };
    const durable = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "completed" as const },
        assistant,
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(sse())
      .mockResolvedValueOnce(
        json({
          attempt: {
            status: "ready",
            userMessageId: RESERVED_USER_MESSAGE_ID,
            state: "completed",
            assistant,
          },
        }),
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

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `/api/projects/${PROJECT_ID}/conversation/attempt/${RESERVED_USER_MESSAGE_ID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    const firstRequest = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(firstRequest.body))).toEqual({
      questionId: RESERVED_USER_MESSAGE_ID,
      question: "When was the launch?",
    });
    expect(result.current.conversation).toEqual(durable);
    expect(result.current.error).toBeNull();
  });

  it("keeps polling the exact attempt beyond the former 2.6-second ceiling", async () => {
    vi.useFakeTimers();
    try {
      const cancelled = {
        ...USER_ONLY,
        messages: [
          { ...USER_ONLY.messages[0], completionState: "cancelled" as const },
        ],
      };
      let attemptPolls = 0;
      const fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/conversation/stream")) return Promise.resolve(sse());
        if (url.includes(`/conversation/attempt/${RESERVED_USER_MESSAGE_ID}`)) {
          attemptPolls += 1;
          return Promise.resolve(
            json({
              attempt: {
                status: "ready",
                userMessageId: RESERVED_USER_MESSAGE_ID,
                state: attemptPolls >= 10 ? "cancelled" : "reserved",
                assistant: null,
              },
            }),
          );
        }
        if (url.includes("/conversation")) {
          return Promise.resolve(json({ conversation: cancelled }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
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
      await act(async () => {
        await vi.runAllTimersAsync();
        await sending;
      });

      expect(attemptPolls).toBe(10);
      expect(result.current.conversation).toEqual(cancelled);
      expect(result.current.streaming).toBe(false);
      expect(result.current.error).toBe("Empty response from server.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles a never-created offline question after bounded exact-ID checks", async () => {
    vi.useFakeTimers();
    try {
      let attemptPolls = 0;
      const fetch = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/conversation/stream")) {
          return Promise.reject(new TypeError("offline"));
        }
        if (url.includes(`/conversation/attempt/${RESERVED_USER_MESSAGE_ID}`)) {
          attemptPolls += 1;
          return Promise.resolve(json({ message: "Not found" }, 404));
        }
        if (url.includes("/conversation")) {
          return Promise.resolve(json({ conversation: INITIAL }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
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
      await act(async () => {
        await vi.runAllTimersAsync();
        await sending;
      });

      expect(attemptPolls).toBe(8);
      expect(result.current.streaming).toBe(false);
      expect(result.current.reconciling).toBe(false);
      expect(result.current.announcement).toBe(
        "Generation stopped before your question was saved.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles an immediate pre-reservation abort instead of polling forever", async () => {
    vi.useFakeTimers();
    try {
      let attemptPolls = 0;
      const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith("/conversation/stream")) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        if (url.includes(`/conversation/attempt/${RESERVED_USER_MESSAGE_ID}`)) {
          attemptPolls += 1;
          return Promise.resolve(json({ message: "Not found" }, 404));
        }
        if (url.includes("/conversation")) {
          return Promise.resolve(json({ conversation: INITIAL }));
        }
        throw new Error(`Unexpected fetch: ${url}`);
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
      act(() => result.current.abort());
      await act(async () => {
        await vi.runAllTimersAsync();
        await sending;
      });

      expect(attemptPolls).toBe(8);
      expect(result.current.streaming).toBe(false);
      expect(result.current.reconciling).toBe(false);
      expect(result.current.announcement).toBe(
        "Generation stopped before your question was saved.",
      );
    } finally {
      vi.useRealTimers();
    }
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
    window.history.replaceState({}, "", `/workspace/projects/${PROJECT_ID}`);
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
    const summary = (
      conversationId: string,
      name: string,
      messageCount = 0,
    ) => ({
      conversationId,
      name,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      messageCount,
    });
    const fetch = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
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
        if (
          url === `/api/projects/${PROJECT_ID}/conversations` &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            json({ conversation: summary(createdId, "New conversation") }, 201),
          );
        }
        if (
          url.endsWith(`/conversations/${createdId}`) &&
          init?.method === "PATCH"
        ) {
          return Promise.resolve(json({ outcome: "renamed" }));
        }
        if (
          url.endsWith(`/conversations/${createdId}`) &&
          init?.method === "DELETE"
        ) {
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
        initialConversations: [
          summary(firstId, "Launch questions", 1),
          summary(secondId, "Comparison"),
        ],
      }),
    );

    await act(() => result.current.selectConversation(secondId));
    expect(result.current.activeConversationId).toBe(secondId);
    expect(window.location.search).toBe(`?conversationId=${secondId}`);
    await act(() => result.current.createConversation());
    expect(result.current.activeConversationId).toBe(createdId);
    expect(window.location.search).toBe(`?conversationId=${createdId}`);
    expect(result.current.conversation.sourceSetEvents).toEqual(
      sourceSetEvents,
    );
    await act(() =>
      result.current.renameConversation(createdId, "Launch questions"),
    );
    expect(result.current.conversations[0]?.name).toBe("Launch questions");
    await act(() => result.current.clearConversation(createdId));
    expect(result.current.conversation.messages).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/conversation?conversationId=${secondId}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fences out-of-order conversation loads by selection epoch", async () => {
    const firstId = "40000000-0000-4000-8000-000000000001";
    const slowId = "40000000-0000-4000-8000-000000000002";
    const latestId = "40000000-0000-4000-8000-000000000003";
    let releaseSlow!: (response: Response) => void;
    const slowResponse = new Promise<Response>((resolve) => {
      releaseSlow = resolve;
    });
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes(`conversation?conversationId=${slowId}`)) {
        return slowResponse;
      }
      if (url.includes(`conversation?conversationId=${latestId}`)) {
        return Promise.resolve(
          json({
            conversation: {
              ...INITIAL,
              conversationId: latestId,
              messages: [
                {
                  ...USER_ONLY.messages[0],
                  id: "60000000-0000-4000-8000-000000000003",
                  content: "Latest selected conversation",
                  completionState: "cancelled",
                },
              ],
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const summaries = [firstId, slowId, latestId].map((conversationId) => ({
      conversationId,
      name: conversationId === latestId ? "Latest" : "Conversation",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      messageCount: 0,
    }));
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: { ...INITIAL, conversationId: firstId },
        initialConversations: summaries,
      }),
    );

    let slowSelection!: Promise<void>;
    act(() => {
      slowSelection = result.current.selectConversation(slowId);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(() => result.current.selectConversation(latestId));
    releaseSlow(
      json({
        conversation: {
          ...INITIAL,
          conversationId: slowId,
          messages: [
            {
              ...USER_ONLY.messages[0],
              id: "60000000-0000-4000-8000-000000000002",
              content: "Stale slow conversation",
              completionState: "cancelled",
            },
          ],
        },
      }),
    );
    await act(() => slowSelection);

    expect(result.current.activeConversationId).toBe(latestId);
    expect(result.current.conversation.messages[0]?.content).toBe(
      "Latest selected conversation",
    );
    expect(JSON.stringify(result.current.conversation)).not.toContain(
      "Stale slow conversation",
    );
  });

  it("fences both earlier-turn and activity pages when selection changes", async () => {
    const firstId = "40000000-0000-4000-8000-000000000001";
    const secondId = "40000000-0000-4000-8000-000000000002";
    let releaseMessages!: (response: Response) => void;
    let releaseEvents!: (response: Response) => void;
    const messagesResponse = new Promise<Response>((resolve) => {
      releaseMessages = resolve;
    });
    const eventsResponse = new Promise<Response>((resolve) => {
      releaseEvents = resolve;
    });
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("cursor=older-turns")) return messagesResponse;
      if (url.includes("eventCursor=older-events")) return eventsResponse;
      if (url.includes(`conversation?conversationId=${secondId}`)) {
        return Promise.resolve(
          json({
            conversation: {
              ...INITIAL,
              conversationId: secondId,
              messages: [],
              sourceSetEvents: [],
            },
          }),
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
          nextCursor: "older-turns",
          nextEventCursor: "older-events",
        },
        initialConversations: [firstId, secondId].map((conversationId) => ({
          conversationId,
          name: conversationId === firstId ? "First" : "Second",
          createdAt: "2026-08-09T00:00:00.000Z",
          updatedAt: "2026-08-09T00:00:00.000Z",
          messageCount: 0,
        })),
      }),
    );

    let staleMessages!: Promise<void>;
    let staleEvents!: Promise<void>;
    act(() => {
      staleMessages = result.current.loadEarlier();
      staleEvents = result.current.loadEarlierActivity();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await act(() => result.current.selectConversation(secondId));

    releaseMessages(
      json({
        conversation: {
          ...INITIAL,
          conversationId: firstId,
          messages: [{ ...USER_ONLY.messages[0], content: "Stale older turn" }],
        },
      }),
    );
    releaseEvents(
      json({
        eventPage: {
          events: [
            {
              eventId: "70000000-0000-4000-8000-000000000001",
              projectId: PROJECT_ID,
              revision: 1,
              kind: "added",
              videoId: "50000000-0000-4000-8000-000000000001",
              videoTitle: "Stale activity",
              fromPosition: null,
              toPosition: 1,
              fromStatus: null,
              toStatus: "ready",
              createdAt: "2026-08-09T11:59:00.000Z",
            },
          ],
          nextCursor: null,
        },
      }),
    );
    await act(() => Promise.all([staleMessages, staleEvents]));

    expect(result.current.activeConversationId).toBe(secondId);
    expect(result.current.conversation.messages).toEqual([]);
    expect(result.current.conversation.sourceSetEvents).toEqual([]);
  });

  it("aborts and fences an older-message page when the conversation is cleared", async () => {
    const conversationId = "40000000-0000-4000-8000-000000000001";
    let releaseEarlier!: (response: Response) => void;
    const earlier = new Promise<Response>((resolve) => {
      releaseEarlier = resolve;
    });
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("cursor=older-turns")) return earlier;
      if (
        url.endsWith(`/conversations/${conversationId}`) &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve(json({ outcome: "cleared" }));
      }
      if (url.includes(`conversation?conversationId=${conversationId}`)) {
        return Promise.resolve(
          json({
            conversation: {
              ...INITIAL,
              conversationId,
              messages: [],
            },
          }),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: {
          ...USER_ONLY,
          conversationId,
          nextCursor: "older-turns",
        },
      }),
    );

    let stalePage!: Promise<void>;
    act(() => {
      stalePage = result.current.loadEarlier();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(() => result.current.clearConversation(conversationId));
    releaseEarlier(
      json({
        conversation: {
          ...USER_ONLY,
          conversationId,
          messages: [{ ...USER_ONLY.messages[0], content: "Resurrected" }],
        },
      }),
    );
    await act(() => stalePage);

    expect(result.current.conversation.messages).toEqual([]);
    expect(JSON.stringify(result.current.conversation)).not.toContain(
      "Resurrected",
    );
  });

  it("paginates Source Set activity independently and deduplicates boundaries", async () => {
    const event = (revision: number) => ({
      eventId: `70000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
      projectId: PROJECT_ID,
      revision,
      kind: "added" as const,
      videoId: "50000000-0000-4000-8000-000000000001",
      videoTitle: `Source ${revision}`,
      fromPosition: null,
      toPosition: revision,
      fromStatus: null,
      toStatus: "ready" as const,
      createdAt: `2026-08-09T12:${String(revision).padStart(2, "0")}:00.000Z`,
    });
    const fetch = vi.fn().mockResolvedValue(
      json({
        eventPage: {
          events: [event(1), event(2), event(3)],
          nextCursor: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() =>
      useProjectGroundedConversation({
        projectId: PROJECT_ID,
        initialConversation: {
          ...INITIAL,
          sourceSetEvents: [event(3), event(4)],
          nextEventCursor: "opaque-event-cursor",
        },
      }),
    );

    await act(() => result.current.loadEarlierActivity());

    expect(fetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/conversation?eventCursor=opaque-event-cursor`,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      result.current.conversation.sourceSetEvents?.map(
        ({ revision }) => revision,
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(result.current.conversation.nextEventCursor).toBeNull();
  });

  it("retries a failed guided question with its original mode", async () => {
    const retryQuestionId = "60000000-0000-4000-8000-000000000002";
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce(RESERVED_USER_MESSAGE_ID)
      .mockReturnValueOnce(retryQuestionId);
    const cancelled = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "cancelled" as const },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          {
            type: "question_reserved",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
          { type: "error", message: "Generation failed" },
        ),
      )
      .mockResolvedValueOnce(
        json({
          attempt: {
            status: "ready",
            userMessageId: RESERVED_USER_MESSAGE_ID,
            state: "cancelled",
            assistant: null,
          },
        }),
      )
      .mockResolvedValueOnce(json({ conversation: cancelled }))
      .mockResolvedValueOnce(
        sse(
          { type: "question_reserved", userMessageId: retryQuestionId },
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

    await act(() =>
      result.current.send("Compare the launch evidence.", "compare_viewpoints"),
    );
    expect(result.current.error).toBe("Generation failed");
    await act(() => result.current.retry());
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      `/api/projects/${PROJECT_ID}/conversation/stream`,
      expect.objectContaining({
        body: JSON.stringify({
          questionId: retryQuestionId,
          question: "Compare the launch evidence.",
          conversationId: USER_ONLY.conversationId,
          mode: "compare_viewpoints",
        }),
      }),
    );
  });

  it("retries a failed guided question with the same mode contract", async () => {
    const retryQuestionId = "60000000-0000-4000-8000-000000000003";
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce(RESERVED_USER_MESSAGE_ID)
      .mockReturnValueOnce(retryQuestionId);
    const cancelled = {
      ...USER_ONLY,
      messages: [
        { ...USER_ONLY.messages[0], completionState: "cancelled" as const },
      ],
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          {
            type: "question_reserved",
            userMessageId: RESERVED_USER_MESSAGE_ID,
          },
          { type: "error", message: "Generation failed" },
        ),
      )
      .mockResolvedValueOnce(
        json({
          attempt: {
            status: "ready",
            userMessageId: RESERVED_USER_MESSAGE_ID,
            state: "cancelled",
            assistant: null,
          },
        }),
      )
      .mockResolvedValueOnce(json({ conversation: cancelled }))
      .mockResolvedValueOnce(
        sse(
          { type: "question_reserved", userMessageId: retryQuestionId },
          { type: "source_manifest", manifest: MANIFEST },
          { type: "source_coverage", coverage: COVERAGE },
          {
            type: "answer_start",
            classification: "abstained",
            mode: "find_gaps",
          },
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
      4,
      `/api/projects/${PROJECT_ID}/conversation/stream`,
      expect.objectContaining({
        body: JSON.stringify({
          questionId: retryQuestionId,
          question: "Find supported gaps.",
          conversationId: USER_ONLY.conversationId,
          mode: "find_gaps",
        }),
      }),
    );
  });
});
