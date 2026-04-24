import { describe, it, expect } from "vitest";
import { pickDefaultLanguage } from "../browser-locale";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";

describe("pickDefaultLanguage", () => {
  it("returns the primary subtag of the first supported navigator language", () => {
    expect(
      pickDefaultLanguage(["es-MX", "en-US"], SUPPORTED_LANGUAGE_CODES)
    ).toBe("es");
  });

  it("normalizes case and accepts any BCP-47 region/script suffix", () => {
    expect(
      pickDefaultLanguage(["ZH-Hans-CN"], SUPPORTED_LANGUAGE_CODES)
    ).toBe("zh");
    expect(pickDefaultLanguage(["PT-BR"], SUPPORTED_LANGUAGE_CODES)).toBe("pt");
    expect(pickDefaultLanguage(["Es-419"], SUPPORTED_LANGUAGE_CODES)).toBe("es");
  });

  it("skips unsupported languages and picks the next supported one", () => {
    // User declares Swahili (we don't ship it) then German (we do).
    expect(
      pickDefaultLanguage(["sw-KE", "de-DE"], SUPPORTED_LANGUAGE_CODES)
    ).toBe("de");
  });

  it("falls back to English when nothing matches", () => {
    expect(
      pickDefaultLanguage(["sw-KE", "yo-NG"], SUPPORTED_LANGUAGE_CODES)
    ).toBe("en");
  });

  it("falls back to English on an empty list", () => {
    expect(pickDefaultLanguage([], SUPPORTED_LANGUAGE_CODES)).toBe("en");
  });

  it("tolerates empty strings and keeps walking", () => {
    expect(
      pickDefaultLanguage(["", "fr-CA"], SUPPORTED_LANGUAGE_CODES)
    ).toBe("fr");
  });

  it("handles a bare 2-letter code with no region suffix", () => {
    expect(pickDefaultLanguage(["ja"], SUPPORTED_LANGUAGE_CODES)).toBe("ja");
  });
});
