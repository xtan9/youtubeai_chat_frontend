import { describe, it, expect } from "vitest";

import { parseWindowDays } from "../window-days";

describe("parseWindowDays", () => {
  it("returns the parsed value when it's in the default allowlist", () => {
    expect(parseWindowDays("7")).toBe(7);
    expect(parseWindowDays("14")).toBe(14);
    expect(parseWindowDays("30")).toBe(30);
    expect(parseWindowDays("90")).toBe(90);
  });

  it("defaults to 30 when raw is undefined or empty", () => {
    expect(parseWindowDays(undefined)).toBe(30);
    expect(parseWindowDays("")).toBe(30);
  });

  it("clamps out-of-allowlist values to 30 (defends against attacker widening)", () => {
    expect(parseWindowDays("365")).toBe(30);
    expect(parseWindowDays("99999")).toBe(30);
    expect(parseWindowDays("-7")).toBe(30);
  });

  it("clamps NaN/garbage input to 30", () => {
    expect(parseWindowDays("abc")).toBe(30);
    expect(parseWindowDays("7d")).toBe(7); // parseInt stops at 'd'
    expect(parseWindowDays(".5")).toBe(30);
  });

  it("accepts a custom allowlist (used by /admin/performance which adds 1d)", () => {
    expect(parseWindowDays("1", [1, 7, 14, 30, 90])).toBe(1);
    expect(parseWindowDays("7", [1, 7, 14, 30, 90])).toBe(7);
    expect(parseWindowDays("2", [1, 7, 14, 30, 90])).toBe(30);
  });
});
