import "server-only";
import type { ChatGatewayMessage } from "@/lib/prompts/chat";
import { SONNET, type KnownModel } from "./models";

export type ChatLlmEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done" };

export interface ChatStreamOptions {
  readonly messages: readonly ChatGatewayMessage[];
  readonly signal?: AbortSignal;
  readonly model?: KnownModel | (string & {});
}

const MAX_MALFORMED_WARNINGS = 1;

/**
 * Stream a chat-completion from the OpenAI-compatible LLM gateway. Throws
 * on HTTP error, missing config, no response body.
 *
 * Yields `{type:"delta", text}` for each non-empty content chunk and a
 * single `{type:"done"}` after [DONE] (or on natural reader exhaustion).
 */
export async function* streamChatCompletion(
  options: ChatStreamOptions
): AsyncGenerator<ChatLlmEvent> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY?.trim();
  if (!gatewayUrl || !gatewayKey) {
    throw new Error("LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must be configured");
  }
  const explicitModel = options.model?.trim() || undefined;
  const configuredModel = process.env.LLM_MODEL?.trim() || undefined;
  const model = explicitModel ?? configuredModel ?? SONNET;

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
        messages: options.messages,
        stream: true,
        temperature: 0.4,
      }),
      signal: options.signal,
    }
  );
  if (!response.ok) {
    const bodyExcerpt = await response.text().catch(() => "");
    throw new Error(
      `[llm-chat-client] gateway ${response.status}: ${bodyExcerpt.slice(0, 200)}`
    );
  }
  if (!response.body) {
    throw new Error("[llm-chat-client] gateway returned no response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let malformedWarnings = 0;
  let receivedDone = false;
  try {
    while (!receivedDone) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          receivedDone = true;
          break;
        }
        if (payload.length === 0) continue;
        try {
          const evt = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const text = evt.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text.length > 0) {
            yield { type: "delta", text };
          }
        } catch (err) {
          if (malformedWarnings < MAX_MALFORMED_WARNINGS) {
            console.warn("[llm-chat-client] malformed chunk", {
              err,
              payloadExcerpt: payload.slice(0, 80),
            });
            malformedWarnings++;
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch (err) {
      // Spec'd failure modes are TypeError ("reader released" /
      // "pending read") fired when upstream cancel() raced ahead.
      // Swallow those; let anything else surface (a real defect).
      // The `name === "TypeError"` fallback covers cross-realm cases
      // where `instanceof TypeError` returns false even though the
      // error is structurally a TypeError (older polyfills, bundling
      // boundaries).
      const isTypeError =
        err instanceof TypeError ||
        (err instanceof Error && err.name === "TypeError");
      if (!isTypeError) throw err;
    }
  }
  yield { type: "done" };
}
