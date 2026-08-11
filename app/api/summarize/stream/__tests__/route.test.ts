import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SummarySseEventSchema } from "@/lib/api-contracts/summary";
import type { LlmEvent } from "@/lib/services/llm-client";
import {
  HAIKU,
  SPARK_CHAR_BUDGET,
  SONNET,
} from "@/lib/services/model-routing";
import type { CachedSummary } from "@/lib/services/summarize-cache";
import type {
  TranscriptAcquisitionInput,
  TranscriptAcquisitionSuccess,
} from "@/lib/services/transcript-acquisition";

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
      nominateCatalogVideoForAdmission: vi.fn(),
      runCatalogAdmissionWorker: vi.fn(),
      after: vi.fn(afterPassthrough),
      signAnonId: vi.fn(),
      verifyAnonId: vi.fn(),
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

vi.mock("@/lib/catalog/catalog-admission", () => ({
  nominateCatalogVideoForAdmission:
    mocks.nominateCatalogVideoForAdmission,
}));

vi.mock("@/lib/catalog/catalog-admission-worker", () => ({
  runCatalogAdmissionWorker: mocks.runCatalogAdmissionWorker,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/services/anon-cookie", () => ({
  ANON_COOKIE_NAME: "yt_anon_id",
  ANON_COOKIE_MAX_AGE_SECONDS: 31_536_000,
  signAnonId: (id: string) => mocks.signAnonId(id),
  verifyAnonId: (value: string) => mocks.verifyAnonId(value),
}));

vi.mock("@/lib/services/model-routing", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/services/model-routing")
  >("@/lib/services/model-routing");
  return { ...actual, classifyContent: mocks.classifyContent };
});

import { POST } from "../route";
import { runServerSummaryRun } from "@/lib/summary-run/server-summary-run";

const VALID_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const DEFAULT_SEGMENTS = [
  { text: "captioned transcript", start: 0, duration: 10 },
] as const;

function resolvedPrincipal(
  userId: string,
  isAnonymous = false,
  smokeProEntitled?: boolean,
) {
  return {
    kind: "resolved" as const,
    principal: {
      userId,
      isAnonymous,
      email: isAnonymous ? "" : "user@example.com",
      smokeProEntitled,
      businessAnalyticsSuppressed: false,
    },
  };
}

function makeRequest(
  body: unknown,
  options: {
    bodyIsRaw?: string;
    requestId?: string;
    signal?: AbortSignal;
  } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.requestId) headers["X-Request-ID"] = options.requestId;
  return new Request("https://app.test/api/summarize/stream", {
    method: "POST",
    headers,
    body: options.bodyIsRaw ?? JSON.stringify(body),
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
    .map(
      (chunk) =>
        SummarySseEventSchema.parse(JSON.parse(chunk)) as Record<
          string,
          unknown
        >,
    );
}

function acquired(
  overrides: Partial<TranscriptAcquisitionSuccess> = {},
): TranscriptAcquisitionSuccess {
  return {
    outcome: "success",
    segments: DEFAULT_SEGMENTS,
    transcriptSource: "auto_captions",
    promptLocale: "en",
    title: "Live title",
    channelName: "Live channel",
    reusedStoredTranscript: false,
    acquisitionDurationSeconds: 2,
    ...overrides,
  };
}

function cachedSummary(overrides: Partial<CachedSummary> = {}): CachedSummary {
  return {
    videoId: "video-1",
    title: "Cached title",
    channelName: "Cached channel",
    language: "en",
    transcript: "cached transcript",
    summary: "Cached summary",
    transcriptSource: "whisper",
    model: HAIKU,
    processingTimeSeconds: 10,
    transcribeTimeSeconds: 4,
    summarizeTimeSeconds: 6,
    outputLanguage: null,
    ...overrides,
  };
}

describe("POST /api/summarize/stream", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.resolveRequestPrincipal.mockResolvedValue(
      resolvedPrincipal("user-1"),
    );
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
      reason: "within_limit",
    });
    mocks.checkSummaryEntitlement.mockResolvedValue({
      tier: "free",
      allowed: true,
      remaining: 10,
      reason: "within_limit",
    });
    mocks.getCachedSummary.mockResolvedValue(null);
    mocks.acquireTranscript.mockResolvedValue(acquired());
    mocks.buildSummarizationPrompt.mockReturnValue("PROMPT");
    mocks.classifyContent.mockResolvedValue(null);
    mocks.streamLlmSummary.mockImplementation(() =>
      fakeGen([
        { type: "content", text: "Generated summary" },
        { type: "timing", summarizeSeconds: 1.5 },
      ]),
    );
    mocks.writeCachedSummary.mockResolvedValue(undefined);
    mocks.nominateCatalogVideoForAdmission.mockResolvedValue({
      outcome: "enqueued",
    });
    mocks.runCatalogAdmissionWorker.mockResolvedValue({
      claimed: 1,
      completed: 1,
      retried: 0,
      exhausted: 0,
    });
    mocks.after.mockImplementation(afterPassthrough);
    mocks.signAnonId.mockImplementation((id: string) => `${id}.sig`);
    mocks.verifyAnonId.mockImplementation((value: string) =>
      value.endsWith(".sig") ? value.replace(/\.sig$/, "") : null,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("request validation and correlation", () => {
    it("returns a correlated 400 for invalid JSON", async () => {
      const response = await POST(
        makeRequest(null, { bodyIsRaw: "{not-json" }),
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ message: "Invalid JSON body" });
      expect(response.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get("X-Error-ID")).toBe("INVALID_JSON");
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    });

    it.each([
      ["a missing URL", {}],
      ["a non-HTTPS URL", { youtube_url: "http://youtube.com/watch?v=x" }],
      ["a non-YouTube host", { youtube_url: "https://evil.com/watch?v=x" }],
      ["a malformed video ID", { youtube_url: "https://youtu.be/abc" }],
      [
        "an ambiguous host",
        { youtube_url: "https://www.youtube.com@evil.com/watch?v=x" },
      ],
      [
        "an unsupported output language",
        { youtube_url: VALID_URL, output_language: "elvish" },
      ],
    ])("returns 400 for %s", async (_caseName, body) => {
      const response = await POST(makeRequest(body));

      expect(response.status).toBe(400);
      expect(response.headers.get("X-Error-ID")).toBe("INVALID_REQUEST");
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    });

    it("echoes an accepted request ID and passes it to Transcript Acquisition", async () => {
      const requestId = "req-148-example";
      const response = await POST(
        makeRequest({ youtube_url: VALID_URL }, { requestId }),
      );
      await readEvents(response);

      expect(response.headers.get("X-Request-ID")).toBe(requestId);
      expect(mocks.acquireTranscript).toHaveBeenCalledWith(
        expect.objectContaining({
          youtubeUrl: VALID_URL,
          requestId,
          signal: expect.any(AbortSignal),
          onProgress: expect.any(Function),
        }),
      );
    });

    it("replaces malformed request IDs instead of reflecting them", async () => {
      const response = await POST(
        makeRequest(null, {
          bodyIsRaw: "{not-json",
          requestId: "bad id",
        }),
      );

      expect(response.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.get("X-Request-ID")).not.toBe("bad id");
    });
  });

  describe("authentication, rate limits, and entitlements", () => {
    it("returns 401 before starting route work when authentication is missing", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Unauthorized" });
      expect(response.headers.get("X-Error-ID")).toBe("AUTH_REQUIRED");
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    });

    it("returns 503 when authentication is unavailable", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        message: "Auth service temporarily unavailable.",
      });
      expect(response.headers.get("X-Error-ID")).toBe(
        "AUTH_SERVICE_UNAVAILABLE",
      );
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    });

    it("returns 429 with the remaining quota when rate limited", async () => {
      mocks.checkRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
      });

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.status).toBe(429);
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(response.headers.get("X-Error-ID")).toBe("RATE_LIMITED");
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    });

    it("maps the successful rate-limit result to stream headers", async () => {
      mocks.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 15,
        reason: "within_limit",
      });
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(response.headers.get("X-RateLimit-Remaining")).toBe("15");
    });

    it("logs rate-limit fail-open without exposing the mode", async () => {
      mocks.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 10,
        reason: "fail_open",
      });
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.headers.get("X-RateLimit-Mode")).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        "[summarize/stream] rate-limit bypassed (fail-open)",
        expect.objectContaining({
          errorId: "RATE_LIMIT_FAIL_OPEN_REQUEST",
          userId: "user-1",
          videoId: "dQw4w9WgXcQ",
        }),
      );
    });

    it("uses the anonymous rate-limit identity", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue(
        resolvedPrincipal("anon-user", true),
      );
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));
      await readEvents(response);

      expect(mocks.checkRateLimit).toHaveBeenCalledWith("anon-user", true);
    });

    it("returns the free-tier upgrade response when quota is exhausted", async () => {
      mocks.checkSummaryEntitlement.mockResolvedValue({
        tier: "free",
        allowed: false,
        remaining: 0,
        reason: "exceeded",
      });

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));
      const body = await response.json();

      expect(response.status).toBe(402);
      expect(body).toMatchObject({
        errorCode: "free_quota_exceeded",
        tier: "free",
        upgradeUrl: "/pricing",
      });
      expect(response.headers.get("X-Error-ID")).toBe("QUOTA_EXCEEDED");
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
    });

    it("propagates a trusted smoke Pro entitlement to the summary quota check", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue(
        resolvedPrincipal("smoke-u1", false, true),
      );
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));
      await readEvents(response);

      expect(mocks.checkSummaryEntitlement).toHaveBeenCalledWith({
        userId: "smoke-u1",
        isAnon: false,
        smokeProEntitled: true,
      });
    });

    it("returns the anonymous upgrade response and minted cookie", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue(
        resolvedPrincipal("anon-user", true),
      );
      mocks.checkSummaryEntitlement.mockResolvedValue({
        tier: "anon",
        allowed: false,
        remaining: 0,
        reason: "exceeded",
      });

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));
      const body = await response.json();
      const cookie = response.headers.get("Set-Cookie") ?? "";

      expect(response.status).toBe(402);
      expect(body).toMatchObject({
        errorCode: "anon_quota_exceeded",
        tier: "anon",
      });
      expect(cookie).toMatch(/^yt_anon_id=/);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Max-Age=31536000");
    });

    it("logs entitlement fail-open without changing the response policy", async () => {
      mocks.checkSummaryEntitlement.mockResolvedValue({
        tier: "free",
        allowed: true,
        remaining: 10,
        reason: "fail_open",
      });
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.status).toBe(200);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("entitlement bypassed"),
        expect.objectContaining({ errorId: "ENTITLEMENT_FAIL_OPEN_REQUEST" }),
      );
    });

    it("fails open as anonymous when the cookie cannot be signed", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue(
        resolvedPrincipal("anon-user", true),
      );
      mocks.signAnonId.mockReturnValue(null);
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.status).toBe(200);
      expect(mocks.checkSummaryEntitlement).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("anon entitlement bypassed"),
        expect.objectContaining({
          errorId: "ENTITLEMENT_ANON_FAIL_OPEN_NO_SECRET",
        }),
      );
    });

    it("sets the minted anonymous cookie on the streaming response", async () => {
      mocks.resolveRequestPrincipal.mockResolvedValue(
        resolvedPrincipal("anon-user", true),
      );
      mocks.checkSummaryEntitlement.mockResolvedValue({
        tier: "anon",
        allowed: true,
        remaining: 1,
        reason: "within_limit",
      });
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));

      expect(response.status).toBe(200);
      expect(response.headers.get("Set-Cookie")).toMatch(/^yt_anon_id=/);
    });
  });

  describe("Summary cache response policy", () => {
    it.each([
      ["generated", null],
      ["cached", cachedSummary()],
    ])(
      "nominates one eligible public Video after a %s Summary succeeds",
      async (_source, cached) => {
        mocks.getCachedSummary.mockResolvedValue(cached);

        const events = await readEvents(
          await POST(
            makeRequest(
              { youtube_url: VALID_URL, output_language: "es" },
              { requestId: "request-catalog-1" },
            ),
          ),
        );

        expect(events.at(-1)?.type).toBe("summary");
        expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledOnce();
        expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledWith({
          youtubeUrl: VALID_URL,
          requestId: "request-catalog-1",
          signal: expect.any(AbortSignal),
          isCancelled: expect.any(Function),
        });
        expect(mocks.runCatalogAdmissionWorker).toHaveBeenCalledOnce();
      },
    );

    it("does not spend worker capacity when the nomination was not newly enqueued", async () => {
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());
      mocks.nominateCatalogVideoForAdmission.mockResolvedValue({
        outcome: "already_enqueued",
      });

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.at(-1)?.type).toBe("summary");
      expect(mocks.runCatalogAdmissionWorker).not.toHaveBeenCalled();
    });

    it("does not add worker latency to a required-persistence Summary run", async () => {
      const response = await runServerSummaryRun(
        makeRequest({ youtube_url: VALID_URL }),
        {
          persistence: "required",
          principal: resolvedPrincipal("project-worker").principal,
        },
      );

      const events = await readEvents(response);

      expect(events.at(-1)?.type).toBe("summary");
      expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledOnce();
      expect(mocks.runCatalogAdmissionWorker).not.toHaveBeenCalled();
    });

    it("keeps an opportunistic worker failure out of the successful Summary stream", async () => {
      mocks.runCatalogAdmissionWorker.mockRejectedValue(
        new Error("worker unavailable"),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.filter((event) => event.type === "summary")).toHaveLength(1);
      expect(events.some((event) => event.type === "error")).toBe(false);
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          "[summarize/stream] Catalog Admission drain failed (fail-soft)",
          expect.objectContaining({
            errorId: "CATALOG_ADMISSION_DRAIN_FAILED",
            stage: "catalog_admission",
          }),
        );
      });
    });

    it("does not nominate when a cached Summary request is cancelled before completion", async () => {
      const controller = new AbortController();
      let resolveCached!: (summary: CachedSummary) => void;
      mocks.getCachedSummary.mockReturnValue(
        new Promise<CachedSummary>((resolve) => {
          resolveCached = resolve;
        }),
      );

      const response = await POST(
        makeRequest(
          { youtube_url: VALID_URL },
          { signal: controller.signal },
        ),
      );
      controller.abort();
      resolveCached(cachedSummary());

      await expect(readEvents(response)).resolves.toEqual([]);
      expect(mocks.nominateCatalogVideoForAdmission).not.toHaveBeenCalled();
    });

    it("does not nominate when the Summary response reader is cancelled", async () => {
      let resolveCached!: (summary: CachedSummary) => void;
      mocks.getCachedSummary.mockReturnValue(
        new Promise<CachedSummary>((resolve) => {
          resolveCached = resolve;
        }),
      );

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));
      const reader = response.body!.getReader();
      const cancelled = reader.cancel();
      resolveCached(cachedSummary());
      await cancelled;

      expect(mocks.nominateCatalogVideoForAdmission).not.toHaveBeenCalled();
    });

    it("does not run a deferred nomination after a generated Summary request is cancelled", async () => {
      const controller = new AbortController();
      let deferred!: () => unknown;
      mocks.after.mockImplementation((callback: () => unknown) => {
        deferred = callback;
      });

      const events = await readEvents(
        await POST(
          makeRequest(
            { youtube_url: VALID_URL },
            { signal: controller.signal },
          ),
        ),
      );
      expect(events.at(-1)?.type).toBe("summary");

      controller.abort();
      await Promise.resolve(deferred());

      expect(mocks.writeCachedSummary).toHaveBeenCalledOnce();
      expect(mocks.nominateCatalogVideoForAdmission).not.toHaveBeenCalled();
    });

    it("does not enqueue when the response reader is cancelled during provider verification", async () => {
      let resolveProvider!: () => void;
      const providerResponse = new Promise<void>((resolve) => {
        resolveProvider = resolve;
      });
      const durableEnqueue = vi.fn();
      mocks.nominateCatalogVideoForAdmission.mockImplementation(
        async (input: {
          signal?: AbortSignal;
          isCancelled?: () => boolean;
        }) => {
          await providerResponse;
          if (input.signal?.aborted || input.isCancelled?.()) {
            return { outcome: "skipped", reason: "cancelled" };
          }
          durableEnqueue();
          return { outcome: "enqueued" };
        },
      );

      const response = await POST(makeRequest({ youtube_url: VALID_URL }));
      const reader = response.body!.getReader();
      await vi.waitFor(() =>
        expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledOnce(),
      );

      const cancellation = reader.cancel();
      resolveProvider();
      await cancellation;
      await providerResponse;

      expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledWith({
        youtubeUrl: VALID_URL,
        requestId: expect.any(String),
        signal: expect.any(AbortSignal),
        isCancelled: expect.any(Function),
      });
      expect(durableEnqueue).not.toHaveBeenCalled();
    });

    it("still nominates a successful generated Summary when cache metadata is unavailable", async () => {
      mocks.acquireTranscript.mockResolvedValue(
        acquired({ title: undefined, channelName: undefined }),
      );

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.at(-1)?.type).toBe("summary");
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
      expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledOnce();
    });

    it("keeps a classified admission enqueue failure out of the successful Summary stream", async () => {
      mocks.nominateCatalogVideoForAdmission.mockRejectedValue(
        Object.assign(new Error("queue unavailable"), {
          errorId: "CATALOG_NOMINATION_ENQUEUE_FAILED",
        }),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.filter((event) => event.type === "summary")).toHaveLength(1);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        "[summarize/stream] Catalog Nomination failed (fail-soft)",
        expect.objectContaining({
          errorId: "CATALOG_NOMINATION_ENQUEUE_FAILED",
          stage: "catalog_nomination",
        }),
      );
    });

    it("serves a cached Summary without Transcript Acquisition when Transcript display is omitted", async () => {
      mocks.getCachedSummary.mockResolvedValue(
        cachedSummary({
          title: "Cached video",
          channelName: "Cached channel",
          summary: "Cached content",
        }),
      );

      const events = await readEvents(
        await POST(
          makeRequest({
            youtube_url: VALID_URL,
            include_transcript: false,
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual([
        "metadata",
        "content",
        "summary",
      ]);
      expect(events[0]).toMatchObject({
        cached: true,
        title: "Cached video",
      });
      expect(events.at(-1)).toMatchObject({
        total_time: 10,
        transcribe_time: 4,
        summarize_time: 6,
      });
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
      expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("combines a cached Summary with a reusable stored Transcript", async () => {
      mocks.getCachedSummary.mockResolvedValue(cachedSummary());
      mocks.acquireTranscript.mockResolvedValue(
        acquired({
          reusedStoredTranscript: true,
          acquisitionDurationSeconds: 0,
          transcriptSource: "whisper",
          title: "Stored title",
          channelName: "Stored channel",
        }),
      );

      const events = await readEvents(
        await POST(
          makeRequest({
            youtube_url: VALID_URL,
            include_transcript: true,
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual([
        "metadata",
        "content",
        "full_transcript",
        "summary",
      ]);
      expect(events[0]).toMatchObject({
        cached: true,
        title: "Stored title",
        channel: "Stored channel",
      });
      expect(events.at(-1)).toMatchObject({
        total_time: 6,
        transcribe_time: 0,
        summarize_time: 6,
      });
      expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    });

    it("streams the cached Summary after Transcript Acquisition repairs timed segments", async () => {
      mocks.getCachedSummary.mockResolvedValue(
        cachedSummary({ summary: "Cached verbatim" }),
      );
      mocks.acquireTranscript.mockImplementation(
        async (input: TranscriptAcquisitionInput) => {
          input.onProgress?.({ type: "caption_acquisition" });
          return acquired({ acquisitionDurationSeconds: 3 });
        },
      );

      const events = await readEvents(
        await POST(
          makeRequest({
            youtube_url: VALID_URL,
            include_transcript: true,
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual([
        "metadata",
        "status",
        "status",
        "full_transcript",
        "content",
        "summary",
      ]);
      expect(events[0]).toMatchObject({ cached: true });
      expect(events).toContainEqual({
        type: "content",
        text: "Cached verbatim",
      });
      expect(events.at(-1)).toMatchObject({
        total_time: 9,
        transcribe_time: 3,
        summarize_time: 6,
      });
      expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });
  });

  describe("Summary generation and SSE mapping", () => {
    it("uses one flat Transcript for routing, prompting, caching, and timing", async () => {
      const segments = [
        { text: "first segment", start: 0, duration: 5 },
        { text: "second segment", start: 5, duration: 5 },
      ] as const;
      mocks.acquireTranscript.mockResolvedValue(
        acquired({
          segments,
          acquisitionDurationSeconds: 2.5,
        }),
      );

      const events = await readEvents(
        await POST(
          makeRequest({
            youtube_url: VALID_URL,
            include_transcript: true,
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual([
        "metadata",
        "status",
        "full_transcript",
        "content",
        "summary",
      ]);
      expect(events).toContainEqual({
        type: "full_transcript",
        segments,
        source: "auto_captions",
      });
      expect(mocks.buildSummarizationPrompt).toHaveBeenCalledWith(
        "first segment second segment",
        SPARK_CHAR_BUDGET,
        undefined,
      );
      expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          transcript: "first segment second segment",
          summary: "Generated summary",
          transcribeTimeSeconds: 2.5,
          summarizeTimeSeconds: 1.5,
          model: HAIKU,
        }),
      );
      expect(events.filter((event) => event.type === "summary")).toEqual([
        expect.objectContaining({
          total_time: 4,
          transcribe_time: 2.5,
          summarize_time: 1.5,
        }),
      ]);
    });

    it("routes a high-density middle-sized Transcript to Sonnet", async () => {
      const transcript = "word ".repeat(40_000).trim();
      mocks.acquireTranscript.mockResolvedValue(
        acquired({
          segments: [{ text: transcript, start: 0, duration: 1_000 }],
        }),
      );
      mocks.classifyContent.mockResolvedValue({
        density: "high",
        type: "lecture",
        structure: "structured",
      });

      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      expect(mocks.classifyContent).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptExcerpt: transcript.slice(0, 4_000),
          title: "Live title",
          language: "en",
        }),
      );
      expect(mocks.buildSummarizationPrompt).toHaveBeenCalledWith(
        transcript,
        SPARK_CHAR_BUDGET,
        undefined,
      );
      expect(mocks.streamLlmSummary).toHaveBeenCalledWith(
        expect.objectContaining({ model: SONNET }),
      );
      expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
        expect.objectContaining({ model: SONNET }),
      );
    });

    it("forces very long Transcripts to Sonnet without classifying", async () => {
      const transcript = "word ".repeat(120_000).trim();
      mocks.acquireTranscript.mockResolvedValue(
        acquired({
          segments: [{ text: transcript, start: 0, duration: 2_000 }],
        }),
      );

      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      expect(mocks.classifyContent).not.toHaveBeenCalled();
      expect(mocks.buildSummarizationPrompt).toHaveBeenCalledWith(
        transcript,
        SPARK_CHAR_BUDGET,
        undefined,
      );
      expect(mocks.streamLlmSummary).toHaveBeenCalledWith(
        expect.objectContaining({ model: SONNET }),
      );
    });

    it("logs the route-owned routing decision", async () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      expect(infoSpy).toHaveBeenCalledWith(
        "[summarize/stream] routing_decision",
        expect.objectContaining({
          event: "routing_decision",
          model: HAIKU,
          reason: "very_short",
          classifierRan: false,
          dimensions: null,
        }),
      );
    });

    it("threads output_language through Summary read, prompt, and write", async () => {
      await readEvents(
        await POST(
          makeRequest({ youtube_url: VALID_URL, output_language: "es" }),
        ),
      );

      expect(mocks.getCachedSummary).toHaveBeenCalledWith(VALID_URL, "es");
      expect(mocks.buildSummarizationPrompt).toHaveBeenCalledWith(
        "captioned transcript",
        SPARK_CHAR_BUDGET,
        "es",
      );
      expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
        expect.objectContaining({ outputLanguage: "es" }),
      );
    });

    it("uses the language-specific cached Summary without generating", async () => {
      mocks.getCachedSummary.mockResolvedValue(
        cachedSummary({
          outputLanguage: "es",
          summary: "Resumen en espanol",
        }),
      );

      const events = await readEvents(
        await POST(
          makeRequest({ youtube_url: VALID_URL, output_language: "es" }),
        ),
      );

      expect(mocks.getCachedSummary).toHaveBeenCalledWith(VALID_URL, "es");
      expect(events).toContainEqual({
        type: "content",
        text: "Resumen en espanol",
      });
      expect(mocks.acquireTranscript).not.toHaveBeenCalled();
      expect(mocks.streamLlmSummary).not.toHaveBeenCalled();
    });

    it("uses null as the native-language Summary cache key", async () => {
      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      expect(mocks.getCachedSummary).toHaveBeenCalledWith(VALID_URL, null);
      expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
        expect.objectContaining({ outputLanguage: null }),
      );
    });
  });

  describe("generation and persistence failures", () => {
    it("emits an error and skips caching when the LLM returns no content", async () => {
      mocks.streamLlmSummary.mockImplementation(() =>
        fakeGen([{ type: "timing", summarizeSeconds: 1 }]),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events).toContainEqual({
        type: "error",
        message: "The model returned no summary. Please try again.",
      });
      expect(events.some((event) => event.type === "summary")).toBe(false);
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        "[summarize/stream] llm failed",
        expect.objectContaining({ stage: "llm" }),
      );
    });

    it("emits a generic error and skips caching when the LLM throws", async () => {
      mocks.streamLlmSummary.mockImplementation(async function* () {
        throw new Error("gateway failed");
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events).toContainEqual({
        type: "error",
        message: "Something went wrong generating the summary. Please try again.",
      });
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("keeps caller cancellation during LLM streaming silent", async () => {
      const controller = new AbortController();
      mocks.streamLlmSummary.mockImplementation(async function* () {
        yield { type: "content", text: "partial" };
        controller.abort();
        throw new Error("caller left");
      });

      const events = await readEvents(
        await POST(
          makeRequest(
            { youtube_url: VALID_URL },
            { signal: controller.signal },
          ),
        ),
      );

      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events.some((event) => event.type === "summary")).toBe(false);
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
    });

    it("uses elapsed wall time when the LLM omits its timing event", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      mocks.streamLlmSummary.mockImplementation(async function* () {
        yield { type: "content", text: "Generated without timing" };
        vi.setSystemTime(4_500);
      });

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.at(-1)).toMatchObject({
        type: "summary",
        summarize_time: 3.5,
        transcribe_time: 2,
        total_time: 5.5,
      });
      expect(mocks.writeCachedSummary).toHaveBeenCalledWith(
        expect.objectContaining({ summarizeTimeSeconds: 3.5 }),
      );
    });

    it("emits the Summary but skips cache writes with incomplete metadata", async () => {
      mocks.acquireTranscript.mockResolvedValue(
        acquired({ channelName: undefined }),
      );
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.at(-1)?.type).toBe("summary");
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "[summarize/stream] CACHE_SKIP_EMPTY_HEADER",
        expect.objectContaining({
          errorId: "CACHE_SKIP_EMPTY_HEADER",
          hasTitle: true,
          hasChannel: false,
        }),
      );
    });

    it("raises incomplete-metadata logging to error in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      mocks.acquireTranscript.mockResolvedValue(
        acquired({ title: "Live title", channelName: undefined }),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      expect(errorSpy).toHaveBeenCalledWith(
        "[summarize/stream] CACHE_SKIP_EMPTY_HEADER",
        expect.objectContaining({ errorId: "CACHE_SKIP_EMPTY_HEADER" }),
      );
      expect(
        warnSpy.mock.calls.some((call) =>
          String(call[0]).includes("CACHE_SKIP_EMPTY_HEADER"),
        ),
      ).toBe(false);
    });

    it("keeps cache-write failures out of the user-visible stream", async () => {
      mocks.writeCachedSummary.mockRejectedValue(new Error("cache down"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );
      await vi.waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          "[summarize/stream] CACHE_WRITE_FAILED",
          expect.objectContaining({
            errorId: "CACHE_WRITE_FAILED",
            stage: "cache",
            outputLanguage: null,
          }),
        );
      });

      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events.filter((event) => event.type === "summary")).toHaveLength(1);
    });

    it("schedules the Summary cache write through next/server after", async () => {
      const captured: Array<() => unknown> = [];
      mocks.after.mockImplementation((fn: () => unknown) => {
        captured.push(fn);
      });

      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      expect(mocks.after).toHaveBeenCalledTimes(1);
      expect(captured).toHaveLength(1);
      expect(mocks.writeCachedSummary).not.toHaveBeenCalled();
      expect(mocks.nominateCatalogVideoForAdmission).not.toHaveBeenCalled();
      expect(mocks.runCatalogAdmissionWorker).not.toHaveBeenCalled();

      await captured[0]();
      expect(mocks.writeCachedSummary).toHaveBeenCalledTimes(1);
      expect(mocks.nominateCatalogVideoForAdmission).toHaveBeenCalledTimes(1);
      expect(mocks.runCatalogAdmissionWorker).toHaveBeenCalledTimes(1);
    });

    it("contains cache-write rejection inside the deferred callback", async () => {
      const captured: Array<() => unknown> = [];
      mocks.after.mockImplementation((fn: () => unknown) => {
        captured.push(fn);
      });
      mocks.writeCachedSummary.mockRejectedValue(
        Object.assign(new Error("upsert failed"), { code: "23505" }),
      );
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await readEvents(await POST(makeRequest({ youtube_url: VALID_URL })));

      await expect(captured[0]()).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        "[summarize/stream] CACHE_WRITE_FAILED",
        expect.objectContaining({
          errorId: "CACHE_WRITE_FAILED",
          pgCode: "23505",
        }),
      );
    });

    it("does not append a user error when scheduling the cache write throws", async () => {
      mocks.after.mockImplementation(() => {
        throw new Error("after unavailable");
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(makeRequest({ youtube_url: VALID_URL })),
      );

      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(events.filter((event) => event.type === "summary")).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "[summarize/stream] CACHE_WRITE_SCHEDULE_FAILED",
        expect.objectContaining({
          errorId: "CACHE_WRITE_SCHEDULE_FAILED",
          stage: "cache",
        }),
      );
    });

    it("maps unexpected route defects to the generic SSE error", async () => {
      mocks.getCachedSummary.mockRejectedValue(new Error("cache read failed"));
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
  });
});
