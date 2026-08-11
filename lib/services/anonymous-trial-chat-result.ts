import { z } from "zod";
import {
  SUPPORTED_LANGUAGE_CODES,
  type SupportedLanguageCode,
} from "@/lib/constants/languages";

export const MAX_ANONYMOUS_TRIAL_RESULT_CHARS = 12_000;
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
    language: z.enum(SUPPORTED_LANGUAGE_CODES),
  })
  .strict();

const REFUSAL_TEXT: Readonly<Record<SupportedLanguageCode, string>> = {
  en: "The selected video does not contain enough evidence to answer that question.",
  es: "El video seleccionado no contiene evidencia suficiente para responder esa pregunta.",
  pt: "O vídeo selecionado não contém evidências suficientes para responder a essa pergunta.",
  it: "Il video selezionato non contiene prove sufficienti per rispondere a questa domanda.",
  fr: "La vidéo sélectionnée ne contient pas suffisamment de preuves pour répondre à cette question.",
  de: "Das ausgewählte Video enthält nicht genügend Belege, um diese Frage zu beantworten.",
  id: "Video yang dipilih tidak memuat bukti yang cukup untuk menjawab pertanyaan tersebut.",
  zh: "所选视频没有足够的证据来回答该问题。",
  "zh-TW": "所選影片沒有足夠的證據來回答該問題。",
  ja: "選択した動画には、その質問に答えるための十分な根拠がありません。",
  ko: "선택한 동영상에는 해당 질문에 답할 충분한 근거가 없습니다.",
  ar: "لا يحتوي الفيديو المحدد على أدلة كافية للإجابة عن هذا السؤال.",
  hi: "चुने गए वीडियो में उस प्रश्न का उत्तर देने के लिए पर्याप्त साक्ष्य नहीं हैं।",
  bn: "নির্বাচিত ভিডিওটিতে ওই প্রশ্নের উত্তর দেওয়ার জন্য যথেষ্ট প্রমাণ নেই।",
  ru: "В выбранном видео недостаточно доказательств, чтобы ответить на этот вопрос.",
  vi: "Video đã chọn không có đủ bằng chứng để trả lời câu hỏi đó.",
  tr: "Seçilen videoda bu soruyu yanıtlamak için yeterli kanıt yok.",
  th: "วิดีโอที่เลือกไม่มีหลักฐานเพียงพอที่จะตอบคำถามนั้น",
};

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
    rawResult.length > MAX_ANONYMOUS_TRIAL_RESULT_CHARS
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
    return {
      outcome: "accepted",
      kind: "refusal",
      text: REFUSAL_TEXT[parsed.data.language],
    };
  }

  const { answer, citations } = parsed.data;
  const uniqueCitations = new Set(citations);
  if (uniqueCitations.size !== citations.length) {
    return { outcome: "rejected" };
  }
  if (citations.some((citation) => !availableCitations.has(citation))) {
    return { outcome: "rejected" };
  }

  const answerCitations = answer.match(BRACKETED_TOKEN) ?? [];
  const textWithoutBracketedTokens = answer.replace(BRACKETED_TOKEN, "");
  if (
    textWithoutBracketedTokens.includes("[") ||
    textWithoutBracketedTokens.includes("]") ||
    answerCitations.length !== citations.length ||
    answerCitations.some(
      (citation, index) => citation !== citations[index],
    )
  ) {
    return { outcome: "rejected" };
  }

  return {
    outcome: "accepted",
    kind: "grounded_answer",
    text: answer,
  };
}
