import { describe, expect, it } from "vitest";
import { countWords, getYoutubeVideoId } from "../utils";

describe("summary utility functions", () => {
  it("extracts a YouTube video ID", () => {
    expect(getYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(getYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(getYoutubeVideoId("not a YouTube URL")).toBeNull();
  });

  it("counts whitespace-separated words and CJK characters", () => {
    expect(countWords("  one   two three ")).toBe(3);
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });
});
