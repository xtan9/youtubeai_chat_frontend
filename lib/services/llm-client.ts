export function formatSseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export interface LlmStreamOptions {
  prompt: string;
  enableThinking: boolean;
}

/**
 * Stream a chat completion from llm-gateway and yield SSE-formatted events.
 * Translates OpenAI streaming format into the SSE event format the frontend expects.
 */
export async function* streamLlmSummary(
  options: LlmStreamOptions
): AsyncGenerator<string> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL;
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY;
  const model = process.env.LLM_MODEL || "claude-sonnet-4-6";

  if (!gatewayUrl || !gatewayKey) {
    throw new Error("LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must be configured");
  }

  yield formatSseEvent({ type: "metadata", category: "general", cached: false });
  yield formatSseEvent({
    type: "status",
    message: "Generating summary...",
    stage: "summarize",
  });

  const startTime = Date.now();

  const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/chat/completions`, {
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
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM gateway error (${response.status}): ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from LLM gateway");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Claude extended thinking (reasoning_content field)
        if (delta.reasoning_content) {
          if (options.enableThinking) {
            yield formatSseEvent({
              type: "thinking",
              text: delta.reasoning_content,
            });
          }
        }

        // Regular content
        if (delta.content) {
          yield formatSseEvent({ type: "content", text: delta.content });
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }

  const durationSeconds = (Date.now() - startTime) / 1000;

  yield formatSseEvent({
    type: "summary",
    category: "general",
    total_time: durationSeconds,
    summarize_time: durationSeconds,
    transcribe_time: 0,
  });
}
