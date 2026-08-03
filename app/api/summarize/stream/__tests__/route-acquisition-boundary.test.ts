import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TranscriptAcquisitionInput,
  TranscriptAcquisitionOutcome,
  TranscriptAcquisitionSuccess,
} from "@/lib/services/transcript-acquisition";
import type { CachedSummary } from "@/lib/services/summarize-cache";
import { SummarySseEventSchema } from "@/lib/api-contracts/summary";
import type { LlmEvent } from "@/lib/services/llm-client";

const { mocks, afterPassthrough } = vi.hoisted(() => {
  const afterPassthrough = (fn: () => unknown) => fn();
  return {
    afterPassthrough,
    mocks: {
      resolveRequestPrincipal: vi.fn(),
      acquireTranscript: vi.fn(),
      getCachedSummary: vi.fn(),
      writeCachedSummary: vi.fn(),
      buildSummarizationPrompt: vi.fn(),
      streamLlmSummary: vi.fn(),
      classifyContent: vi.fn(),
      checkRateLimit: vi.fn(),
      checkSummaryEntitlement: vi.fn(),
      after: vi.fn(afterPassthrough),
    },
  };
});

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return { ...actual, after: mocks.after };
});

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/services/transcript-acquisition", () => ({
  acquireTranscript: mocks.acquireTranscript,
}));

vi.mock("@/lib/services/summarize-cache", () => ({
  getCachedSummary: mocks.getCachedSummary,
  writeCachedSummary: mocks.writeCachedSummary,
}));

vi.mock("@/lib/prompts/summarization", () => ({
  buildSummarizationPrompt: mocks.buildSummarizationPrompt,
}));

vi.mock("@/lib/services/llm-client", () => ({
  streamLlmSummary: mocks.streamLlmSummary,
}));

vi.mock("@/lib/services/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/services/entitlements", () => ({
  checkSummaryEntitlement: mocks.checkSummaryEntitlement,
  FREE_LIMITS: {
    summariesPerMonth: 10,
    chatMessagesPerVideo: 5,
    historyItems: 10,
  },
  ANON_LIMITS: { summariesLifetime: 1 },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/services/anon-cookie", () => ({
  ANON_COOKIE_NAME: "yt_anon_id",
  ANON_COOKIE_MAX_AGE_SECONDS: 31_536_000,
  signAnonId: (id: string) => `${id}.sig`,
  verifyAnonId: () => null,
}));

vi.mock("@/lib/services/model-routing", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/services/model-routing")
  >("@/lib/services/model-routing");
  return { ...actual, classifyContent: mocks.classifyContent };
});

import { POST } from "../route";

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const CANONICAL_TEXT = Array.from(
  { length: 5_000 },
  (_, index) => `word-${index}`,
).join(" ");
const TRANSCRIPT_SEGMENTS = [
  { text: CANONICAL_TEXT, start: 0, duration: 300 },
] as const;

function makeRequest(
  body: unknown,
  options: { requestId?: string; signal?: AbortSignal } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.requestId) headers["X-Request-ID"] = options.requestId;
  return new Request("https://app.test/api/summarize/stream", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal,
  });
}

async function* fakeGen(events: LlmEvent[]): AsyncGenerator<LlmEvent> {
  for (const event of events) yield event;
}

async function readEvents(response: Response): Promise<Record<string, unknown>[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }

  return buffer
    .split("\n\n")
    .map((chunk) => chunk.replace(/^data: /, ""))
    .filter(Boolean)
    .map((chunk) => SummarySseEventSchema.parse(JSON.parse(chunk)) as Record<string, unknown>);
}

function acquired(
  overrides: Partial<TranscriptAcquisitionSuccess> = {},
): TranscriptAcquisitionSuccess {
  return {
    outcome: "success",
    segments: TRANSCRIPT_SEGMENTS,
    transcriptSource: "auto_captions",
    promptLocale: "en",
    title: "Known title",
    channelName: "Known channel",
    reusedStoredTranscript: false,
    acquisitionDurationSeconds: 2.5,
    ...overrides,
  };
}

function cachedSummary(overrides: Partial<CachedSummary> = {}): CachedSummary {
  return {
    videoId: "video-1",
    title: "Cached title",
    channelName: "Cached channel",
    language: "en",
    transcript: CANONICAL_TEXT,
    summary: "Cached summary",
    transcriptSource: "auto_captions",
    model: "claude-haiku-4-5",
    processingTimeSeconds: 8,
    transcribeTimeSeconds: 2,
    summarizeTimeSeconds: 6,
    outputLanguage: null,
    ...overrides,
  };
}

describe("POST /api/summarize/stream at the Transcript Acquisition seam", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "user-1",
        isAnonymous: false,
        email: "user@example.com",
      },
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 20 });
    mocks.checkSummaryEntitlement.mockResolvedValue({
      tier: "free",
      allowed: true,
      remaining: 10,
      reason: "within_limit",
    });
    mocks.getCachedSummary.mockResolvedValue(null);
    mocks.writeCachedSummary.mockResolvedValue(undefined);
    mocks.buildSummarizationPrompt.mockReturnValue("PROMPT");
    mocks.classifyContent.mockResolvedValue({
      density: "high",
      type: "other",
      structure: "structured",
    });
    mocks.streamLlmSummary.mockImplementation(() =>
      fakeGen([
        { type: "content", text: "Generated summary" },
        { type: "timing", summarizeSeconds: 1.25 },
      ]),
    );
    mocks.acquireTranscript.mockResolvedValue(acquired());
    mocks.after.mockImplementation(afterPassthrough);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps semantic progress at the SSE boundary and reuses one flat Transcript downstream", async () => {
    let acquisitionInput: TranscriptAcquisitionInput | undefined;
    mocks.acquireTranscript.mockImplementation(
      async (input: TranscriptAcquisitionInput): Promise<TranscriptAcquisitionOutcome> => {
        acquisitionInput = input;
        input.onProgress?.({
          type: "language_detection",
          detectedLanguage: "fr-FR",
        });
        input.onProgress?.({ type: "caption_acquisition" });
        return acquired({ detectedLanguage: "fr-FR" });
      },
    );

    const response = await POST(
      makeRequest(
        { youtube_url: VALID_URL, include_transcript: true },
        { requestId: "11111111-1111-4111-8111-111111111111" },
      ),
    );
    const events = await readEvents(response);

    expect(mocks.acquireTranscript).toHaveBeenCalledTimes(1);
    expect(acquisitionInput).toMatchObject({
      youtubeUrl: VALID_URL,
      requestId: "11111111-1111-4111-8111-111111111111",
      signal: expect.any(AbortSignal),
    });
    expect(events.filter((event) => event.type === "status")).toEqual([
      {
        type: "status",
        message: "Detected language: fr-FR",
        stage: "summarize",
      },
      {
        type: "status",
        message: "Extracting captions...",
        stage: "transcribe",
      },
    ]);
    expect(events).toContainEqual({
      type: "full_transcript",
      segments: TRANSCRIPT_SEGMENTS,
      source: "auto_captions",
    });
    expect(mocks.classifyContent).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptExcerpt: CANONICAL_TEXT.slice(0, 4_000),
        title: "Known title",
        language: "en",
      }),
    );
    expect(mocks.buildSummarizationPrompt).toHaveBeenCalledWith(
      CANONICAL_TEXT,
      expect.any(Number),
      undefined,
    );
    expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: CANONICAL_TEXT,
        transcribeTimeSeconds: 2.5,
        title: "Known title",
        channelName: "Known channel",
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "summary",
      transcribe_time: 2.5,
      summarize_time: 1.25,
      total_time: 3.75,
    });
  });

  it("maps known acquisition failures to the existing user-facing SSE error", async () => {
    mocks.acquireTranscript.mockResolvedValue({
      outcome: "acquisition_failed",
      failure: {
        stage: "captions",
        errorId: "VPS_CAPTIONS_FAILED_HTTP_503",
        requestId: "req-211",
        status: 503,
      },
    });

    const events = await readEvents(
      await POST(makeRequest({ youtube_url: VALID_URL })),
    );

    expect(events).toContainEqual({
      type: "error",
      message:
        "Couldn't process this video. Please try again or try a different URL.",
      errorId: "VPS_CAPTIONS_FAILED_HTTP_503",
    });
    expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
  });

  it("keeps caller cancellation silent and leaves Summary generation untouched", async () => {
    mocks.acquireTranscript.mockResolvedValue({ outcome: "caller_aborted" });

    const events = await readEvents(
      await POST(makeRequest({ youtube_url: VALID_URL })),
    );

    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
  });

  it("keeps unexpected acquisition throws on the route defect path", async () => {
    const defect = new Error("acquisition invariant failed");
    mocks.acquireTranscript.mockRejectedValue(defect);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const events = await readEvents(
      await POST(makeRequest({ youtube_url: VALID_URL })),
    );

    expect(events).toContainEqual({
      type: "error",
      message: "Something went wrong generating the summary. Please try again.",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[summarize/stream] unknown failed",
      expect.objectContaining({ stage: "unknown", errorName: "Error" }),
    );
  });

  it("uses the cached Summary without acquiring a Transcript when the display is omitted", async () => {
    mocks.getCachedSummary.mockResolvedValue(cachedSummary());

    const events = await readEvents(
      await POST(
        makeRequest({ youtube_url: VALID_URL, include_transcript: false }),
      ),
    );

    expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "metadata",
      "content",
      "summary",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "summary",
      transcribe_time: 2,
      summarize_time: 6,
      total_time: 8,
    });
  });

  it("routes a cached Summary with the acquired stored Transcript and reports zero acquisition time", async () => {
    mocks.getCachedSummary.mockResolvedValue(cachedSummary());
    mocks.acquireTranscript.mockResolvedValue(
      acquired({
        reusedStoredTranscript: true,
        acquisitionDurationSeconds: 0,
        title: "Stored title",
        channelName: "Stored channel",
      }),
    );

    const events = await readEvents(
      await POST(
        makeRequest({ youtube_url: VALID_URL, include_transcript: true }),
      ),
    );

    expect(mocks.acquireTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "full_transcript",
      segments: TRANSCRIPT_SEGMENTS,
      source: "auto_captions",
    });
    expect(events.at(-1)).toMatchObject({
      type: "summary",
      transcribe_time: 0,
      summarize_time: 6,
      total_time: 6,
    });
  });

  it("allows a known title to classify while withholding an incomplete Summary-cache write", async () => {
    mocks.acquireTranscript.mockResolvedValue(
      acquired({ title: "Known title", channelName: undefined }),
    );

    await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

    expect(mocks.classifyContent).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Known title" }),
    );
    expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
  });
});
