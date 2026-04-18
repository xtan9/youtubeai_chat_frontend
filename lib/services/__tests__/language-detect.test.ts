import { describe, it, expect } from "vitest";
import { detectLocale } from "../language-detect";

describe("detectLocale", () => {
  it("returns 'zh' for titles with Chinese characters", () => {
    expect(detectLocale("如何学习编程")).toBe("zh");
  });

  it("returns 'zh' for mixed Chinese/English titles", () => {
    expect(detectLocale("Python教程 - 入门指南")).toBe("zh");
  });

  it("returns 'en' for English-only titles", () => {
    expect(detectLocale("How to Learn Programming")).toBe("en");
  });

  it("returns 'en' for empty input", () => {
    expect(detectLocale("")).toBe("en");
  });

  it("returns 'en' for non-CJK scripts (collapse to English prompt)", () => {
    expect(detectLocale("こんにちは")).toBe("en");
    expect(detectLocale("안녕하세요")).toBe("en");
  });
});
