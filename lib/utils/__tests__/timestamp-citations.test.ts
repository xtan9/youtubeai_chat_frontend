import { describe, expect, it } from "vitest";
import { formatTimestamp, parseCitations } from "../timestamp-citations";

describe("parseCitations", () => {
  it("returns a single text part when no timestamps are present", () => {
    expect(parseCitations("Just some prose.")).toEqual([
      { type: "text", value: "Just some prose." },
    ]);
  });

  it("parses [mm:ss] in the middle of text", () => {
    const parts = parseCitations("They explain it [4:32] very clearly.");
    expect(parts).toEqual([
      { type: "text", value: "They explain it " },
      { type: "timestamp", raw: "[4:32]", seconds: 4 * 60 + 32 },
      { type: "text", value: " very clearly." },
    ]);
  });

  it("parses [hh:mm:ss]", () => {
    const parts = parseCitations("Point at [1:24:05] is key.");
    expect(parts).toEqual([
      { type: "text", value: "Point at " },
      { type: "timestamp", raw: "[1:24:05]", seconds: 1 * 3600 + 24 * 60 + 5 },
      { type: "text", value: " is key." },
    ]);
  });

  it("parses multiple timestamps in one string", () => {
    const parts = parseCitations("[0:30] then [12:08] then [1:00:00].");
    const stamps = parts.filter((p) => p.type === "timestamp");
    expect(stamps).toHaveLength(3);
    expect(stamps.map((s) => (s.type === "timestamp" ? s.seconds : null))).toEqual([
      30,
      12 * 60 + 8,
      3600,
    ]);
  });

  it("treats malformed timestamps as plain text", () => {
    // [99:99] — seconds component >= 60 is invalid
    const parts = parseCitations("Look [99:99] here.");
    expect(parts).toContainEqual({ type: "text", value: "[99:99]" });
    expect(parts.every((p) => p.type === "text")).toBe(true);
  });

  it("keeps the [m:s] zero-padded form parsable", () => {
    const parts = parseCitations("[0:05]");
    expect(parts).toEqual([{ type: "timestamp", raw: "[0:05]", seconds: 5 }]);
  });

  it("rejects [m:s] with non-zero-padded seconds", () => {
    // [7:5] doesn't match the regex (seconds must be 2 digits)
    const parts = parseCitations("[7:5]");
    expect(parts).toEqual([{ type: "text", value: "[7:5]" }]);
  });

  it("preserves the raw bracketed form on the timestamp part", () => {
    const parts = parseCitations("[12:08]");
    expect(parts[0]).toEqual({
      type: "timestamp",
      raw: "[12:08]",
      seconds: 12 * 60 + 8,
    });
  });
});

describe("formatTimestamp", () => {
  it("uses [m:ss] under one hour", () => {
    expect(formatTimestamp(0)).toBe("[0:00]");
    expect(formatTimestamp(5)).toBe("[0:05]");
    expect(formatTimestamp(65)).toBe("[1:05]");
    expect(formatTimestamp(599)).toBe("[9:59]");
  });

  it("uses [hh:mm:ss] at and over one hour", () => {
    expect(formatTimestamp(3600)).toBe("[01:00:00]");
    expect(formatTimestamp(3725)).toBe("[01:02:05]");
  });

  it("clamps negative values to zero", () => {
    expect(formatTimestamp(-1)).toBe("[0:00]");
  });
});
