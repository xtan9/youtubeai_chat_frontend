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
  YoutubeTranscriptNotAvailableError,
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

  it("returns null and does NOT log on expected 'disabled' error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchTranscript.mockRejectedValue(
      new YoutubeTranscriptDisabledError("dQw4w9WgXcQ")
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null and does NOT log on expected 'not available' error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.fetchTranscript.mockRejectedValue(
      new YoutubeTranscriptNotAvailableError("dQw4w9WgXcQ")
    );
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null AND logs on unexpected errors (paid fallback signal)", async () => {
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

  it("returns cleaned transcript + metadata on success (en)", async () => {
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

  it("classifies as manual_captions when segment reports isGenerated=false", async () => {
    mocks.fetchTranscript.mockResolvedValue({
      segments: [{ text: "hi", lang: "en", isGenerated: false }],
      videoDetails: { title: "", author: "" },
    });
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.source).toBe("manual_captions");
  });

  it("classifies as auto_captions when segment reports kind=asr", async () => {
    mocks.fetchTranscript.mockResolvedValue({
      segments: [{ text: "hi", lang: "en", kind: "asr" }],
      videoDetails: { title: "", author: "" },
    });
    const result = await extractCaptions(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
    expect(result?.source).toBe("auto_captions");
  });
});
