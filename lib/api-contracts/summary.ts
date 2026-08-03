import { z } from "zod";
import { SUPPORTED_LANGUAGE_CODES } from "@/lib/constants/languages";
import { TranscriptSegmentSchema } from "@/lib/types";
import { YouTubeUrlSchema } from "@/lib/services/transcription-contract";

// ---------------- Request body ----------------

/**
 * Runtime contract for the body accepted by POST /api/summarize/stream.
 *
 * Keep the default and optionality here in sync with the endpoint's existing
 * semantics: omitted `include_transcript` means false, while omitted
 * `output_language` means the video's native-language summary.
 */
export const SummaryRequestSchema = z.object({
  youtube_url: YouTubeUrlSchema,
  include_transcript: z.boolean().optional().default(false),
  output_language: z.enum(SUPPORTED_LANGUAGE_CODES).optional(),
});
export type SummaryRequest = z.infer<typeof SummaryRequestSchema>;

// ---------------- SSE events ----------------

const SummaryClientStageSchema = z.enum(["transcribe", "summarize"]);
const SummaryTranscriptSourceSchema = z.enum([
  "manual_captions",
  "auto_captions",
  "whisper",
]);
const SummaryCategorySchema = z.literal("general");

export const SummarySseStatusSchema = z
  .object({
    type: z.literal("status"),
    message: z.string(),
    stage: SummaryClientStageSchema,
  })
  .strict();

export const SummarySseContentSchema = z
  .object({
    type: z.literal("content"),
    text: z.string(),
  })
  .strict();

export const SummarySseMetadataSchema = z
  .object({
    type: z.literal("metadata"),
    category: SummaryCategorySchema,
    // Required on both paths so the client can distinguish a generated
    // stream from a cache hit using validated metadata rather than inference.
    cached: z.boolean(),
    title: z.string().optional(),
    channel: z.string().optional(),
  })
  .strict();

export const SummarySseFullTranscriptSchema = z
  .object({
    type: z.literal("full_transcript"),
    segments: z.array(TranscriptSegmentSchema).min(1).readonly(),
    source: SummaryTranscriptSourceSchema,
  })
  .strict();

export const SummarySseSummarySchema = z
  .object({
    type: z.literal("summary"),
    category: SummaryCategorySchema,
    total_time: z.number().finite().nonnegative(),
    summarize_time: z.number().finite().nonnegative(),
    transcribe_time: z.number().finite().nonnegative(),
  })
  .strict();

export const SummarySseErrorSchema = z
  .object({
    type: z.literal("error"),
    message: z.string(),
    errorId: z.string().optional(),
  })
  .strict();

export const SummarySseEventSchema = z.discriminatedUnion("type", [
  SummarySseStatusSchema,
  SummarySseContentSchema,
  SummarySseMetadataSchema,
  SummarySseFullTranscriptSchema,
  SummarySseSummarySchema,
  SummarySseErrorSchema,
]);
export type SummarySseEvent = z.infer<typeof SummarySseEventSchema>;

export type SummarySseEventType = SummarySseEvent["type"];
export const SUPPORTED_SUMMARY_EVENT_TYPES = [
  "status",
  "content",
  "metadata",
  "full_transcript",
  "summary",
  "error",
] as const satisfies readonly SummarySseEventType[];

// ---------------- Wire parsing ----------------

export type SummaryStreamProtocolErrorCode =
  | "malformed_json"
  | "unknown_event_variant"
  | "invalid_event"
  | "invalid_full_transcript";

const PROTOCOL_ERROR_MESSAGES: Record<
  SummaryStreamProtocolErrorCode,
  string
> = {
  malformed_json: "Summary stream contained malformed JSON.",
  unknown_event_variant: "Summary stream contained an unknown event.",
  invalid_event: "Summary stream contained an invalid event.",
  invalid_full_transcript:
    "Summary stream contained an invalid full transcript.",
};

/** A stable, inspectable error for client-side protocol failures. */
export class SummaryStreamProtocolError extends Error {
  readonly name = "SummaryStreamProtocolError";
  /** `kind` is an ergonomic alias for callers that classify protocol errors. */
  readonly kind: SummaryStreamProtocolErrorCode;

  constructor(
    readonly code: SummaryStreamProtocolErrorCode,
    cause?: unknown,
  ) {
    super(PROTOCOL_ERROR_MESSAGES[code]);
    this.kind = code;
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        value: cause,
      });
    }
  }
}

function eventTypeOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return "type" in value
    ? (value as { type?: unknown }).type
    : undefined;
}

/**
 * Parse and validate one JSON payload from an SSE `data:` line.
 *
 * The discriminator is classified before the full schema so an invalid
 * transcript payload cannot be accidentally treated like an ordinary event
 * failure. Unknown discriminators also get their own stable classification.
 */
export function parseSummarySsePayload(payload: string): SummarySseEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch (error) {
    throw new SummaryStreamProtocolError("malformed_json", error);
  }

  const type = eventTypeOf(raw);
  if (
    typeof type === "string" &&
    !(SUPPORTED_SUMMARY_EVENT_TYPES as readonly string[]).includes(type)
  ) {
    throw new SummaryStreamProtocolError("unknown_event_variant");
  }

  const parsed = SummarySseEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SummaryStreamProtocolError(
      type === "full_transcript" ? "invalid_full_transcript" : "invalid_event",
      parsed.error,
    );
  }
  return parsed.data;
}

function parseSummarySseFrame(frame: string): SummarySseEvent {
  const lines = frame.split("\n");
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  const hasUnexpectedField = lines.some(
    (line) => line.length > 0 && !line.startsWith("data:"),
  );

  if (dataLines.length !== 1 || hasUnexpectedField) {
    throw new SummaryStreamProtocolError("invalid_event");
  }

  return parseSummarySsePayload(dataLines[0].slice("data:".length).trim());
}

/**
 * Incremental SSE decoder used by the browser consumer. It validates only
 * complete frames during `push`, so a network chunk may split an event safely;
 * `finish` validates any final frame and rejects an incomplete/malformed tail.
 */
export class SummarySseStreamDecoder {
  private buffer = "";

  push(chunk: string): SummarySseEvent[] {
    this.buffer = `${this.buffer}${chunk}`.replace(/\r\n/g, "\n");
    const events: SummarySseEvent[] = [];

    while (true) {
      const separator = this.buffer.indexOf("\n\n");
      if (separator < 0) break;

      const frame = this.buffer.slice(0, separator);
      this.buffer = this.buffer.slice(separator + 2);
      if (frame.trim().length === 0) continue;
      events.push(parseSummarySseFrame(frame));
    }

    return events;
  }

  finish(): SummarySseEvent[] {
    const remainder = this.buffer;
    this.buffer = "";
    if (remainder.trim().length === 0) return [];
    return [parseSummarySseFrame(remainder)];
  }
}

/** Serialize only a schema-valid event onto the Summary SSE wire. */
export function formatSummarySseEvent(event: unknown): string {
  const validated = SummarySseEventSchema.parse(event);
  return `data: ${JSON.stringify(validated)}\n\n`;
}
