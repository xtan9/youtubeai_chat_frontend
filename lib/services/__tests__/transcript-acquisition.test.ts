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

  it("returns a known caption failure and never starts paid audio transcription", async () => {
    mocks.extractCaptions.mockRejectedValue(
      new CaptionExtractionError(503, "caption service down")
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await acquireTranscript(INPUT);

    expect(result).toMatchObject({
      outcome: "acquisition_failed",
      failure: {
        stage: "captions",
        errorId: "VPS_CAPTIONS_FAILED_HTTP_503",
      },
    });
    expect(mocks.transcribeViaVps).not.toHaveBeenCalled();
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
    mocks.extractCaptions.mockResolvedValue(captionsResult());

    const result = await acquireTranscript({
      ...INPUT,
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event);
        if (event.type === "caption_acquisition") controller.abort();
      },
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
