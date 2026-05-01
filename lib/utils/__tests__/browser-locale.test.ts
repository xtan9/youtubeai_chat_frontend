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

describe("pickDefaultLanguage — Traditional Chinese routing", () => {
  it("routes zh-TW directly to zh-TW", () => {
    expect(pickDefaultLanguage(["zh-TW"], SUPPORTED_LANGUAGE_CODES)).toBe(
      "zh-TW",
    );
  });

  it("routes zh-HK to zh-TW (Traditional script alias)", () => {
    expect(pickDefaultLanguage(["zh-HK"], SUPPORTED_LANGUAGE_CODES)).toBe(
      "zh-TW",
    );
  });

  it("routes zh-MO to zh-TW (Traditional script alias)", () => {
    expect(pickDefaultLanguage(["zh-MO"], SUPPORTED_LANGUAGE_CODES)).toBe(
      "zh-TW",
    );
  });

  it("routes bare zh-Hant to zh-TW", () => {
    expect(pickDefaultLanguage(["zh-Hant"], SUPPORTED_LANGUAGE_CODES)).toBe(
      "zh-TW",
    );
  });

  it("routes zh-Hant-TW to zh-TW (script + region both Traditional)", () => {
    expect(
      pickDefaultLanguage(["zh-Hant-TW"], SUPPORTED_LANGUAGE_CODES),
    ).toBe("zh-TW");
  });

  it("routes zh-Hant-CN to zh-TW (script wins over region)", () => {
    expect(
      pickDefaultLanguage(["zh-Hant-CN"], SUPPORTED_LANGUAGE_CODES),
    ).toBe("zh-TW");
  });

  it("preserves zh (bare) → zh (Simplified)", () => {
    expect(pickDefaultLanguage(["zh"], SUPPORTED_LANGUAGE_CODES)).toBe("zh");
  });

  it("preserves zh-CN → zh (Simplified)", () => {
    expect(pickDefaultLanguage(["zh-CN"], SUPPORTED_LANGUAGE_CODES)).toBe(
      "zh",
    );
  });

  it("preserves zh-Hans-CN → zh (Simplified)", () => {
    expect(
      pickDefaultLanguage(["zh-Hans-CN"], SUPPORTED_LANGUAGE_CODES),
    ).toBe("zh");
  });

  it("matches case-insensitively (ZH-tw → zh-TW)", () => {
    expect(pickDefaultLanguage(["ZH-tw"], SUPPORTED_LANGUAGE_CODES)).toBe(
      "zh-TW",
    );
  });

  it("respects priority order — first matching tag wins", () => {
    // English is in the supported set as the user's first preference, so
    // it wins even though zh-TW appears later in the list. Sanity-check
    // that adding the alias table didn't change priority semantics.
    expect(
      pickDefaultLanguage(["en-US", "zh-TW"], SUPPORTED_LANGUAGE_CODES),
    ).toBe("en");
  });
});
