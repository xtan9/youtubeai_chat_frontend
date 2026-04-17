import { afterEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchTranscript: vi.fn(),
}));

vi.mock("youtube-transcript-plus", async (orig) => {
  const real = await orig<typeof import("youtube-transcript-plus")>();
  return {
    ...real,
    fetchTranscript: mocks.fetchTranscript,
  };
});

import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptInvalidVideoIdError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript-plus";
import { extractCaptions } from "../caption-extractor";

describe("extractCaptions", () => {
  afterEach(() => {
    mocks.fetchTranscript.mockReset();
    vi.restoreAllMocks();
  });

  it("returns null when URL has no video ID", async () => {
    const result = await extractCaptions("not-a-youtube-url");
    expect(result).toBeNull();
    expect(mocks.fetchTranscript).not.toHaveBeenCalled();
  });

  it.each<[string, () => Error]>([
    ["Disabled", () => new YoutubeTranscriptDisabledError("dQw4w9WgXcQ")],
    ["NotAvailable", () => new YoutubeTranscriptNotAvailableError("dQw4w9WgXcQ")],
    [
      "NotAvailableLanguage",
      () => new YoutubeTranscriptNotAvailableLanguageError("en", ["zh"], "dQw4w9WgXcQ"),
    ],
    [
      "VideoUnavailable",
      () => new YoutubeTranscriptVideoUnavailableError("dQw4w9WgXcQ"),
    ],
    ["InvalidVideoId", () => new YoutubeTranscriptInvalidVideoIdError()],
  ])(
    "silently returns null on expected %s error",
    async (_name, makeErr) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mocks.fetchTranscript.mockRejectedValue(makeErr());
      const result = await extractCaptions(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      );
      expect(result).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    }
  );

  it("logs and returns null on unexpected errors (paid fallback signal)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchTranscript.mockRejectedValue(new TypeError("network down"));
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it("returns null when segments are empty", async () => {
    mocks.fetchTranscript.mockResolvedValue({
      segments: [],
      videoDetails: { title: "x", author: "y" },
    });
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toBeNull();
  });

  it("returns cleaned transcript + metadata on success and labels auto_captions", async () => {
    mocks.fetchTranscript.mockResolvedValue({
      segments: [
        { text: "hello ", lang: "en" },
        { text: "world\n\n", lang: "en" },
      ],
      videoDetails: { title: "My Title", author: "Some Channel" },
    });
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toEqual({
      transcript: "hello world",
      source: "auto_captions",
      language: "en",
      title: "My Title",
      channelName: "Some Channel",
    });
  });

  it("detects zh when leading segment lang starts with 'zh'", async () => {
    mocks.fetchTranscript.mockResolvedValue({
      segments: [{ text: "你好", lang: "zh-Hans" }],
      videoDetails: { title: "", author: "" },
    });
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.language).toBe("zh");
  });
});
