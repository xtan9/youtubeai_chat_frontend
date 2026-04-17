export type LlmEvent =
  | { readonly type: "status"; readonly message: string; readonly stage: string }
  | { readonly type: "thinking"; readonly text: string }
  | { readonly type: "content"; readonly text: string }
  | {
      readonly type: "timing";
      readonly summarizeSeconds: number;
      readonly transcribeSeconds: number;
    };

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

/**
 * Throws on: HTTP error, missing config, no response body, empty completion
 * (prevents caching empty summaries), or mid-stream reader failure.
 */
export async function* streamLlmSummary(
  options: LlmStreamOptions
): AsyncGenerator<LlmEvent> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY;
  const model = process.env.LLM_MODEL || "claude-sonnet-4-6";

  if (!gatewayUrl || !gatewayKey) {
    throw new Error("LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must be configured");
  }

  yield { type: "status", message: "Generating summary...", stage: "summarize" };

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

  const durationSeconds = (Date.now() - startTime) / 1000;
  yield {
    type: "timing",
    summarizeSeconds: durationSeconds,
    transcribeSeconds: 0,
  };
}
