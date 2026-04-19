import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  getTranscriptMetadata,
  TOKENS_PER_WORD,
  TOKENS_PER_ZH_CHAR,
} from "../model-routing";

describe("getTranscriptMetadata", () => {
  it("counts words and estimates tokens as wordCount * TOKENS_PER_WORD", () => {
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
    const transcript = words.join(" ");

    const metadata = getTranscriptMetadata(transcript, "en");

    expect(metadata.wordCount).toBe(500);
    expect(metadata.tokens).toBe(Math.round(500 * TOKENS_PER_WORD));
  });

  it("returns zero counts for an empty transcript", () => {
    const metadata = getTranscriptMetadata("", "zh");
    expect(metadata.wordCount).toBe(0);
    expect(metadata.tokens).toBe(0);
  });

  it("counts CJK chars (not whitespace-split words) for Chinese transcripts", () => {
    const transcript = "你好世界欢迎来到机器学习的奇妙世界";
    const metadata = getTranscriptMetadata(transcript, "zh");
    // 17 CJK chars in the string above.
    expect(metadata.wordCount).toBe(17);
    expect(metadata.tokens).toBe(Math.round(17 * TOKENS_PER_ZH_CHAR));
  });

  it("estimates tokens for a long Chinese transcript well above SHORT_TOKENS (regression: was 1 via whitespace-split)", () => {
    const transcript = "机".repeat(10_000);
    const metadata = getTranscriptMetadata(transcript, "zh");
    expect(metadata.tokens).toBeGreaterThan(5_000);
  });
});

import {
  chooseModel,
  FALLBACK_HAIKU_TOKENS,
  HAIKU,
  LONG_TOKENS,
  SHORT_TOKENS,
  SONNET,
  type ClassifierResult,
  type TranscriptMetadata,
} from "../model-routing";

function meta(tokens: number): TranscriptMetadata {
  return { tokens, wordCount: Math.round(tokens / 1.3) };
}

function abortableSignal(): AbortSignal {
  return new AbortController().signal;
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

  // Boundary tests — pin the strict-inequality choices in the rule engine so
  // a future refactor that flips `<` to `<=` doesn't silently change routing.
  it("at tokens === SHORT_TOKENS the classifier result wins (not 'very_short')", () => {
    const decision = chooseModel(meta(SHORT_TOKENS), classifier({ density: "medium" }));
    expect(decision.reason).not.toBe("very_short");
    expect(decision.reason).toBe("default_haiku");
  });

  it("at tokens === LONG_TOKENS the classifier result wins (not 'long_content')", () => {
    const decision = chooseModel(
      meta(LONG_TOKENS),
      classifier({ density: "high" })
    );
    expect(decision.reason).not.toBe("long_content");
    expect(decision.reason).toBe("high_density");
  });

  it("at tokens === FALLBACK_HAIKU_TOKENS with null classifier routes to classifier_failed_long", () => {
    const decision = chooseModel(meta(FALLBACK_HAIKU_TOKENS), null);
    expect(decision.reason).toBe("classifier_failed_long");
  });
});

import { classifyContent } from "../model-routing";

// Mock the llm-client module — classifyContent calls callLlmJson.
vi.mock("../llm-client", async () => {
  const actual = await vi.importActual<typeof import("../llm-client")>("../llm-client");
  return {
    ...actual,
    callLlmJson: vi.fn(),
  };
});

import { callLlmJson } from "../llm-client";

describe("classifyContent", () => {
  beforeEach(() => {
    vi.mocked(callLlmJson).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the classifier result on a valid JSON response", async () => {
    vi.mocked(callLlmJson).mockResolvedValue(
      JSON.stringify({ density: "high", type: "lecture", structure: "structured" })
    );

    const result = await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: abortableSignal(),
    });

    expect(result).toEqual({
      density: "high",
      type: "lecture",
      structure: "structured",
    });
  });

  it("tolerates leading/trailing whitespace in the JSON response", async () => {
    vi.mocked(callLlmJson).mockResolvedValue(
      '  \n{"density":"medium","type":"tutorial","structure":"rambling"}\n  '
    );

    const result = await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: abortableSignal(),
    });

    expect(result).toEqual({
      density: "medium",
      type: "tutorial",
      structure: "rambling",
    });
  });

  it("returns null and logs CLASSIFIER_FAILED when callLlmJson throws", async () => {
    vi.mocked(callLlmJson).mockRejectedValue(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: abortableSignal(),
    });

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("classifier"),
      expect.objectContaining({ errorId: "CLASSIFIER_FAILED" })
    );
  });

  it("returns null silently (no CLASSIFIER_FAILED log) when the caller aborted", async () => {
    const ac = new AbortController();
    // Simulate upstream fetch throwing AbortError once the caller signal fires.
    vi.mocked(callLlmJson).mockImplementation(async () => {
      ac.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: ac.signal,
    });

    expect(result).toBeNull();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("returns null when the response is not valid JSON", async () => {
    vi.mocked(callLlmJson).mockResolvedValue("not json at all");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: abortableSignal(),
    });

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorId: "CLASSIFIER_FAILED" })
    );
  });

  it("returns null when the response has an unknown enum value", async () => {
    vi.mocked(callLlmJson).mockResolvedValue(
      JSON.stringify({ density: "extreme", type: "lecture", structure: "structured" })
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: abortableSignal(),
    });

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorId: "CLASSIFIER_FAILED" })
    );
  });

  it("passes a 5 second timeout and Haiku model to callLlmJson", async () => {
    vi.mocked(callLlmJson).mockResolvedValue(
      JSON.stringify({ density: "low", type: "casual", structure: "rambling" })
    );

    await classifyContent({
      transcriptExcerpt: "abc",
      title: "t",
      language: "en",
      signal: abortableSignal(),
    });

    expect(callLlmJson).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5",
        timeoutMs: 5_000,
      })
    );
  });
});
