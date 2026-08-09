import type {
  CachedSummary,
  TranscriptSegment,
  TranscriptSource,
} from "@/lib/services/summarize-cache";
import type { LlmEvent } from "@/lib/services/llm-client";
import { logAppEvent } from "@/lib/observability";
import { hasTimedTranscriptSegments } from "@/lib/types";
import {
  SummarySseEventSchema,
  type SummarySseEvent,
} from "@/lib/api-contracts/summary";

export type SseEvent = SummarySseEvent;

export type SendEvent = (data: SseEvent) => void;

/** Validate before handing an event to the server Summary Run wire emitter. */
export function validateSummarySseEvent(event: unknown): SseEvent {
  return SummarySseEventSchema.parse(event);
}

function emitSummaryEvent(sendEvent: SendEvent, event: unknown): void {
  sendEvent(validateSummarySseEvent(event));
}

export function forwardLlmEvent(event: LlmEvent, sendEvent: SendEvent): void {
  switch (event.type) {
    case "status":
      emitSummaryEvent(sendEvent, {
        type: "status",
        message: event.message,
        stage: event.stage,
      });
      return;
    case "content":
      emitSummaryEvent(sendEvent, { type: "content", text: event.text });
      return;
    case "timing":
      // Intentionally no SSE emit. The route owns the single terminal
      // `summary` event (live + cached paths emit exactly one each). If you
      // add logic here, you will double-emit on the live path — see the
      // `emits exactly one terminal summary event` test.
      return;
    default: {
      // Compile-time exhaustiveness via `never`; runtime log in case a future
      // LlmEvent variant reaches here without this file being updated.
      logAppEvent("error", "[stream-events] unknown LlmEvent variant", {
        errorId: "LLM_EVENT_UNKNOWN",
      });
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// Event order must match a fresh run so the client accumulator renders cache
// hits identically to live streams.
//
// `segments` carry the per-line playback timing the frontend uses to render
// clickable timestamps. They live in a separate cache row (video_transcripts)
// from the per-language summary, so the route looks them up separately and
// passes them in. When omitted (or empty), the full_transcript event is
// skipped — the same fail-soft behaviour as the live path when a transcript
// was never persisted.
export function streamCached(
  sendEvent: SendEvent,
  cached: CachedSummary,
  opts: {
    includeTranscript: boolean;
    segments?: readonly TranscriptSegment[];
    source?: TranscriptSource;
    title?: string;
    channelName?: string;
    transcribeTimeSeconds?: number;
  }
): void {
  const transcribeTimeSeconds =
    opts.transcribeTimeSeconds ?? cached.transcribeTimeSeconds;
  emitSummaryEvent(sendEvent, {
    type: "metadata",
    category: "general",
    cached: true,
    title: opts.title ?? cached.title,
    channel: opts.channelName ?? cached.channelName,
  });

  emitSummaryEvent(sendEvent, { type: "content", text: cached.summary });

  if (
    opts.includeTranscript &&
    opts.segments &&
    hasTimedTranscriptSegments(opts.segments)
  ) {
    emitSummaryEvent(sendEvent, {
      type: "full_transcript",
      segments: opts.segments,
      source: opts.source ?? cached.transcriptSource,
    });
  }

  emitSummaryEvent(sendEvent, {
    type: "summary",
    category: "general",
    total_time: cached.summarizeTimeSeconds + transcribeTimeSeconds,
    summarize_time: cached.summarizeTimeSeconds,
    transcribe_time: transcribeTimeSeconds,
  });
}
