import {describe, expect, it} from "vitest";
import {resolveLocale} from "./locales";
import en from "./messages/en.json";
import zh from "./messages/zh.json";
import traditional from "./messages/zh-TW.json";

describe("interface locale", () => {
  it("prefers an explicit choice and negotiates supported browser languages", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("invalid", "en;q=0.5, zh-Hant-HK")).toBe("zh-TW");
    expect(resolveLocale(undefined, "fr, zh-Hans")).toBe("zh");
    expect(resolveLocale(undefined, "zh-TW;q=0, fr")).toBe("en");
  });
  it("provides every interface message in each language", () => {
    for (const catalog of [zh, traditional]) {
      expect(Object.keys(catalog.home).sort()).toEqual(Object.keys(en.home).sort());
      expect(catalog.home.faqItems).toHaveLength(en.home.faqItems.length);
      expect(catalog.home.steps).toHaveLength(en.home.steps.length);
      expect(Object.keys(catalog.ui).sort()).toEqual(Object.keys(en.ui).sort());
    }
  });
});
