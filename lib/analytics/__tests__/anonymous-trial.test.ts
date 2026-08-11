import { describe, expect, it } from "vitest";
import {
  anonymousTrialRemainingAllowance,
  validateAnonymousTrialEvent,
} from "../anonymous-trial";

describe("Anonymous Trial analytics contract", () => {
  it.each([
    [0, "zero"],
    [1, "one"],
    [2, "two_to_four"],
    [4, "two_to_four"],
  ] as const)("buckets remaining allowance %i without identity", (count, bucket) => {
    expect(anonymousTrialRemainingAllowance(count)).toBe(bucket);
  });

  it("accepts only bounded content-private admitted metadata", () => {
    expect(
      validateAnonymousTrialEvent("anonymous_trial_message_admitted", {
        source_surface: "hero_demo",
        remaining_allowance: "two_to_four",
      }).success,
    ).toBe(true);
    expect(
      validateAnonymousTrialEvent("anonymous_trial_message_admitted", {
        source_surface: "hero_demo",
        remaining_allowance: "two_to_four",
        prompt: "private question",
      }).success,
    ).toBe(false);
  });

  it("rejects content and identifiers from conversion analytics", () => {
    expect(
      validateAnonymousTrialEvent("anonymous_trial_converted", {
        source_surface: "hero_demo",
        registration_method: "email",
        user_id: "private-user",
      }).success,
    ).toBe(false);
  });
});
