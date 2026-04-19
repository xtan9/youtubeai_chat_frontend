import { describe, it, expect } from "vitest";
import {
  getTranscriptMetadata,
  TOKENS_PER_WORD,
} from "../model-routing";

describe("getTranscriptMetadata", () => {
  it("counts words and estimates tokens as wordCount * TOKENS_PER_WORD", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const transcript = words.join(" ");

    const metadata = getTranscriptMetadata(transcript, "en");

    expect(metadata.wordCount).toBe(500);
    expect(metadata.tokens).toBe(Math.round(500 * TOKENS_PER_WORD));
    expect(metadata.language).toBe("en");
  });

  it("returns zero counts for an empty transcript", () => {
    const metadata = getTranscriptMetadata("", "zh");
    expect(metadata.wordCount).toBe(0);
    expect(metadata.tokens).toBe(0);
    expect(metadata.language).toBe("zh");
  });
});
