import { describe, it, expect } from "vitest";
import { buildSummarizationPrompt } from "../summarization";

describe("buildSummarizationPrompt", () => {
  it("returns English prompt for language 'en'", () => {
    const prompt = buildSummarizationPrompt("Hello world transcript", "en");
    expect(prompt).toContain("professional video content analyst");
    expect(prompt).toContain("Hello world transcript");
  });

  it("returns Chinese prompt for language 'zh'", () => {
    const prompt = buildSummarizationPrompt("你好世界", "zh");
    expect(prompt).toContain("专业的视频内容分析师");
    expect(prompt).toContain("你好世界");
  });

  it("includes the transcript in the prompt", () => {
    const transcript = "This is a test transcript about cats.";
    const prompt = buildSummarizationPrompt(transcript, "en");
    expect(prompt).toContain(transcript);
  });
});
