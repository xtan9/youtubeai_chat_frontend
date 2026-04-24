import { describe, it, expect } from "vitest";
import { shouldShowElapsed } from "../streaming-progress-helpers";

describe("shouldShowElapsed", () => {
  it("hides the row for cached/instant-complete (no tick ever fired)", () => {
    // Regression guard: if this flips to `elapsed >= 0`, cached responses
    // resurrect the pre-fix "0.0s elapsed frozen at zero" UX bug.
    expect(shouldShowElapsed(true, 0)).toBe(false);
  });

  it("keeps the frozen final value visible after normal completion", () => {
    // Regression guard: if this collapses to `!isComplete`, the timer
    // disappears the instant stage flips to complete — defeating the fix.
    expect(shouldShowElapsed(true, 4.5)).toBe(true);
  });

  it("shows the row while streaming regardless of elapsed value", () => {
    expect(shouldShowElapsed(false, 0)).toBe(true);
    expect(shouldShowElapsed(false, 2.3)).toBe(true);
  });
});
