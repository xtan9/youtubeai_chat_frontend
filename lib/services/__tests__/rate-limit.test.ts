import { describe, it, expect } from "vitest";
import { getWindowStart, RATE_LIMITS } from "../rate-limit";

describe("getWindowStart", () => {
  it("floors timestamp to the start of the current minute", () => {
    const date = new Date("2026-04-17T10:30:45.123Z");
    const windowStart = getWindowStart(date);
    expect(windowStart.toISOString()).toBe("2026-04-17T10:30:00.000Z");
  });

  it("returns same value for timestamps in the same minute", () => {
    const date1 = new Date("2026-04-17T10:30:05.000Z");
    const date2 = new Date("2026-04-17T10:30:55.000Z");
    expect(getWindowStart(date1).toISOString()).toBe(
      getWindowStart(date2).toISOString()
    );
  });
});

describe("RATE_LIMITS", () => {
  it("has correct limits for anonymous and authenticated users", () => {
    expect(RATE_LIMITS.anonymous).toBe(10);
    expect(RATE_LIMITS.authenticated).toBe(30);
  });
});
