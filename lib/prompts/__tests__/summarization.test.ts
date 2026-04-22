import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSummarizationPrompt } from "../summarization";

describe("buildSummarizationPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns English prompt for language 'en'", () => {
    const prompt = buildSummarizationPrompt("Hello world transcript", "en", 1_000_000);
    expect(prompt).toContain("professional video content analyst");
    expect(prompt).toContain("Hello world transcript");
  });

  it("returns Chinese prompt for language 'zh'", () => {
    const prompt = buildSummarizationPrompt("你好世界", "zh", 1_000_000);
    expect(prompt).toContain("专业的视频内容分析师");
    expect(prompt).toContain("你好世界");
  });

  it("truncates the transcript to charBudget and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transcript = "a".repeat(100);
    const prompt = buildSummarizationPrompt(transcript, "en", 40);
    expect(prompt).toContain("a".repeat(40));
    expect(prompt).not.toContain("a".repeat(41));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("truncated"),
      expect.objectContaining({
        errorId: "TRANSCRIPT_TRUNCATED",
        originalLength: 100,
        truncatedLength: 40,
        droppedChars: 60,
      })
    );
  });

  it("does not warn when transcript fits within charBudget", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    buildSummarizationPrompt("short", "en", 1_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
