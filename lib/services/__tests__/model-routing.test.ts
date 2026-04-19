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

import {
  chooseModel,
  HAIKU,
  SONNET,
  type ClassifierResult,
  type TranscriptMetadata,
} from "../model-routing";

function meta(tokens: number): TranscriptMetadata {
  return { tokens, wordCount: Math.round(tokens / 1.3), language: "en" };
}

const classifier = (c: Partial<ClassifierResult> = {}): ClassifierResult => ({
  density: "medium",
  type: "other",
  structure: "structured",
  ...c,
});

describe("chooseModel", () => {
  it("routes to Haiku with reason 'very_short' below SHORT_TOKENS", () => {
    const decision = chooseModel(meta(4_000), classifier());
    expect(decision.model).toBe(HAIKU);
    expect(decision.reason).toBe("very_short");
  });

  it("routes to Sonnet with reason 'long_content' above LONG_TOKENS", () => {
    const decision = chooseModel(meta(200_000), classifier());
    expect(decision.model).toBe(SONNET);
    expect(decision.reason).toBe("long_content");
  });

  it("routes to Sonnet with reason 'high_density' when classifier says density=high", () => {
    const decision = chooseModel(
      meta(20_000),
      classifier({ density: "high", type: "lecture", structure: "structured" })
    );
    expect(decision.model).toBe(SONNET);
    expect(decision.reason).toBe("high_density");
  });

  it("routes to Sonnet with reason 'structured_fidelity' for lectures", () => {
    const decision = chooseModel(
      meta(20_000),
      classifier({ density: "medium", type: "lecture", structure: "structured" })
    );
    expect(decision.model).toBe(SONNET);
    expect(decision.reason).toBe("structured_fidelity");
  });

  it("routes to Sonnet with reason 'structured_fidelity' for news", () => {
    const decision = chooseModel(
      meta(20_000),
      classifier({ density: "medium", type: "news", structure: "structured" })
    );
    expect(decision.model).toBe(SONNET);
    expect(decision.reason).toBe("structured_fidelity");
  });

  it("routes to Haiku with reason 'low_density_casual' for rambling low-density content", () => {
    const decision = chooseModel(
      meta(30_000),
      classifier({ density: "low", type: "casual", structure: "rambling" })
    );
    expect(decision.model).toBe(HAIKU);
    expect(decision.reason).toBe("low_density_casual");
  });

  it("defaults to Haiku with reason 'default_haiku' for average medium-zone content", () => {
    const decision = chooseModel(
      meta(20_000),
      classifier({ density: "medium", type: "casual", structure: "structured" })
    );
    expect(decision.model).toBe(HAIKU);
    expect(decision.reason).toBe("default_haiku");
  });

  it("falls back to Haiku with reason 'classifier_failed_short' when classifier is null and tokens < FALLBACK_HAIKU_TOKENS", () => {
    const decision = chooseModel(meta(10_000), null);
    expect(decision.model).toBe(HAIKU);
    expect(decision.reason).toBe("classifier_failed_short");
  });

  it("falls back to Sonnet with reason 'classifier_failed_long' when classifier is null and tokens >= FALLBACK_HAIKU_TOKENS", () => {
    const decision = chooseModel(meta(50_000), null);
    expect(decision.model).toBe(SONNET);
    expect(decision.reason).toBe("classifier_failed_long");
  });
});
