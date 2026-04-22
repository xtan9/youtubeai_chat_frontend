import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSummarizationPrompt } from "../summarization";

describe("buildSummarizationPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a prompt containing the summarizer role and the transcript", () => {
    const prompt = buildSummarizationPrompt("Hello world transcript", 1_000_000);
    expect(prompt).toContain("summarizer for a YouTube viewing app");
    expect(prompt).toContain("Hello world transcript");
  });

  it("instructs the model to respond in the video's language", () => {
    const prompt = buildSummarizationPrompt("任意内容", 1_000_000);
    expect(prompt).toContain("same language as the video");
    expect(prompt).toContain("任意内容");
  });

  it("truncates the transcript to charBudget and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transcript = "a".repeat(100);
    const prompt = buildSummarizationPrompt(transcript, 40);
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
    buildSummarizationPrompt("short", 1_000);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
