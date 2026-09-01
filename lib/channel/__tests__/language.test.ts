import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  detectAssessmentLanguage,
  isEligibleAssessmentLanguage,
} from "../interaction-assessment";

describe("interaction assessment language policy", () => {
  it.each([
    ["English", { text: "You are a fool.", languageHint: "en" }, "english"],
    [
      "Simplified Chinese",
      { text: "这个观点蠢透了。", languageHint: "zh-CN" },
      "simplified_chinese",
    ],
    [
      "Traditional Chinese",
      { text: "這個觀點蠢透了。", languageHint: "zh-TW" },
      "traditional_chinese",
    ],
    [
      "qualifying Chinese-English code-switching",
      { text: "这个观点 is really stupid。" },
      "chinese_english_code_switch",
    ],
  ])("accepts %s", (_label, input, expected) => {
    const detected = detectAssessmentLanguage(input);
    expect(detected).toBe(expected);
    expect(isEligibleAssessmentLanguage(detected)).toBe(true);
  });

  it.each([
    ["Spanish", { text: "Eres un tonto.", languageHint: "es" }],
    [
      "unsupported language mixed with Chinese",
      { text: "Eres un tonto 这个。", languageHint: "es" },
    ],
    ["Russian", { text: "Ты дурак.", languageHint: "ru" }],
    ["Japanese", { text: "これは日本語です。", languageHint: "ja" }],
    ["Japanese script without a hint", { text: "これは日本語です。" }],
    ["Chinese with only a proper name", { text: "YouTube 教程。" }],
  ])("keeps %s reviewable", (_label, input) => {
    const language = detectAssessmentLanguage(input);
    expect(language).toBe("other");
    expect(isEligibleAssessmentLanguage(language)).toBe(false);
  });
});
