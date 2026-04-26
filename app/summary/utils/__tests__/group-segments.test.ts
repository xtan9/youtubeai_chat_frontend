import { describe, it, expect } from "vitest";
import {
  formatTimestamp,
  groupSegments,
  DEFAULT_TARGET_DURATION_SECONDS,
} from "../group-segments";

describe("groupSegments", () => {
  it("returns an empty array when given no segments", () => {
    expect(groupSegments([])).toEqual([]);
  });

  it("groups consecutive segments until duration ≥ target AND ends on a sentence boundary", () => {
    // Three 12-second segments. Target 30s — first two together are 24s
    // (under target), all three are 36s (over target). The third ends on a
    // sentence boundary so the group flushes there.
    const result = groupSegments(
      [
        { text: "first line", start: 0, duration: 12 },
        { text: "second line", start: 12, duration: 12 },
        { text: "third line.", start: 24, duration: 12 },
      ],
      30
    );
    expect(result).toEqual([
      {
        start: 0,
        end: 36,
        text: "first line second line third line.",
      },
    ]);
  });

  it("does NOT flush mid-sentence even when target is hit (readability beats duration)", () => {
    // Hits 30s after segment 2 but no sentence terminator until segment 3.
    // The group should keep accumulating instead of cutting mid-sentence.
    const result = groupSegments(
      [
        { text: "alpha", start: 0, duration: 15 },
        { text: "beta", start: 15, duration: 15 },
        { text: "gamma.", start: 30, duration: 5 },
      ],
      30
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("alpha beta gamma.");
    expect(result[0].end).toBe(35);
  });

  it("forces a flush at the hard cap (2× target) so a never-punctuated stretch can't grow without bound", () => {
    // Whisper for music videos sometimes returns a long stretch with no
    // punctuation. Without the hard cap the whole transcript becomes a
    // single 30-minute "paragraph" — unscrollable, defeats the timestamp
    // UX entirely.
    const segments = Array.from({ length: 20 }, (_, i) => ({
      text: `chunk${i}`,
      start: i * 5,
      duration: 5,
    }));
    const result = groupSegments(segments, 30);
    // 20 × 5 = 100s of audio, target 30 → hard cap 60. Expect roughly
    // ⌈100/60⌉ ≈ 2 paragraphs.
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const p of result) {
      // Last paragraph may be shorter (tail flush), but no paragraph
      // should exceed the hard cap.
      expect(p.end - p.start).toBeLessThanOrEqual(60);
    }
  });

  it("flushes a single paragraph for the tail (last segment may be mid-sentence)", () => {
    // Common case: a video ends abruptly. The tail flush ensures the
    // final segments aren't dropped on the floor.
    const result = groupSegments(
      [
        { text: "intro.", start: 0, duration: 30 },
        { text: "trailing thought without period", start: 30, duration: 5 },
      ],
      30
    );
    expect(result.map((p) => p.text)).toEqual([
      "intro.",
      "trailing thought without period",
    ]);
  });

  it("trims segment text before joining (paragraph text has no double spaces)", () => {
    const result = groupSegments(
      [
        { text: "  hello  ", start: 0, duration: 30 },
        { text: "world.", start: 30, duration: 1 },
      ],
      30
    );
    expect(result[0].text).toBe("hello world.");
  });

  it("recognizes CJK sentence terminators (。！？)", () => {
    // Without recognizing 。 the Chinese transcript would never end on a
    // boundary, defeat the duration-target check, and only flush at the
    // hard cap — collapsing the whole video into long paragraphs.
    const result = groupSegments(
      [
        { text: "你好世界", start: 0, duration: 30 },
        { text: "再见。", start: 30, duration: 5 },
      ],
      30
    );
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("你好世界 再见。");
  });

  it("uses the default target duration when called with no second arg", () => {
    // Smoke test — protects against a typo'd default that quietly chunks
    // everything into one paragraph.
    expect(DEFAULT_TARGET_DURATION_SECONDS).toBe(30);
    const result = groupSegments([
      { text: "hi.", start: 0, duration: 1 },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("formatTimestamp", () => {
  it.each([
    [0, "00:00"],
    [9, "00:09"],
    [60, "01:00"],
    [125, "02:05"],
    [3599, "59:59"],
  ])("formats %d seconds as %s when under 1 hour", (sec, expected) => {
    expect(formatTimestamp(sec)).toBe(expected);
  });

  it.each([
    [3600, "1:00:00"],
    [3661, "1:01:01"],
    [7322, "2:02:02"],
  ])("formats %d seconds as %s when 1 hour or more", (sec, expected) => {
    expect(formatTimestamp(sec)).toBe(expected);
  });

  it("clamps negative inputs to 0 (defensive — players occasionally report negatives during seek)", () => {
    expect(formatTimestamp(-5)).toBe("00:00");
  });

  it("floors fractional seconds (so 1.9 displays as 00:01, not 00:02)", () => {
    expect(formatTimestamp(1.9)).toBe("00:01");
  });
});
