import "server-only";
import type { ChatGatewayMessage } from "@/lib/prompts/chat";
import { SPARK, type KnownModel } from "./models";
import { logAppEvent } from "@/lib/observability";

export type ChatTokenUsage = Readonly<{
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}>;

export type ChatLlmEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "usage"; readonly usage: ChatTokenUsage }
  | { readonly type: "done" };

export interface ChatStreamOptions {
  readonly messages: readonly ChatGatewayMessage[];
  readonly signal?: AbortSignal;
  readonly model?: KnownModel | (string & {});
  readonly maxOutputTokens?: number;
}

const MAX_MALFORMED_WARNINGS = 1;
const MAX_ACCOUNTED_TOKENS = 1_000_000;

function boundedTokenCount(value: unknown): number | null {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAX_ACCOUNTED_TOKENS
    ? (value as number)
    : null;
}

function parseUsage(value: unknown): ChatTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
  };
  const inputTokens = boundedTokenCount(usage.prompt_tokens);
  const outputTokens = boundedTokenCount(usage.completion_tokens);
  const cachedInputTokens = boundedTokenCount(
    usage.prompt_tokens_details?.cached_tokens ?? 0,
  );
  if (
    inputTokens === null ||
    outputTokens === null ||
    cachedInputTokens === null ||
    cachedInputTokens > inputTokens
  ) {
    return null;
  }
  return { inputTokens, cachedInputTokens, outputTokens };
}

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
  // Chat is intentionally pinned to Spark for every video and every turn.
  // Do not let a stale deployment-level LLM_MODEL value silently route chat
  // back to a different model after this rollout.
  const model = SPARK;

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
        stream_options: { include_usage: true },
        temperature: 0.4,
        ...(options.maxOutputTokens === undefined
          ? {}
          : { max_tokens: options.maxOutputTokens }),
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
            usage?: unknown;
          };
          const usage = parseUsage(evt.usage);
          if (usage) yield { type: "usage", usage };
          const text = evt.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text.length > 0) {
            yield { type: "delta", text };
          }
        } catch (err) {
          if (malformedWarnings < MAX_MALFORMED_WARNINGS) {
            logAppEvent("warn", "[llm-chat-client] malformed chunk", {
              errorId: "CHAT_LLM_MALFORMED_CHUNK",
              errorName: err instanceof Error ? err.name : typeof err,
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
