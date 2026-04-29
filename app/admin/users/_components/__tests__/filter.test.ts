import { describe, it, expect } from "vitest";
import { TABS, parseTab, DEFAULT_TAB } from "../filter";

describe("filter tabs", () => {
  it("DEFAULT_TAB is 'exclude_anon'", () => {
    expect(DEFAULT_TAB).toBe("exclude_anon");
  });

  it("TABS includes exactly the five expected keys in display order", () => {
    expect(TABS.map((t) => t.key)).toEqual([
      "exclude_anon",
      "active",
      "flagged",
      "anon_only",
      "all",
    ]);
  });

  it("parseTab returns DEFAULT for unknown values", () => {
    expect(parseTab("garbage")).toBe("exclude_anon");
    expect(parseTab(null)).toBe("exclude_anon");
    expect(parseTab(undefined)).toBe("exclude_anon");
  });

  it("parseTab returns the value for known tabs", () => {
    expect(parseTab("anon_only")).toBe("anon_only");
    expect(parseTab("all")).toBe("all");
  });
});
