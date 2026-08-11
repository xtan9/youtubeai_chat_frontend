import { describe, expect, it } from "vitest";
import { validateAnonymousTrialChatResult } from "../anonymous-trial-chat-result";

const AVAILABLE = new Set(["[00:00]", "[00:01]", "[01:02:03]"]);

function validate(value: unknown) {
  return validateAnonymousTrialChatResult(JSON.stringify(value), AVAILABLE);
}

describe("Anonymous Trial chat result validation", () => {
  it("accepts a bounded Grounded Answer whose inline citations exactly match the server allowlist", () => {
    expect(
      validate({
        kind: "grounded_answer",
        answer: "The speaker introduces flow immediately [00:00].",
        citations: ["[00:00]"],
      }),
    ).toEqual({
      outcome: "accepted",
      kind: "grounded_answer",
      text: "The speaker introduces flow immediately [00:00].",
    });
  });

  it("accepts a concise governed refusal without requiring a citation", () => {
    expect(
      validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        message: "The selected video does not support an answer to that question.",
      }),
    ).toEqual({
      outcome: "accepted",
      kind: "refusal",
      text: "The selected video does not support an answer to that question.",
    });
  });

  it.each([
    [
      "missing",
      {
        kind: "grounded_answer",
        answer: "The speaker introduces flow.",
        citations: [],
      },
    ],
    [
      "malformed",
      {
        kind: "grounded_answer",
        answer: "The speaker introduces flow [00:99].",
        citations: ["[00:99]"],
      },
    ],
    [
      "duplicate",
      {
        kind: "grounded_answer",
        answer: "Flow starts here [00:00] and here [00:00].",
        citations: ["[00:00]", "[00:00]"],
      },
    ],
    [
      "fabricated",
      {
        kind: "grounded_answer",
        answer: "A fabricated claim [09:59].",
        citations: ["[09:59]"],
      },
    ],
    [
      "unlisted inline",
      {
        kind: "grounded_answer",
        answer: "One listed [00:00] and one hidden [00:01].",
        citations: ["[00:00]"],
      },
    ],
    [
      "citation-list mismatch",
      {
        kind: "grounded_answer",
        answer: "Citations appear out of order [00:01] [00:00].",
        citations: ["[00:00]", "[00:01]"],
      },
    ],
  ])("rejects a Grounded Answer with %s citations", (_case, value) => {
    expect(validate(value)).toEqual({ outcome: "rejected" });
  });

  it("rejects malformed, fenced, extra-field, and over-bound provider output", () => {
    expect(validateAnonymousTrialChatResult("not-json", AVAILABLE)).toEqual({
      outcome: "rejected",
    });
    expect(
      validateAnonymousTrialChatResult(
        '```json\n{"kind":"refusal"}\n```',
        AVAILABLE,
      ),
    ).toEqual({ outcome: "rejected" });
    expect(
      validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        message: "Unsupported.",
        answer: "general knowledge",
      }),
    ).toEqual({ outcome: "rejected" });
    expect(
      validateAnonymousTrialChatResult("x".repeat(12_001), AVAILABLE),
    ).toEqual({ outcome: "rejected" });
  });

  it("rejects a refusal that smuggles a citation or answer-shaped bracketed content", () => {
    expect(
      validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        message: "The answer is elsewhere [00:00].",
      }),
    ).toEqual({ outcome: "rejected" });
  });
});
