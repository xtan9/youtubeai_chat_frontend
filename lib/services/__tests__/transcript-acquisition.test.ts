import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedTranscript } from "../summarize-cache";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getCachedTranscript: vi.fn(),
    writeCachedTranscript: vi.fn(),
    fetchVpsMetadata: vi.fn(),
    fetchVideoMetadata: vi.fn(),
    extractCaptions: vi.fn(),
    transcribeViaVps: vi.fn(),
    detectLocale: vi.fn(),
  },
}));

vi.mock("../summarize-cache", () => ({
  getCachedTranscript: mocks.getCachedTranscript,
  writeCachedTranscript: mocks.writeCachedTranscript,
}));

vi.mock("../vps-metadata", async () => {
  const actual = await vi.importActual<typeof import("../vps-metadata")>(
    "../vps-metadata"
  );
  return {
    fetchVpsMetadata: mocks.fetchVpsMetadata,
    primarySubtag: actual.primarySubtag,
  };
});

vi.mock("../video-metadata", () => ({
  fetchVideoMetadata: mocks.fetchVideoMetadata,
}));

vi.mock("../caption-extractor", async () => {
  const actual = await vi.importActual<typeof import("../caption-extractor")>(
    "../caption-extractor"
  );
  return {
    extractCaptions: mocks.extractCaptions,
    CaptionExtractionError: actual.CaptionExtractionError,
    captionErrorId: actual.captionErrorId,
  };
});

vi.mock("../vps-client", async () => {
  const actual = await vi.importActual<typeof import("../vps-client")>(
    "../vps-client"
  );
  return {
    transcribeViaVps: mocks.transcribeViaVps,
    VpsTranscribeError: actual.VpsTranscribeError,
    vpsErrorId: actual.vpsErrorId,
  };
});

vi.mock("../language-detect", () => ({
  detectLocale: mocks.detectLocale,
}));

import {
  acquireTranscript,
  type TranscriptAcquisitionProgress,
} from "../transcript-acquisition";
import { CaptionExtractionError } from "../caption-extractor";

const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const SEGMENTS = [
  { text: "first line", start: 0, duration: 1.5 },
  { text: "second line", start: 1.5, duration: 2 },
] as const;

const INPUT = {
  youtubeUrl: VIDEO_URL,
  signal: new AbortController().signal,
  requestId: "request-207",
};

function cachedTranscript(
  overrides: Partial<CachedTranscript> = {}
): CachedTranscript {
  return {
    videoId: "video-1",
    title: "Stored title",
    channelName: "Stored channel",
    segments: SEGMENTS,
    transcriptSource: "auto_captions",
    language: "en",
    ...overrides,
  };
}

function captionsResult(overrides: Record<string, unknown> = {}) {
  return {
    segments: SEGMENTS,
    source: "auto_captions" as const,
    language: "en" as const,
    title: "Caption title",
    channelName: "Caption channel",
    ...overrides,
  };
}

describe("acquireTranscript", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getCachedTranscript.mockResolvedValue(null);
    mocks.writeCachedTranscript.mockResolvedValue(undefined);
    mocks.fetchVpsMetadata.mockResolvedValue({ ok: false, reason: "config" });
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: true,
      data: { title: "Recovered title", channelName: "Recovered channel" },
    });
    mocks.extractCaptions.mockResolvedValue(captionsResult());
    mocks.transcribeViaVps.mockResolvedValue({
      segments: SEGMENTS,
      language: "auto",
      source: "whisper",
    });
    mocks.detectLocale.mockReturnValue("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns caller_aborted before starting cache lookup", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.getCachedTranscript).not.toHaveBeenCalled();
    expect(mocks.fetchVpsMetadata).not.toHaveBeenCalled();
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("returns caller_aborted while cache lookup is still pending", async () => {
    const controller = new AbortController();
    const timedOut = Symbol("cache wait timed out");
    let resolveCache!: (value: null) => void;
    mocks.getCachedTranscript.mockReturnValue(
      new Promise((resolve) => {
        resolveCache = resolve;
      })
    );

    const resultPromise = acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.getCachedTranscript).toHaveBeenCalled());
    controller.abort();

    const result = await Promise.race([
      resultPromise,
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), 50)
      ),
    ]);

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.fetchVpsMetadata).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();

    resolveCache(null);
    await resultPromise;
  });

  it("reuses a valid stored Transcript through the seam without provider work", async () => {
    mocks.getCachedTranscript.mockResolvedValue(
      cachedTranscript({
        transcriptSource: "whisper",
        language: "zh",
      })
    );
    const progress: TranscriptAcquisitionProgress[] = [];

    const result = await acquireTranscript({
      ...INPUT,
      onProgress: (event) => progress.push(event),
    });

    expect(result).toEqual({
      outcome: "success",
      segments: SEGMENTS,
      transcriptSource: "whisper",
      promptLocale: "zh",
      title: "Stored title",
      channelName: "Stored channel",
      reusedStoredTranscript: true,
      acquisitionDurationSeconds: 0,
    });
    expect(progress).toEqual([{ type: "stored_reuse" }]);
    expect(mocks.fetchVpsMetadata).not.toHaveBeenCalled();
    expect(mocks.fetchVideoMetadata).not.toHaveBeenCalled();
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("stops stored reuse after its progress event is cancelled", async () => {
    const controller = new AbortController();
    const progress: TranscriptAcquisitionProgress[] = [];
    mocks.getCachedTranscript.mockResolvedValue(cachedTranscript());

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event);
        controller.abort();
      },
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(progress).toEqual([{ type: "stored_reuse" }]);
    expect(mocks.fetchVideoMetadata).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("returns caller_aborted while language detection is still pending", async () => {
    const controller = new AbortController();
    const timedOut = Symbol("language detection wait timed out");
    let resolveMetadata!: (result: {
      ok: false;
      reason: "aborted";
    }) => void;
    mocks.getCachedTranscript.mockResolvedValue(null);
    mocks.fetchVpsMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve;
      })
    );

    const resultPromise = acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.fetchVpsMetadata).toHaveBeenCalled());
    controller.abort();

    const result = await Promise.race([
      resultPromise,
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), 50)
      ),
    ]);

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();

    resolveMetadata({ ok: false, reason: "aborted" });
    await resultPromise;
  });

  it("heals missing metadata independently and persists only non-blank recovered fields", async () => {
    mocks.getCachedTranscript.mockResolvedValue(
      cachedTranscript({ title: "", channelName: "Known channel" })
    );
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: true,
      data: { title: "Recovered title", channelName: "" },
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      title: "Recovered title",
      channelName: "Known channel",
      reusedStoredTranscript: true,
      acquisitionDurationSeconds: 0,
    });
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        youtubeUrl: VIDEO_URL,
        segments: SEGMENTS,
        transcriptSource: "auto_captions",
        language: "en",
        title: "Recovered title",
        channelName: "Known channel",
      })
    );
    expect(mocks.writeCachedTranscript.mock.calls[0][0]).not.toHaveProperty(
      "channelName",
      ""
    );
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
  });

  it("keeps a usable stored Transcript when metadata recovery fails", async () => {
    mocks.getCachedTranscript.mockResolvedValue(
      cachedTranscript({ title: "", channelName: "Known channel" })
    );
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: false,
      reason: "timeout",
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      channelName: "Known channel",
      reusedStoredTranscript: true,
      acquisitionDurationSeconds: 0,
    });
    expect(result).not.toHaveProperty("title");
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
  });

  it("keeps a usable stored Transcript when metadata persistence fails", async () => {
    mocks.getCachedTranscript.mockResolvedValue(
      cachedTranscript({ title: "", channelName: "Known channel" })
    );
    mocks.writeCachedTranscript.mockRejectedValue(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      title: "Recovered title",
      channelName: "Known channel",
      reusedStoredTranscript: true,
      acquisitionDurationSeconds: 0,
    });
  });

  it("treats a cache read failure as a miss and acquires through captions", async () => {
    mocks.getCachedTranscript.mockResolvedValue(null);
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr-FR",
        title: "VPS title",
        description: "",
        availableCaptions: ["fr-FR", "en"],
      },
    });
    mocks.extractCaptions.mockResolvedValue(
      captionsResult({ language: "en", title: "", channelName: "" })
    );

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "auto_captions",
      promptLocale: "en",
      detectedLanguage: "fr",
      title: "Recovered title",
      channelName: "Recovered channel",
      reusedStoredTranscript: false,
    });
    expect(mocks.extractCaptions).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "fr",
      "request-207"
    );
    expect(mocks.fetchVideoMetadata).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal
    );
  });

  it("recovers caption metadata independently without replacing known fields", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en",
        title: "VPS title",
        description: "",
        availableCaptions: ["en"],
      },
    });
    mocks.extractCaptions.mockResolvedValue(
      captionsResult({ title: "Caption title", channelName: "" })
    );
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: true,
      data: { title: "", channelName: "Recovered channel" },
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      title: "Caption title",
      channelName: "Recovered channel",
    });
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Caption title",
        channelName: "Recovered channel",
      })
    );
  });

  it("measures fresh acquisition from operation start through cache lookup", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_500)
      .mockReturnValueOnce(2_500);
    mocks.getCachedTranscript.mockImplementation(async () => {
      Date.now();
      return null;
    });
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en",
        title: "VPS title",
        description: "",
        availableCaptions: ["en"],
      },
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      acquisitionDurationSeconds: 1.5,
    });
  });

  it("uses the normalized detected language for captions and emits semantic progress", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "FR-fr",
        title: "VPS title",
        description: "",
        availableCaptions: ["fr-FR"],
      },
    });
    const progress: TranscriptAcquisitionProgress[] = [];

    const result = await acquireTranscript({
      ...INPUT,
      onProgress: (event) => progress.push(event),
    });

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "auto_captions",
      detectedLanguage: "fr",
    });
    expect(mocks.extractCaptions).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "fr",
      "request-207"
    );
    expect(progress).toEqual([
      { type: "language_detection", detectedLanguage: "fr" },
      { type: "caption_acquisition" },
    ]);
    expect(progress.every((event) => !("message" in event))).toBe(true);
  });

  it("stops before caption acquisition when language progress is cancelled", async () => {
    const controller = new AbortController();
    const progress: TranscriptAcquisitionProgress[] = [];

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr-FR",
        title: "VPS title",
        description: "",
        availableCaptions: ["fr-FR", "en"],
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event);
        if (event.type === "language_detection") controller.abort();
      },
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(progress).toEqual([
      { type: "language_detection", detectedLanguage: "fr" },
    ]);
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("stops before the caption provider when caption progress is cancelled", async () => {
    const controller = new AbortController();
    const progress: TranscriptAcquisitionProgress[] = [];

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en",
        title: "VPS title",
        description: "",
        availableCaptions: ["en"],
      },
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event);
        if (event.type === "caption_acquisition") controller.abort();
      },
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(progress).toEqual([
      { type: "language_detection", detectedLanguage: "en" },
      { type: "caption_acquisition" },
    ]);
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("logs generic language metadata degradation and acquires captions without a hint", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: false,
      reason: "error",
      error: new Error("metadata upstream unavailable"),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "auto_captions",
    });
    expect(mocks.extractCaptions).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      undefined,
      "request-207"
    );
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[transcript-acquisition] language detection degraded",
      expect.objectContaining({
        errorId: "TRANSCRIPT_LANGUAGE_DETECTION_DEGRADED",
        reason: "error",
        errorName: "Error",
      })
    );
  });

  it("records a missing metadata endpoint as a warning and still acquires captions without a hint", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: false,
      reason: "non_ok",
      status: 404,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "auto_captions",
    });
    expect(mocks.extractCaptions).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      undefined,
      "request-207"
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      "[transcript-acquisition] language detection degraded",
      expect.anything()
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[transcript-acquisition] metadata endpoint unavailable",
      expect.objectContaining({ errorId: "VPS_METADATA_404", status: 404 })
    );
  });

  it("honors an explicit metadata cancellation outcome without logging or starting acquisition", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: false,
      reason: "aborted",
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.extractCaptions).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("uses an advertised English caption track before audio transcription", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "",
        description: "",
        availableCaptions: ["fr", "en"],
      },
    });
    mocks.extractCaptions
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(captionsResult({ title: "", channelName: "" }));

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      detectedLanguage: "fr",
      reusedStoredTranscript: false,
    });
    expect(mocks.extractCaptions).toHaveBeenNthCalledWith(
      2,
      VIDEO_URL,
      INPUT.signal,
      "en",
      "request-207"
    );
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
  });

  it("preserves the English caption source and timed segments before reporting success", async () => {
    const events: string[] = [];
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(10_000)
      .mockReturnValueOnce(12_500);
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr-FR",
        title: "",
        description: "",
        availableCaptions: ["fr-FR", "en-US"],
      },
    });
    const englishSegments = [
      { text: "English one", start: 0.25, duration: 1.75 },
      { text: "English two", start: 2, duration: 2.5 },
    ] as const;
    mocks.extractCaptions.mockImplementation(
      async (
        _youtubeUrl: string,
        _signal: AbortSignal,
        language?: string
      ) => {
        events.push(`captions:${language}`);
        return language === "en"
          ? captionsResult({
              segments: englishSegments,
              language: "en",
              title: "English title",
              channelName: "English channel",
            })
          : null;
      }
    );
    mocks.writeCachedTranscript.mockImplementation(async (params) => {
      events.push("persist");
      expect(params).toMatchObject({
        segments: englishSegments,
        transcriptSource: "auto_captions",
        language: "en",
      });
    });

    const result = await acquireTranscript(INPUT);

    expect(events).toEqual(["captions:fr", "captions:en", "persist"]);
    expect(result).toMatchObject({
      outcome: "success",
      segments: englishSegments,
      transcriptSource: "auto_captions",
      promptLocale: "en",
      detectedLanguage: "fr",
      acquisitionDurationSeconds: 2.5,
    });
  });

  it("does not retry English when English was already the detected-language attempt", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en-US",
        title: "",
        description: "",
        availableCaptions: ["en-US"],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.transcribeViaVps.mockResolvedValue({
      segments: SEGMENTS,
      language: "en",
      source: "whisper",
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "whisper",
      detectedLanguage: "en",
    });
    expect(mocks.extractCaptions).toHaveBeenCalledTimes(1);
    expect(mocks.extractCaptions).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "en",
      "request-207"
    );
    expect(mocks.transcribeViaVps).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "en",
      "request-207"
    );
  });

  it("falls back to audio transcription only after a genuine caption miss", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: true,
      data: { title: "Audio title", channelName: "Audio channel" },
    });
    mocks.transcribeViaVps.mockResolvedValue({
      segments: SEGMENTS,
      language: "fr",
      source: "whisper",
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "whisper",
      detectedLanguage: "fr",
      title: "Audio title",
      channelName: "Audio channel",
      reusedStoredTranscript: false,
    });
    expect(mocks.transcribeViaVps).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "fr",
      "request-207"
    );
  });

  it("recovers audio metadata independently and omits blank facts", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "VPS title",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: true,
      data: { title: "Recovered title", channelName: "" },
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      title: "Recovered title",
    });
    expect(result).not.toHaveProperty("channelName");
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Recovered title" })
    );
    expect(mocks.writeCachedTranscript.mock.calls[0][0]).not.toHaveProperty(
      "channelName"
    );
  });

  it("stops before audio transcription when the audio progress boundary is cancelled", async () => {
    const controller = new AbortController();
    const progress: TranscriptAcquisitionProgress[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "VPS title",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event);
        if (event.type === "audio_transcription") controller.abort();
      },
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(progress).toEqual([
      { type: "language_detection", detectedLanguage: "fr" },
      { type: "caption_acquisition" },
      { type: "audio_transcription" },
    ]);
    expect(mocks.fetchVideoMetadata).not.toHaveBeenCalled();
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("persists settled audio metadata when transcription crosses the abort boundary", async () => {
    const controller = new AbortController();

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "VPS title",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.fetchVideoMetadata.mockResolvedValue({
      ok: true,
      data: { title: "Audio title", channelName: "Audio channel" },
    });
    mocks.transcribeViaVps.mockImplementation(async () => {
      await Promise.resolve();
      controller.abort();
      return { segments: SEGMENTS, language: "fr", source: "whisper" };
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: SEGMENTS,
        transcriptSource: "whisper",
        title: "Audio title",
        channelName: "Audio channel",
      })
    );
  });

  it("does not wait for pending audio metadata after segments cross the abort boundary", async () => {
    const controller = new AbortController();
    const timedOut = Symbol("metadata wait timed out");
    let resolveMetadata!: (result: {
      ok: false;
      reason: "aborted";
    }) => void;

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "VPS title",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.fetchVideoMetadata.mockReturnValue(
      new Promise((resolve) => {
        resolveMetadata = resolve;
      })
    );
    mocks.transcribeViaVps.mockResolvedValue({
      segments: SEGMENTS,
      language: "fr",
      source: "whisper",
    });

    const resultPromise = acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(mocks.fetchVideoMetadata).toHaveBeenCalled());
    controller.abort();

    const result = await Promise.race([
      resultPromise,
      new Promise<typeof timedOut>((resolve) =>
        setTimeout(() => resolve(timedOut), 50)
      ),
    ]);

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: SEGMENTS,
        transcriptSource: "whisper",
      })
    );

    resolveMetadata({ ok: false, reason: "aborted" });
    await resultPromise;
  });

  it("does not persist when audio transcription aborts before returning segments", async () => {
    const controller = new AbortController();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "VPS title",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.transcribeViaVps.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("audio acquisition aborted", "AbortError");
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("persists after metadata recovery aborts once caption segments exist", async () => {
    const controller = new AbortController();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en",
        title: "VPS title",
        description: "",
        availableCaptions: ["en"],
      },
    });
    mocks.extractCaptions.mockResolvedValue(
      captionsResult({ title: "", channelName: "" })
    );
    mocks.fetchVideoMetadata.mockImplementation(async () => {
      controller.abort();
      return { ok: false, reason: "aborted" };
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: SEGMENTS,
        transcriptSource: "auto_captions",
      })
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns caller_aborted after the non-cancellable persistence finishes", async () => {
    const controller = new AbortController();
    const progress: TranscriptAcquisitionProgress[] = [];

    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en",
        title: "VPS title",
        description: "",
        availableCaptions: ["en"],
      },
    });
    mocks.extractCaptions.mockResolvedValue(captionsResult());
    mocks.writeCachedTranscript.mockImplementation(async () => {
      controller.abort();
      await Promise.resolve();
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => progress.push(event),
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(progress).toEqual([
      { type: "language_detection", detectedLanguage: "en" },
      { type: "caption_acquisition" },
    ]);
    expect(mocks.writeCachedTranscript).toHaveBeenCalledTimes(1);
  });

  it("waits for an advertised English caption miss before starting pinned audio transcription", async () => {
    const events: string[] = [];
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(20_000)
      .mockReturnValueOnce(23_750);
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr-FR",
        title: "",
        description: "",
        availableCaptions: ["fr-FR", "en-US"],
      },
    });
    mocks.extractCaptions.mockImplementation(
      async (
        _youtubeUrl: string,
        _signal: AbortSignal,
        language?: string
      ) => {
        events.push(`captions:${language}`);
        return null;
      }
    );
    mocks.transcribeViaVps.mockImplementation(
      async (
        _youtubeUrl: string,
        _signal: AbortSignal,
        language?: string
      ) => {
        events.push(`audio:${language}`);
        return {
          segments: SEGMENTS,
          language: "fr",
          source: "whisper" as const,
        };
      }
    );
    mocks.writeCachedTranscript.mockImplementation(async () => {
      events.push("persist");
    });

    const result = await acquireTranscript(INPUT);

    expect(events).toEqual(["captions:fr", "captions:en", "audio:fr", "persist"]);
    expect(result).toMatchObject({
      outcome: "success",
      segments: SEGMENTS,
      transcriptSource: "whisper",
      detectedLanguage: "fr",
      acquisitionDurationSeconds: 3.75,
    });
    expect(mocks.transcribeViaVps).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "fr",
      "request-207"
    );
  });

  it("pins audio transcription to the normalized detected language", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "zh-Hans",
        title: "",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    mocks.transcribeViaVps.mockResolvedValue({
      segments: SEGMENTS,
      language: "zh",
      source: "whisper",
    });

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      transcriptSource: "whisper",
      promptLocale: "zh",
      detectedLanguage: "zh",
    });
    expect(mocks.transcribeViaVps).toHaveBeenCalledWith(
      VIDEO_URL,
      INPUT.signal,
      "zh",
      "request-207"
    );
    expect(mocks.detectLocale).not.toHaveBeenCalled();
  });

  it("returns a known caption failure and never starts paid audio transcription", async () => {
    mocks.extractCaptions.mockRejectedValue(
      new CaptionExtractionError(503, "caption service down")
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "acquisition_failed",
      failure: {
        stage: "captions",
        errorId: "VPS_CAPTIONS_FAILED_HTTP_503",
        requestId: "request-207",
      },
    });
    expect(
      errorSpy.mock.calls.filter(
        (call) => call[0] === "[transcript-acquisition] acquisition failed"
      )
    ).toHaveLength(1);
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("throws unexpected caption errors instead of converting them to outcomes", async () => {
    const unexpectedError = new Error("caption invariant failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.extractCaptions.mockRejectedValue(unexpectedError);

    await expect(acquireTranscript(INPUT)).rejects.toBe(unexpectedError);

    expect(errorSpy).not.toHaveBeenCalledWith(
      "[transcript-acquisition] acquisition failed",
      expect.anything()
    );
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("throws when a caption collaborator violates the usable-segments invariant", async () => {
    mocks.extractCaptions.mockResolvedValue(
      captionsResult({ segments: [], title: "", channelName: "" })
    );

    await expect(acquireTranscript(INPUT)).rejects.toThrow(
      "Transcript Acquisition received no usable segments"
    );

    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("stops on an unexpected English fallback failure without starting audio transcription", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "",
        description: "",
        availableCaptions: ["fr", "en"],
      },
    });
    mocks.extractCaptions
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(
        new CaptionExtractionError("timeout", "English caption timeout")
      );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "acquisition_failed",
      failure: {
        stage: "captions",
        status: "timeout",
        errorId: "VPS_CAPTIONS_FAILED_TIMEOUT",
      },
    });
    expect(mocks.extractCaptions).toHaveBeenCalledTimes(2);
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[transcript-acquisition] acquisition failed",
      expect.objectContaining({
        errorId: "VPS_CAPTIONS_FAILED_TIMEOUT",
        stage: "captions",
      })
    );
  });

  it("returns the usable newly acquired Transcript when persistence fails", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "en",
        title: "",
        description: "",
        availableCaptions: ["en"],
      },
    });
    mocks.extractCaptions.mockResolvedValue(
      captionsResult({ segments: SEGMENTS, title: "", channelName: "" })
    );
    mocks.writeCachedTranscript.mockRejectedValue(new Error("database down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "success",
      segments: SEGMENTS,
      transcriptSource: "auto_captions",
      promptLocale: "en",
      reusedStoredTranscript: false,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[transcript-acquisition] Transcript persistence failed",
      expect.objectContaining({
        errorId: "TRANSCRIPT_PERSISTENCE_FAILED",
        source: "auto_captions",
      })
    );
  });

  it("throws unexpected transcription errors instead of converting them to outcomes", async () => {
    mocks.fetchVpsMetadata.mockResolvedValue({
      ok: true,
      data: {
        language: "fr",
        title: "VPS title",
        description: "",
        availableCaptions: [],
      },
    });
    mocks.extractCaptions.mockResolvedValue(null);
    const unexpectedError = new Error("transcription invariant failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transcribeViaVps.mockRejectedValue(unexpectedError);

    await expect(acquireTranscript(INPUT)).rejects.toBe(unexpectedError);

    expect(errorSpy).not.toHaveBeenCalledWith(
      "[transcript-acquisition] acquisition failed",
      expect.anything()
    );
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("treats Video Unavailable as terminal and never starts audio transcription", async () => {
    mocks.extractCaptions.mockRejectedValue(
      new CaptionExtractionError(
        422,
        JSON.stringify({
          error: "Video unavailable",
          errorId: "VIDEO_UNAVAILABLE",
          requestId: "request-212",
        })
      )
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "acquisition_failed",
      failure: {
        stage: "captions",
        status: 422,
        errorId: "VPS_CAPTIONS_FAILED_HTTP_422",
      },
    });
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", "network", "VPS_CAPTIONS_FAILED_NETWORK"],
    ["timeout", "timeout", "VPS_CAPTIONS_FAILED_TIMEOUT"],
    ["malformed response", "schema", "VPS_CAPTIONS_FAILED_SCHEMA"],
  ] as const)(
    "treats a caption %s as terminal and never starts audio transcription",
    async (_label, status, errorId) => {
      mocks.extractCaptions.mockRejectedValue(
        new CaptionExtractionError(status, "caption acquisition failed")
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await acquireTranscript(INPUT);

      expect(result).toMatchObject({
        outcome: "acquisition_failed",
        failure: {
          stage: "captions",
          status,
          errorId,
        },
      });
      expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
      expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
    }
  );

  it("keeps caption cancellation terminal and never starts audio transcription", async () => {
    const controller = new AbortController();
    mocks.extractCaptions.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("caption acquisition aborted", "AbortError");
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
    expect(mocks.writeCachedTranscript).not.toHaveBeenCalled();
  });

  it("persists usable segments after caller cancellation and returns caller_aborted", async () => {
    const controller = new AbortController();
    const progress: TranscriptAcquisitionProgress[] = [];
    mocks.extractCaptions.mockImplementation(async () => {
      controller.abort();
      return captionsResult();
    });

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => progress.push(event),
    });

    expect(result).toEqual({ outcome: "caller_aborted" });
    expect(progress).toEqual([{ type: "caption_acquisition" }]);
    expect(mocks.writeCachedTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: SEGMENTS,
        transcriptSource: "auto_captions",
      })
    );
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
  });
});
