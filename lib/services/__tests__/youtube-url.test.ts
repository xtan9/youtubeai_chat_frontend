import { describe, it, expect } from "vitest";
import {
  canonicalYouTubeUrl,
  extractVideoId,
  normalizeYouTubeVideoId,
} from "../youtube-url";

describe("extractVideoId", () => {
  it("extracts ID from canonical YouTube URL", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from short URL", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from embed URL", () => {
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from /v/ URL", () => {
    expect(extractVideoId("https://www.youtube.com/v/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ"
    );
  });

  it("extracts ID from shorts URL", () => {
    expect(
      extractVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from music.youtube.com", () => {
    expect(
      extractVideoId("https://music.youtube.com/watch?v=dQw4w9WgXcQ")
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from m.youtube.com (mobile)", () => {
    expect(
      extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")
    ).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID even with extra query params", () => {
    expect(
      extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")
    ).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube URL", () => {
    expect(extractVideoId("not-a-youtube-url")).toBeNull();
    expect(extractVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("returns null for 10-char ID (below boundary)", () => {
    expect(
      extractVideoId("https://www.youtube.com/watch?v=shortid123")
    ).toBeNull();
  });

  it("returns null for URL-encoded junk in ID position", () => {
    // %20 etc are not in [A-Za-z0-9_-] so the regex must not capture them.
    expect(
      extractVideoId("https://www.youtube.com/watch?v=abc%20defg123")
    ).toBeNull();
  });
});

describe("normalizeYouTubeVideoId", () => {
  it("accepts a raw ID and every supported URL form as one identity", () => {
    const id = "dQw4w9WgXcQ";
    const inputs = [
      id,
      `https://www.youtube.com/watch?v=${id}&t=30s`,
      `https://youtu.be/${id}?si=tracking`,
      `https://m.youtube.com/embed/${id}`,
      `https://music.youtube.com/live/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/v/${id}`,
    ];

    expect(inputs.map(normalizeYouTubeVideoId)).toEqual(inputs.map(() => id));
    expect(canonicalYouTubeUrl(id)).toBe(
      `https://www.youtube.com/watch?v=${id}`,
    );
  });

  it.each([
    "",
    "not-a-youtube-url",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/embed/dQw4w9WgXcQ/extra",
  ])("rejects malformed or unsupported input: %s", (input) => {
    expect(normalizeYouTubeVideoId(input)).toBeNull();
  });
});
