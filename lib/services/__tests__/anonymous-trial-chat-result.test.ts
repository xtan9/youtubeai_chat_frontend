import { describe, expect, it } from "vitest";
import { validateAnonymousTrialChatResult } from "../anonymous-trial-chat-result";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";

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

  it.each([
    ["en", "The selected video does not contain enough evidence to answer that question."],
    ["es", "El video seleccionado no contiene evidencia suficiente para responder esa pregunta."],
    ["zh", "所选视频没有足够的证据来回答该问题。"],
  ])("derives a concise governed %s refusal without model-authored prose", (language, text) => {
    expect(
      validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        language,
      }),
    ).toEqual({
      outcome: "accepted",
      kind: "refusal",
      text,
    });
  });

  it("rejects answer-shaped or general-purpose model prose disguised as a refusal", () => {
    expect(
      validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        language: "en",
        message: "Paris won the World Cup.",
      }),
    ).toEqual({ outcome: "rejected" });
  });

  it("derives bounded server-owned refusal text for every supported language code", () => {
    for (const language of SUPPORTED_LANGUAGE_CODES) {
      const result = validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        language,
      });
      expect(result).toMatchObject({ outcome: "accepted", kind: "refusal" });
      if (result.outcome === "accepted") {
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.text.length).toBeLessThanOrEqual(500);
        expect(result.text).not.toMatch(/[\[\]]/u);
      }
    }
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
        language: "en",
        answer: "general knowledge",
      }),
    ).toEqual({ outcome: "rejected" });
    expect(
      validateAnonymousTrialChatResult("x".repeat(12_001), AVAILABLE),
    ).toEqual({ outcome: "rejected" });
  });

  it("rejects a refusal that smuggles model-authored content", () => {
    expect(
      validate({
        kind: "refusal",
        reason: "video_does_not_support_answer",
        language: "en",
        message: "The answer is elsewhere [00:00].",
      }),
    ).toEqual({ outcome: "rejected" });
  });
});
