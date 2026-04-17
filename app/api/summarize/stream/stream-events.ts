import type { CachedSummary } from "@/lib/services/summarize-cache";
import type { LlmEvent } from "@/lib/services/llm-client";

export type SseEvent =
  | { type: "status"; message: string; stage?: string }
  | { type: "thinking"; text: string }
  | { type: "content"; text: string }
  | {
      type: "metadata";
      category: "general";
      cached: boolean;
      title?: string;
      channel?: string;
    }
  | { type: "full_transcript"; text: string }
  | {
      type: "summary";
      category: "general";
      total_time: number;
      summarize_time: number;
      transcribe_time: number;
    }
  | { type: "error"; message: string };

export type SendEvent = (data: SseEvent) => void;

export function forwardLlmEvent(
  event: LlmEvent,
  sendEvent: SendEvent,
  transcribeSeconds: number
): void {
  switch (event.type) {
    case "status":
      sendEvent({ type: "status", message: event.message, stage: event.stage });
      return;
    case "thinking":
      sendEvent({ type: "thinking", text: event.text });
      return;
    case "content":
      sendEvent({ type: "content", text: event.text });
      return;
    case "timing":
      sendEvent({
        type: "summary",
        category: "general",
        total_time: event.summarizeSeconds + transcribeSeconds,
        summarize_time: event.summarizeSeconds,
        transcribe_time: transcribeSeconds,
      });
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
export function streamCached(
  sendEvent: SendEvent,
  cached: CachedSummary,
  opts: { enableThinking: boolean; includeTranscript: boolean }
): void {
  sendEvent({
    type: "metadata",
    category: "general",
    cached: true,
    title: cached.title,
    channel: cached.channelName,
  });

  if (opts.enableThinking && cached.enableThinking && cached.thinking) {
    sendEvent({ type: "thinking", text: cached.thinking });
  }

  sendEvent({ type: "content", text: cached.summary });

  if (opts.includeTranscript && cached.transcript) {
    sendEvent({ type: "full_transcript", text: cached.transcript });
  }

  sendEvent({
    type: "summary",
    category: "general",
    total_time: cached.summarizeTimeSeconds + cached.transcribeTimeSeconds,
    summarize_time: cached.summarizeTimeSeconds,
    transcribe_time: cached.transcribeTimeSeconds,
  });
}
