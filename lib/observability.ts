import { extractVideoId } from "./services/youtube-url";

type LogLevel = "error" | "warn" | "info";

// Keep application logs useful without passing arbitrary provider errors or
// generated content through a generic logger. In particular, never log
// bearer tokens, full YouTube URLs, Transcript text, Summary text, or Chat
// content from the transcription-to-summary pipeline.
const SAFE_FIELDS = new Set([
  "event",
  "requestId",
  "errorId",
  "stage",
  "status",
  "videoId",
  "userId",
  "isAnonymous",
  "model",
  "reason",
  "tokens",
  "wordCount",
  "classifierRan",
  "dimensions",
  "source",
  "phase",
  "transcriptSource",
  "nativeLanguage",
  "lang",
  "hasTitle",
  "hasChannel",
  "outputLanguage",
  "pgCode",
  "errorName",
  "errorClass",
  "aborted",
  "audioSeconds",
  "fallbackCap",
  "groqStatus",
  "compressKind",
  "malformedChunks",
  "contentReceived",
  "requestedTimeoutMs",
  "appliedTimeoutMs",
  "originalLength",
  "truncatedLength",
  "droppedChars",
  "charBudget",
  "chunkBytes",
  "droppedCount",
  "totalCount",
  "defaultModel",
  "nodeEnv",
  "errorCode",
  "tier",
  "hasUrl",
  "hasKey",
  "count",
]);

const URL_PATTERN = /https?:\/\/\S+/gi;

function sanitizeValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(URL_PATTERN, "[redacted-url]").slice(0, 120);
}

export function redactSensitiveText(value: string): string {
  return value.replace(URL_PATTERN, "[redacted-url]").slice(0, 120);
}

export function redactLogFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([key]) => SAFE_FIELDS.has(key))
      .map(([key, value]) => [key, sanitizeValue(value)])
  );
}

export function videoIdForLog(youtubeUrl: string): string {
  return extractVideoId(youtubeUrl) ?? "unknown";
}

export function logAppEvent(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const safeFields = redactLogFields(fields);
  if (level === "error") {
    console.error(event, safeFields);
  } else if (level === "warn") {
    console.warn(event, safeFields);
  } else {
    console.info(event, safeFields);
  }
}
