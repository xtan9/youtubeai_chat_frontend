import type { ClientStage } from "@/lib/stages";

export type LlmEvent =
  | {
      readonly type: "status";
      readonly message: string;
      readonly stage: ClientStage;
    }
  | { readonly type: "thinking"; readonly text: string }
  | { readonly type: "content"; readonly text: string }
  | { readonly type: "timing"; readonly summarizeSeconds: number };

export function formatSseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export interface LlmStreamOptions {
  readonly prompt: string;
  readonly enableThinking: boolean;
  readonly signal?: AbortSignal;
}

// Per-stream cap: log once so a misbehaving gateway is visible without spamming
// every chunk. The counter is also load-bearing for the final branch — a
// non-zero value switches us from "closed without content" to the distinct
// "only malformed chunks" error.
const MAX_MALFORMED_WARNINGS = 1;

// Shared so cache-write and gateway request don't drift.
export const DEFAULT_LLM_MODEL = "claude-sonnet-4-6";

/**
 * Throws on: HTTP error, missing config, no response body, empty completion
 * (prevents caching empty summaries), or mid-stream reader failure.
 */
export async function* streamLlmSummary(
  options: LlmStreamOptions
): AsyncGenerator<LlmEvent> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY;
  const configuredModel = process.env.LLM_MODEL;
  // Deploys outside dev/test that haven't set LLM_MODEL are almost always
  // misconfigured — running on the default model with no billing awareness
  // is expensive to discover later. Inverting the gate (log UNLESS dev/test)
  // covers the "NODE_ENV unset in prod" misconfig that a === "production"
  // check would silently pass through.
  const envMode = process.env.NODE_ENV;
  if (!configuredModel && envMode !== "development" && envMode !== "test") {
    console.error("[llm-client] LLM_MODEL unset; using default", {
      errorId: "LLM_MODEL_MISSING",
      defaultModel: DEFAULT_LLM_MODEL,
      nodeEnv: envMode ?? null,
    });
  }
  const model = configuredModel || DEFAULT_LLM_MODEL;

  if (!gatewayUrl || !gatewayKey) {
    throw new Error("LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must be configured");
  }

  yield {
    type: "status",
    message: "Generating summary...",
    stage: "summarize",
  };

  const startTime = Date.now();

  const response = await fetch(
    `${gatewayUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: options.prompt }],
        stream: true,
        // Low-temperature decoding tuned for summarization determinism:
        // repeated summaries of the same video should be near-identical so
        // cache hits and live runs read the same. Raise only if product
        // wants variety.
        temperature: 0.1,
        top_p: 0.9,
      }),
      signal: options.signal,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM gateway error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from LLM gateway");

  const decoder = new TextDecoder();
  let buffer = "";
  let malformedChunks = 0;
  let malformedLogged = 0;
  let anyContentSeen = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        let chunk: {
          choices?: Array<{
            delta?: { content?: unknown; reasoning_content?: unknown };
          }>;
        };
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          malformedChunks++;
          if (malformedLogged < MAX_MALFORMED_WARNINGS) {
            console.warn(
              "[llm-client] malformed SSE chunk (suppressing further)",
              { preview: jsonStr.slice(0, 120) }
            );
            malformedLogged++;
          }
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (
          typeof delta.reasoning_content === "string" &&
          delta.reasoning_content.length > 0 &&
          options.enableThinking
        ) {
          yield { type: "thinking", text: delta.reasoning_content };
        }

        if (typeof delta.content === "string" && delta.content.length > 0) {
          anyContentSeen = true;
          yield { type: "content", text: delta.content };
        }
      }
    }
  } catch (err) {
    if (anyContentSeen) {
      throw new Error(
        `LLM gateway stream dropped after partial content: ${
          err instanceof Error ? err.message : String(err)
        }`,
        { cause: err }
      );
    }
    throw err;
  }

  if (!anyContentSeen) {
    if (malformedChunks > 0) {
      throw new Error(
        "LLM gateway produced only malformed SSE chunks (no content)"
      );
    }
    throw new Error("LLM gateway closed the stream without producing content");
  }

  // Even when the stream succeeds, a non-zero malformed count is a gateway
  // health signal — the user got content, but the deploy may be dropping a
  // meaningful fraction of it. Surface the final count so on-call can alert
  // on the pattern without relying on the suppressed per-chunk logs.
  if (malformedChunks > 0) {
    console.error("[llm-client] stream completed with malformed chunks", {
      errorId: "LLM_MALFORMED_CHUNKS",
      malformedChunks,
      contentReceived: true,
    });
  }

  const durationSeconds = (Date.now() - startTime) / 1000;
  yield {
    type: "timing",
    summarizeSeconds: durationSeconds,
  };
}
