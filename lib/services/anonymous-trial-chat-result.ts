import { z } from "zod";

const MAX_BUFFERED_RESULT_CHARS = 12_000;
// `formatTimestamp` emits `[m:ss]` for sub-hour transcript segments and
// `[hh:mm:ss]` for hour-plus segments. Keep the generated-result grammar
// aligned with those immutable server-owned labels; membership in the
// route-provided allowlist remains the authoritative validation step.
const CANONICAL_TIMESTAMP_CITATION = /^\[(?:\d{2}:)?\d{1,2}:\d{2}\]$/;
const BRACKETED_TOKEN = /\[[^\]\r\n]*\]/g;

const GroundedAnswerSchema = z
  .object({
    kind: z.literal("grounded_answer"),
    answer: z.string().trim().min(1).max(8_000),
    citations: z
      .array(z.string().regex(CANONICAL_TIMESTAMP_CITATION))
      .min(1)
      .max(8),
  })
  .strict();

const RefusalSchema = z
  .object({
    kind: z.literal("refusal"),
    reason: z.literal("video_does_not_support_answer"),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

const AnonymousTrialChatResultSchema = z.discriminatedUnion("kind", [
  GroundedAnswerSchema,
  RefusalSchema,
]);

export type AnonymousTrialValidatedResult =
  | {
      readonly outcome: "accepted";
      readonly kind: "grounded_answer" | "refusal";
      readonly text: string;
    }
  | { readonly outcome: "rejected" };

/**
 * Validate a fully buffered Anonymous Trial generation before any model text
 * reaches the client. The allowlist is derived exclusively from immutable,
 * server-owned Hero Demo transcript segments at the route boundary.
 */
export function validateAnonymousTrialChatResult(
  rawResult: string,
  availableCitations: ReadonlySet<string>,
): AnonymousTrialValidatedResult {
  if (
    rawResult.length === 0 ||
    rawResult.length > MAX_BUFFERED_RESULT_CHARS
  ) {
    return { outcome: "rejected" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(rawResult);
  } catch {
    return { outcome: "rejected" };
  }

  const parsed = AnonymousTrialChatResultSchema.safeParse(decoded);
  if (!parsed.success) return { outcome: "rejected" };

  if (parsed.data.kind === "refusal") {
    if (parsed.data.message.includes("[") || parsed.data.message.includes("]")) {
      return { outcome: "rejected" };
    }
    return {
      outcome: "accepted",
      kind: "refusal",
      text: parsed.data.message,
    };
  }

  const uniqueCitations = new Set(parsed.data.citations);
  if (uniqueCitations.size !== parsed.data.citations.length) {
    return { outcome: "rejected" };
  }
  if (parsed.data.citations.some((citation) => !availableCitations.has(citation))) {
    return { outcome: "rejected" };
  }

  const answerCitations = parsed.data.answer.match(BRACKETED_TOKEN) ?? [];
  const textWithoutBracketedTokens = parsed.data.answer.replace(BRACKETED_TOKEN, "");
  if (
    textWithoutBracketedTokens.includes("[") ||
    textWithoutBracketedTokens.includes("]") ||
    answerCitations.length !== parsed.data.citations.length ||
    answerCitations.some(
      (citation, index) => citation !== parsed.data.citations[index],
    )
  ) {
    return { outcome: "rejected" };
  }

  return {
    outcome: "accepted",
    kind: "grounded_answer",
    text: parsed.data.answer,
  };
}
