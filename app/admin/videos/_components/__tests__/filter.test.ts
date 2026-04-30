import { describe, it, expect } from "vitest";
import {
  parseMode,
  parseVideoSort,
  parseVideoDir,
  parseVideoSearchParams,
  DEFAULT_MODE,
  DEFAULT_SORT,
  DEFAULT_DIR,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../filter";

describe("video filter", () => {
  it("defaults sort to distinctUsers desc, mode to all_time", () => {
    expect(parseMode(undefined)).toBe(DEFAULT_MODE);
    expect(parseVideoSort(undefined)).toBe(DEFAULT_SORT);
    expect(parseVideoDir(undefined)).toBe(DEFAULT_DIR);
    expect(DEFAULT_MODE).toBe("all_time");
    expect(DEFAULT_SORT).toBe("distinctUsers");
    expect(DEFAULT_DIR).toBe("desc");
  });

  it("rejects invalid sort and falls back to default", () => {
    expect(parseVideoSort("nope")).toBe(DEFAULT_SORT);
  });

  it("parseVideoDir explicitly accepts 'asc' (and rejects unknown values)", () => {
    expect(parseVideoDir("asc")).toBe("asc");
    expect(parseVideoDir("desc")).toBe(DEFAULT_DIR);
    expect(parseVideoDir("nonsense")).toBe(DEFAULT_DIR);
  });

  it("clamps window above MAX_WINDOW_DAYS (365)", () => {
    expect(parseVideoSearchParams({ window: "10000" }).windowDays).toBe(365);
    expect(parseVideoSearchParams({ window: "366" }).windowDays).toBe(365);
    expect(parseVideoSearchParams({ window: "365" }).windowDays).toBe(365);
  });

  it("accepts known sort keys", () => {
    expect(parseVideoSort("title")).toBe("title");
    expect(parseVideoSort("whisperPct")).toBe("whisperPct");
  });

  it("trending mode accepts windowDays > 0", () => {
    const out = parseVideoSearchParams({ mode: "trending", window: "30" });
    expect(out.mode).toBe("trending");
    expect(out.windowDays).toBe(30);
  });

  it("rejects non-positive window and falls back to 30", () => {
    expect(parseVideoSearchParams({ window: "0" }).windowDays).toBe(30);
    expect(parseVideoSearchParams({ window: "-5" }).windowDays).toBe(30);
    expect(parseVideoSearchParams({ window: "abc" }).windowDays).toBe(30);
  });

  it("clamps page and pageSize", () => {
    const out = parseVideoSearchParams({ page: "0", pageSize: "999" });
    expect(out.page).toBe(1);
    expect(out.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("uses default page size when missing", () => {
    expect(parseVideoSearchParams({}).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("normalizes search to null when empty", () => {
    expect(parseVideoSearchParams({ q: "  " }).search).toBeNull();
    expect(parseVideoSearchParams({ q: "" }).search).toBeNull();
    expect(parseVideoSearchParams({ q: "ai" }).search).toBe("ai");
  });

  it("captures filter params verbatim when present", () => {
    const out = parseVideoSearchParams({
      lang: "en",
      source: "whisper",
      channel: "Ch1",
      model: "claude-opus-4-7",
      flagged: "1",
      from: "2026-04-01",
      to: "2026-04-30",
      expanded: "vA",
    });
    expect(out.language).toBe("en");
    expect(out.source).toBe("whisper");
    expect(out.channel).toBe("Ch1");
    expect(out.model).toBe("claude-opus-4-7");
    expect(out.flaggedOnly).toBe(true);
    expect(out.firstSummarizedFrom).toBe("2026-04-01");
    expect(out.firstSummarizedTo).toBe("2026-04-30");
    expect(out.expandedVideoId).toBe("vA");
  });

  it("flagged param is only true when '1'", () => {
    expect(parseVideoSearchParams({ flagged: "true" }).flaggedOnly).toBe(false);
    expect(parseVideoSearchParams({ flagged: "1" }).flaggedOnly).toBe(true);
    expect(parseVideoSearchParams({}).flaggedOnly).toBe(false);
  });
});
