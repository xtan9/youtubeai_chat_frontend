import { describe, it, expect } from "vitest";
import { detectLanguage } from "../language-detect";

describe("detectLanguage", () => {
  it("returns 'zh' for titles with Chinese characters", () => {
    expect(detectLanguage("如何学习编程")).toBe("zh");
  });

  it("returns 'zh' for mixed Chinese/English titles", () => {
    expect(detectLanguage("Python教程 - 入门指南")).toBe("zh");
  });

  it("returns 'en' for English-only titles", () => {
    expect(detectLanguage("How to Learn Programming")).toBe("en");
  });

  it("returns 'en' for empty titles", () => {
    expect(detectLanguage("")).toBe("en");
  });
});
