import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  signContinueLearningToken,
  signContinueLearningSetToken,
  verifyContinueLearningToken,
  verifyContinueLearningSetToken,
} from "../continue-learning-token";

const SECRET = "continue-learning-test-secret-32-chars-min";
const INPUT = {
  learnerId: "10000000-0000-4000-8000-000000000001",
  setId: "20000000-0000-4000-8000-000000000002",
  ordinal: 3,
};

describe("continue-learning HMAC token", () => {
  beforeEach(() => {
    vi.stubEnv("CONTINUE_LEARNING_TOKEN_SECRET", SECRET);
  });

  it("signs an opaque token without exposing the learner or Set ids", () => {
    const token = signContinueLearningToken(INPUT);

    expect(token).toMatch(/^cl1\.[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(INPUT.learnerId);
    expect(token).not.toContain(INPUT.setId);
    expect(verifyContinueLearningToken(token!, INPUT)).toBe(true);
  });

  it("binds the token to every identity component", () => {
    const token = signContinueLearningToken(INPUT);
    expect(
      verifyContinueLearningToken(token!, { ...INPUT, learnerId: "other" }),
    ).toBe(false);
    expect(
      verifyContinueLearningToken(token!, { ...INPUT, setId: "other" }),
    ).toBe(false);
    expect(
      verifyContinueLearningToken(token!, { ...INPUT, ordinal: 4 }),
    ).toBe(false);
  });

  it("signs a learner-bound Set version token separately from item tokens", () => {
    const token = signContinueLearningSetToken({
      learnerId: INPUT.learnerId,
      setId: INPUT.setId,
    });

    expect(token).toMatch(/^cl1s\.[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain(INPUT.setId);
    expect(
      verifyContinueLearningSetToken(token!, {
        learnerId: INPUT.learnerId,
        setId: INPUT.setId,
      }),
    ).toBe(true);
    expect(
      verifyContinueLearningSetToken(token!, {
        learnerId: INPUT.learnerId,
        setId: "other",
      }),
    ).toBe(false);
  });

  it("rejects malformed or tampered tokens", () => {
    const token = signContinueLearningToken(INPUT)!;
    expect(verifyContinueLearningToken(`${token}x`, INPUT)).toBe(false);
    expect(verifyContinueLearningToken(`cl2.${token.slice(4)}`, INPUT)).toBe(
      false,
    );
    expect(verifyContinueLearningToken("not-a-token", INPUT)).toBe(false);
  });

  it("fails closed when the signing secret is missing or short", () => {
    vi.stubEnv("CONTINUE_LEARNING_TOKEN_SECRET", "");
    expect(signContinueLearningToken(INPUT)).toBeNull();
    expect(verifyContinueLearningToken("cl1.anything", INPUT)).toBe(false);
  });
});
