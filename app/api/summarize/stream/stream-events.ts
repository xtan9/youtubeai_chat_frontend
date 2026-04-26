import type {
  CachedSummary,
  TranscriptSegment,
} from "@/lib/services/summarize-cache";
import type { LlmEvent } from "@/lib/services/llm-client";
import type { ClientStage } from "@/lib/stages";

export type SseEvent =
  | { type: "status"; message: string; stage: ClientStage }
  | { type: "content"; text: string }
  | {
      type: "metadata";
      category: "general";
      cached: boolean;
      title?: string;
      channel?: string;
    }
  | {
      type: "full_transcript";
      segments: readonly TranscriptSegment[];
    }
  | {
      type: "summary";
      category: "general";
      total_time: number;
      summarize_time: number;
      transcribe_time: number;
    }
  | { type: "error"; message: string };

export type SendEvent = (data: SseEvent) => void;

export function forwardLlmEvent(event: LlmEvent, sendEvent: SendEvent): void {
  switch (event.type) {
    case "status":
      sendEvent({ type: "status", message: event.message, stage: event.stage });
      return;
    case "content":
      sendEvent({ type: "content", text: event.text });
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
      console.error("[stream-events] unknown LlmEvent variant", { event });
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
  }
): void {
  sendEvent({
    type: "metadata",
    category: "general",
    cached: true,
    title: cached.title,
    channel: cached.channelName,
  });

  sendEvent({ type: "content", text: cached.summary });

  if (opts.includeTranscript && opts.segments && opts.segments.length > 0) {
    sendEvent({ type: "full_transcript", segments: opts.segments });
  }

  sendEvent({
    type: "summary",
    category: "general",
    total_time: cached.summarizeTimeSeconds + cached.transcribeTimeSeconds,
    summarize_time: cached.summarizeTimeSeconds,
    transcribe_time: cached.transcribeTimeSeconds,
  });
}
