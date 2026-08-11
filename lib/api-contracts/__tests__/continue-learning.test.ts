import { describe, expect, it } from "vitest";
import { ContinueLearningResponseSchema } from "../continue-learning";

const READY = {
  outcome: "ready" as const,
  setVersionToken: "cl1s.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  items: [
    {
      token: "cl1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ordinal: 1,
      canonicalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      title: "A next lesson",
      channelName: "Teaching Channel",
      thumbnailUrl: "https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg",
      relationship: "deeper_explanation" as const,
      explanation: "Builds on the source concept.",
    },
  ],
};

describe("Continue Learning browser response contract", () => {
  it("accepts a ready payload with only browser-safe display fields", () => {
    expect(ContinueLearningResponseSchema.safeParse(READY).success).toBe(true);
  });

  it("accepts the opaque pending preparation state", () => {
    expect(
      ContinueLearningResponseSchema.safeParse({ outcome: "pending" }).success,
    ).toBe(true);
  });

  it("rejects internal identifiers or unrecognized pending fields", () => {
    expect(
      ContinueLearningResponseSchema.safeParse({
        outcome: "ready",
        setVersionToken: READY.setVersionToken,
        items: [{ ...READY.items[0], setId: "private-set-id" }],
      }).success,
    ).toBe(false);
    expect(
      ContinueLearningResponseSchema.safeParse({
        outcome: "pending",
        preparationId: "private-preparation-id",
      }).success,
    ).toBe(false);
  });
});
