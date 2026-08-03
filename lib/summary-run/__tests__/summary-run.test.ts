import { describe, expect, it, vi } from "vitest";
import {
  createSummaryRunController,
  type SummaryRunSnapshot,
  type SummaryRunInput,
} from "../summary-run";

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SECOND_VIDEO_URL = "https://www.youtube.com/watch?v=abcdefghijk";

function streamResponse(wire: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(wire);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function controlledResponse() {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    enqueue(wire: string) {
      streamController?.enqueue(new TextEncoder().encode(wire));
    },
    close() {
      streamController?.close();
    },
  };
}

function event(type: string, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulWire(): string {
  return [
    event("metadata", { category: "general", cached: false, title: "Video" }),
    event("status", {
      stage: "transcribe",
      message: "Extracting captions...",
    }),
    event("status", {
      stage: "summarize",
      message: "Generating summary...",
    }),
    event("content", { text: "A progressive draft." }),
    event("summary", {
      category: "general",
      total_time: 3,
      transcribe_time: 1,
      summarize_time: 2,
    }),
  ].join("");
}

describe("Summary Run public controller", () => {
  it("captures an immutable input tuple, posts it, and only succeeds after terminal validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(successfulWire()));
    const mutableInput = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: "es",
      includeTranscript: true,
    };
    const input = mutableInput as SummaryRunInput;
    const snapshots: SummaryRunSnapshot[] = [];
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
      now: () => 1_000,
    });

    const unsubscribe = controller.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });
    const start = controller.start(input);
    mutableInput.video.youtubeUrl = "https://www.youtube.com/watch?v=mutated";

    expect(controller.getSnapshot().status).toBe("running");
    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      draft: { text: "" },
      progress: { stage: "preparing" },
    });
    const runningSnapshot = controller.getSnapshot();
    if (runningSnapshot.status !== "running") {
      throw new Error("expected a running snapshot");
    }
    expect("progress" in runningSnapshot.progress).toBe(false);

    await start;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      youtube_url: VIDEO_URL,
      include_transcript: true,
      output_language: "es",
    });
    expect(init.headers).toMatchObject({
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot).toMatchObject({
      status: "succeeded",
      summary: {
        title: "Video",
        summary: "A progressive draft.",
        origin: "generated",
        transcriptionTime: 1,
        summaryTime: 2,
      },
    });
    expect("draft" in snapshot).toBe(false);
    expect("rawData" in snapshot).toBe(false);
    expect("response" in snapshot).toBe(false);
    expect(snapshots.map((item) => item.status)).toContain("running");
    expect(snapshots.at(-1)?.status).toBe("succeeded");

    unsubscribe();
  });

  it("decodes UTF-8 bytes and frames split at arbitrary boundaries exactly once", async () => {
    const summaryText = "R\u00e9sum\u00e9 \u{1F4A1}";
    const wire = [
      event("metadata", { category: "general", cached: true }),
      event("content", { text: summaryText }),
      event("summary", {
        category: "general",
        total_time: 1,
        transcribe_time: 0,
        summarize_time: 1,
      }),
    ].join("");
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(streamResponse(wire, 1)),
      getAccessToken: () => "token",
      createRunId: () => "byte-split-run",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      origin: "cache",
      summary: { summary: summaryText },
    });
  });

  it.each([
    {
      name: "premature EOF",
      wire: [
        event("metadata", { category: "general", cached: false }),
        event("content", { text: "draft" }),
      ].join(""),
      code: "PREMATURE_EOF",
    },
    {
      name: "missing metadata",
      wire: event("content", { text: "draft" }) + event("summary", {
        category: "general",
        total_time: 1,
        transcribe_time: 0,
        summarize_time: 1,
      }),
      code: "MISSING_METADATA",
    },
    {
      name: "empty accumulated content",
      wire: event("metadata", { category: "general", cached: false }) + event("summary", {
        category: "general",
        total_time: 1,
        transcribe_time: 0,
        summarize_time: 1,
      }),
      code: "EMPTY_SUMMARY",
    },
    {
      name: "unknown non-Transcript event",
      wire: event("future_event", { privatePayload: "must not render" }),
      code: "unknown_event_variant",
    },
    {
      name: "malformed non-Transcript event",
      wire: event("content", { text: 123 }),
      code: "invalid_event",
    },
    {
      name: "event after terminal Summary",
      wire: successfulWire() + event("content", { text: "late" }),
      code: "EVENT_AFTER_TERMINATION",
    },
  ])("does not succeed on $name", async ({ wire, code }) => {
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(streamResponse(wire)),
      getAccessToken: () => "token",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      error: { kind: "protocol", code },
    });
  });

  it.each([
    {
      name: "authentication",
      fetchResult: jsonResponse(401, {
        message: "private upstream auth details",
      }),
      expected: {
        kind: "authentication",
        code: "AUTHENTICATION_FAILED",
        message: "Authentication failed. Please sign in again.",
      },
    },
    {
      name: "quota",
      fetchResult: jsonResponse(402, {
        message: "private billing payload",
        errorCode: "free_quota_exceeded",
        tier: "free",
        upgradeUrl: "/pricing",
      }),
      expected: {
        kind: "quota",
        code: "QUOTA_EXCEEDED",
        message: "You've reached your summary limit. Upgrade to continue.",
        quota: {
          errorCode: "free_quota_exceeded",
          tier: "free",
          upgradeUrl: "/pricing",
        },
      },
    },
    {
      name: "rate limit",
      fetchResult: jsonResponse(429, {
        message: "private rate limiter payload",
      }),
      expected: {
        kind: "rate_limit",
        code: "RATE_LIMITED",
        message: "Too many summary requests. Please wait a moment and try again.",
      },
    },
    {
      name: "request",
      fetchResult: jsonResponse(400, {
        message: "private validation payload",
      }),
      expected: {
        kind: "request",
        code: "INVALID_REQUEST",
        message: "Please check the YouTube URL and try again.",
      },
    },
  ])("exposes safe $name request failure information", async ({
    fetchResult,
    expected,
  }) => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResult);
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      error: expected,
    });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain("private");
  });

  it("exposes a safe authentication-required failure when no session token exists", async () => {
    const fetchMock = vi.fn();
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => null,
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      error: {
        kind: "authentication",
        code: "AUTH_REQUIRED",
        message:
          "Authentication is required to summarize this video. Please sign in again.",
        status: 401,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies processing, network, protocol, and premature-EOF failures without promoting a draft", async () => {
    const cases = [
      {
        name: "processing",
        fetchMock: vi.fn().mockResolvedValue(
          streamResponse(
            event("metadata", { category: "general", cached: false }) +
              event("content", { text: "retained draft" }) +
              event("error", {
                message: "private model exception",
                errorId: "PRIVATE_UPSTREAM_ERROR",
              }),
          ),
        ),
        expected: {
          kind: "processing",
          code: "PROCESSING_FAILURE",
          message:
            "Couldn't process this video. Please try again or try a different URL.",
        },
      },
      {
        name: "network",
        fetchMock: vi
          .fn()
          .mockRejectedValue(new Error("private socket exception")),
        expected: {
          kind: "network",
          code: "NETWORK_FAILURE",
          message: "Couldn't connect to the summary service. Please try again.",
        },
      },
      {
        name: "protocol",
        fetchMock: vi.fn().mockResolvedValue(
          streamResponse("data: {private malformed payload\n\n"),
        ),
        expected: {
          kind: "protocol",
          code: "malformed_json",
          message: "The summary stream was invalid. Please try again.",
        },
      },
      {
        name: "premature EOF",
        fetchMock: vi.fn().mockResolvedValue(
          streamResponse(
            event("metadata", { category: "general", cached: false }) +
              event("content", { text: "retained draft" }),
          ),
        ),
        expected: {
          kind: "protocol",
          code: "PREMATURE_EOF",
          message:
            "The summary stream ended before the Summary was complete. Please try again.",
        },
      },
    ];

    for (const { name, fetchMock, expected } of cases) {
      const controller = createSummaryRunController({
        fetch: fetchMock,
        getAccessToken: () => "token",
      });

      await controller.start({
        video: { youtubeUrl: VIDEO_URL },
        outputLanguage: null,
        includeTranscript: false,
      });

      expect(controller.getSnapshot(), name).toMatchObject({
        status: "failed",
        error: expected,
      });
      expect(controller.getSnapshot()).not.toHaveProperty("summary");
    }
  });

  it("terminates a run on a broken response connection and retains only a non-actionable draft", async () => {
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      pull(streamController) {
        if (!sent) {
          sent = true;
          streamController.enqueue(
            new TextEncoder().encode(
              event("metadata", { category: "general", cached: false }) +
                event("content", { text: "draft before disconnect" }),
            ),
          );
          return;
        }
        streamController.error(new Error("private connection failure"));
      },
    });
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
      getAccessToken: () => "token",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "failed",
      draft: { text: "draft before disconnect" },
      error: {
        kind: "network",
        code: "NETWORK_FAILURE",
        message: "Couldn't connect to the summary service. Please try again.",
      },
    });
    expect(controller.getSnapshot()).not.toHaveProperty("summary");
  });

  it("does not automatically replay a failed request, while explicit retry creates a run with exact immutable inputs", async () => {
    const firstInput = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: "es" as const,
      includeTranscript: true,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse(
          event("metadata", { category: "general", cached: false }) +
            event("content", { text: "failed draft" }) +
            event("error", {
              message: "private failure payload",
              errorId: "PRIVATE_FAILURE",
            }),
        ),
      )
      .mockResolvedValueOnce(streamResponse(successfulWire()));
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
      createRunId: vi
        .fn()
        .mockReturnValueOnce("failed-run")
        .mockReturnValueOnce("retried-run"),
    });
    const mutableInput = {
      video: { youtubeUrl: firstInput.video.youtubeUrl },
      outputLanguage: firstInput.outputLanguage,
      includeTranscript: firstInput.includeTranscript,
    };

    await controller.start(mutableInput);
    mutableInput.video.youtubeUrl = "https://www.youtube.com/watch?v=mutated";

    const failed = controller.getSnapshot();
    expect(failed).toMatchObject({
      status: "failed",
      runId: "failed-run",
      input: firstInput,
    });
    if (failed.status !== "failed") {
      throw new Error("expected a failed snapshot");
    }
    expect(Object.isFrozen(failed.input)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await controller.retry();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      runId: "retried-run",
    });
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        youtube_url: VIDEO_URL,
        include_transcript: true,
        output_language: "es",
      });
    }
  });

  it("only retries the terminal failed run and does not retry a success or cancellation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse(successfulWire()));
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
    });
    const input: SummaryRunInput = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    };

    await controller.start(input);
    await controller.retry();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const pending = controller.start(input);
    controller.cancel();
    await pending;
    await controller.retry();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps retried run identities distinct even when the injected ID factory repeats", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse(
          event("metadata", { category: "general", cached: false }) +
            event("error", { message: "private failure" }),
        ),
      )
      .mockResolvedValueOnce(streamResponse(successfulWire()));
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
      createRunId: () => "same-run-id",
    });
    const input: SummaryRunInput = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    };

    await controller.start(input);
    const failedSnapshot = controller.getSnapshot();
    const failedRunId = failedSnapshot.status === "failed"
      ? failedSnapshot.runId
      : null;
    await controller.retry();
    const retriedSnapshot = controller.getSnapshot();
    const retriedRunId = retriedSnapshot.status === "succeeded"
      ? retriedSnapshot.runId
      : null;

    expect(failedRunId).toBe("same-run-id");
    expect(retriedRunId).toBe("same-run-id-retry-1");
  });

  it("keeps every run identity distinct across repeated retries", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamResponse(
          event("metadata", { category: "general", cached: false }) +
            event("error", { message: "private failure" }),
        ),
      );
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
      createRunId: () => "same-run-id",
    });
    const input: SummaryRunInput = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    };

    await controller.start(input);
    await controller.retry();
    await controller.retry();

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe("failed");
    if (snapshot.status === "failed") {
      expect(snapshot.runId).toBe("same-run-id-retry-2");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats an invalid transcript payload as unavailable while preserving a valid Summary", async () => {
    const wire = [
      event("metadata", { category: "general", cached: false }),
      event("full_transcript", {
        segments: [],
        source: "whisper",
      }),
      event("content", { text: "Summary without transcript." }),
      event("summary", {
        category: "general",
        total_time: 2,
        transcribe_time: 1,
        summarize_time: 1,
      }),
    ].join("");
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(streamResponse(wire)),
      getAccessToken: () => "token",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: true,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      transcript: { status: "unavailable", diagnostic: "invalid_full_transcript" },
      summary: { summary: "Summary without transcript." },
    });
  });

  it.each([
    {
      name: "not requested",
      includeTranscript: false,
      transcript: { status: "not_requested" },
      wire: successfulWire(),
    },
    {
      name: "requested but missing",
      includeTranscript: true,
      transcript: { status: "unavailable", diagnostic: "not_received" },
      wire: successfulWire(),
    },
    {
      name: "valid timed segments",
      includeTranscript: true,
      transcript: {
        status: "available",
        segments: [{ text: "Timed line", start: 12, duration: 2 }],
        source: "auto_captions",
      },
      wire: [
        event("metadata", { category: "general", cached: false }),
        event("full_transcript", {
          segments: [{ text: "Timed line", start: 12, duration: 2 }],
          source: "auto_captions",
        }),
        event("content", { text: "Summary remains valid." }),
        event("summary", {
          category: "general",
          total_time: 2,
          transcribe_time: 1,
          summarize_time: 1,
        }),
      ].join(""),
    },
  ])("represents the Transcript state independently for $name", async ({
    includeTranscript,
    transcript,
    wire,
  }) => {
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(streamResponse(wire)),
      getAccessToken: () => "token",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      transcript,
    });
  });

  it("does not expose a zero-duration Transcript entry as available timing", async () => {
    const wire = [
      event("metadata", { category: "general", cached: false }),
      event("full_transcript", {
        segments: [{ text: "Legacy transcript", start: 0, duration: 0 }],
        source: "whisper",
      }),
      event("content", { text: "Summary without timed transcript." }),
      event("summary", {
        category: "general",
        total_time: 2,
        transcribe_time: 1,
        summarize_time: 1,
      }),
    ].join("");
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(streamResponse(wire)),
      getAccessToken: () => "token",
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: true,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      transcript: {
        status: "unavailable",
        diagnostic: "invalid_full_transcript",
      },
      summary: { summary: "Summary without timed transcript." },
    });
  });

  it("sends every explicit start and never reuses a previous terminal result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(successfulWire()))
      .mockResolvedValueOnce(
        streamResponse(
          [
            event("metadata", { category: "general", cached: true }),
            event("content", { text: "second run" }),
            event("summary", {
              category: "general",
              total_time: 1,
              transcribe_time: 0,
              summarize_time: 1,
            }),
          ].join(""),
        ),
      );
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
    });
    const input = {
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    } as SummaryRunInput;

    await controller.start(input);
    await controller.start(input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      summary: { summary: "second run" },
    });
  });

  it("keeps late events isolated when a run identity source repeats", async () => {
    const first = controlledResponse();
    const second = controlledResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const observed: SummaryRunSnapshot[] = [];
    const controller = createSummaryRunController({
      fetch: fetchMock,
      getAccessToken: () => "token",
      createRunId: () => "reused-id",
    });
    controller.subscribe((snapshot) => observed.push(snapshot));

    const firstStart = controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });
    await Promise.resolve();

    const secondStart = controller.start({
      video: { youtubeUrl: SECOND_VIDEO_URL },
      outputLanguage: "es",
      includeTranscript: false,
    });
    await Promise.resolve();

    const replacement = controller.getSnapshot();
    expect(replacement).toMatchObject({
      status: "running",
      input: {
        video: { youtubeUrl: SECOND_VIDEO_URL },
        outputLanguage: "es",
      },
    });
    if (replacement.status !== "running") {
      throw new Error("expected the replacement run to be active");
    }
    expect(replacement.runId).not.toBe("reused-id");

    first.enqueue(
      event("metadata", { category: "general", cached: false }) +
        event("content", { text: "stale output" }),
    );
    await Promise.resolve();

    expect(controller.getSnapshot()).toEqual(replacement);
    expect(
      observed.some(
        (snapshot) =>
          snapshot.status === "running" &&
          snapshot.input.video.youtubeUrl === VIDEO_URL &&
          snapshot.draft.text === "stale output",
      ),
    ).toBe(false);

    controller.cancel();
    second.close();
    first.close();
    await Promise.all([firstStart, secondStart]);
    expect(controller.getSnapshot().status).toBe("cancelled");
  });

  it("invalidates a succeeded Summary before a replacement can produce output", async () => {
    const replacement = controlledResponse();
    const controller = createSummaryRunController({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(streamResponse(successfulWire()))
        .mockResolvedValueOnce(replacement.response),
      getAccessToken: () => "token",
      createRunId: vi
        .fn()
        .mockReturnValueOnce("native-run")
        .mockReturnValueOnce("spanish-run"),
    });

    await controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: "succeeded",
      runId: "native-run",
    });

    const replacementStart = controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: "es",
      includeTranscript: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      runId: "spanish-run",
      input: { outputLanguage: "es" },
      draft: { text: "" },
    });
    expect("summary" in controller.getSnapshot()).toBe(false);

    controller.cancel();
    replacement.close();
    await replacementStart;
    expect(controller.getSnapshot().status).toBe("cancelled");
  });

  it("keeps the replacement timer alive when an observer starts it synchronously", async () => {
    vi.useFakeTimers();
    let currentTime = 1_000;
    const first = controlledResponse();
    const second = controlledResponse();
    let firstRunId: string | null = null;
    let replacementStart: Promise<void> | undefined;
    const controller = createSummaryRunController({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(first.response)
        .mockResolvedValueOnce(second.response),
      getAccessToken: () => "token",
      now: () => currentTime,
      createRunId: vi
        .fn()
        .mockReturnValueOnce("first-run")
        .mockReturnValueOnce("second-run"),
    });
    controller.subscribe((snapshot) => {
      if (snapshot.status !== "running" || firstRunId !== null) return;
      firstRunId = snapshot.runId;
      replacementStart = controller.start({
        video: { youtubeUrl: SECOND_VIDEO_URL },
        outputLanguage: "es",
        includeTranscript: false,
      });
    });

    const firstStart = controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });
    expect(replacementStart).toBeDefined();
    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      runId: "second-run",
    });

    currentTime = 2_000;
    vi.advanceTimersByTime(100);
    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      runId: "second-run",
      progress: { elapsedSeconds: 1 },
    });

    controller.cancel();
    first.close();
    second.close();
    await Promise.all([firstStart, replacementStart!]);
    vi.useRealTimers();
  });

  it("owns elapsed time in the running snapshot and freezes it on cancellation", async () => {
    vi.useFakeTimers();
    let currentTime = 1_000;
    const streamControllerRef = {
      current: null as ReadableStreamDefaultController<Uint8Array> | null,
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamControllerRef.current = controller;
      },
    });
    const controller = createSummaryRunController({
      fetch: vi.fn().mockResolvedValue(new Response(body)),
      getAccessToken: () => "token",
      now: () => currentTime,
    });

    const pending = controller.start({
      video: { youtubeUrl: VIDEO_URL },
      outputLanguage: null,
      includeTranscript: false,
    });
    await Promise.resolve();
    currentTime = 3_500;
    vi.advanceTimersByTime(100);
    expect(controller.getSnapshot()).toMatchObject({
      status: "running",
      progress: { elapsedSeconds: 2.5 },
    });

    controller.cancel();
    expect(controller.getSnapshot()).toMatchObject({
      status: "cancelled",
      progress: { elapsedSeconds: 2.5 },
    });
    streamControllerRef.current?.close();
    await pending;
    expect(controller.getSnapshot().status).toBe("cancelled");
    vi.useRealTimers();
  });
});
