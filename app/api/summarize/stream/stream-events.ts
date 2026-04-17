import type { CachedSummary } from "@/lib/services/summarize-cache";
import type { LlmEvent } from "@/lib/services/llm-client";

export type SendEvent = (data: Record<string, unknown>) => void;

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
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// Event order must match a fresh run so the client accumulator renders cache
// hits identically to live streams. Totals use the same summarize+transcribe
// model as the live path so frontend displays are consistent.
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
