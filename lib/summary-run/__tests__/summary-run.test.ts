import { describe, expect, it, vi } from "vitest";
import {
  createSummaryRunController,
  type SummaryRunSnapshot,
  type SummaryRunInput,
} from "../summary-run";

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

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

function event(type: string, payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...payload })}\n\n`;
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
