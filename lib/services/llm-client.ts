import type { ClientStage } from "@/lib/stages";
import { SONNET, type KnownModel } from "./models";

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
  /**
   * Overrides LLM_MODEL env var when provided. `KnownModel | (string & {})`
   * autocompletes the sanctioned Claude IDs while still accepting arbitrary
   * strings for experimental env-var overrides.
   */
  readonly model?: KnownModel | (string & {});
}

// Per-stream cap: log once so a misbehaving gateway is visible without spamming
// every chunk. The counter is also load-bearing for the final branch — a
// non-zero value switches us from "closed without content" to the distinct
// "only malformed chunks" error.
const MAX_MALFORMED_WARNINGS = 1;

// Shared so cache-write and gateway request don't drift. Referenced against
// the shared `SONNET` constant so a model-ID bump in `./models` flows here
// automatically — not duplicated as a string literal.
export const DEFAULT_LLM_MODEL: KnownModel = SONNET;

/**
 * Throws on: HTTP error, missing config, no response body, empty completion
 * (prevents caching empty summaries), or mid-stream reader failure.
 */
export async function* streamLlmSummary(
  options: LlmStreamOptions
): AsyncGenerator<LlmEvent> {
  // Trim at every env-var HTTP-boundary read. Some env-var sources (Vercel
  // dashboard paste, .env files opened in editors that auto-newline) preserve
  // trailing whitespace verbatim. The control chars are invisible in log
  // viewers — a stray `\n` on a model ID or bearer token silently breaks
  // auth or returns a model-not-found at the upstream provider.
  const gatewayUrl = process.env.LLM_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY?.trim();
  // Normalize empty/whitespace-only to undefined on BOTH paths — `??` only
  // coalesces nullish, so without this an empty string ("") on either the
  // explicit options.model or the env var would slip through and be sent
  // to the gateway as `model: ""` (which some providers silently substitute
  // with a server default — a worst-of-all-worlds failure mode).
  const explicitModel = options.model?.trim() || undefined;
  const configuredModel = process.env.LLM_MODEL?.trim() || undefined;
  // Only surface the env-unset warning when the caller didn't pass a model
  // AND env is missing. Explicit model overrides never warn — route-level
  // routing will always pass one.
  const envMode = process.env.NODE_ENV;
  if (!explicitModel && !configuredModel && envMode !== "development" && envMode !== "test") {
    console.error("[llm-client] LLM_MODEL unset; using default", {
      errorId: "LLM_MODEL_MISSING",
      defaultModel: DEFAULT_LLM_MODEL,
      nodeEnv: envMode ?? null,
    });
  }
  const model = explicitModel ?? configuredModel ?? DEFAULT_LLM_MODEL;

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

export interface CallLlmJsonOptions {
  readonly model: KnownModel | (string & {});
  readonly prompt: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

// Default ceiling for non-streaming calls. A forgotten `timeoutMs` shouldn't
// let a classifier hang indefinitely and block the summarize stream —
// 30 seconds is a generous cap for a ~1K-token prompt.
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/**
 * Non-streaming gateway call. Returns the raw assistant content string —
 * callers parse and schema-validate. Kept separate from streamLlmSummary
 * because streaming plumbing is overkill for short classification calls.
 */
export async function callLlmJson(options: CallLlmJsonOptions): Promise<string> {
  const gatewayUrl = process.env.LLM_GATEWAY_URL?.trim();
  const gatewayKey = process.env.LLM_GATEWAY_API_KEY?.trim();
  if (!gatewayUrl || !gatewayKey) {
    throw new Error("LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY must be configured");
  }

  // Guard against bad inputs: NaN (e.g. parseInt of a missing env var),
  // Infinity, zero, negative — all of these would make AbortSignal.timeout
  // fire synchronously (or throw TypeError on NaN) before the fetch even
  // starts, surfacing as a bogus AbortError that masks the root cause
  // (likely a config typo). Fall back to the 30s default with a loud log
  // including the bad value so the caller notices.
  const requestedTimeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const isValidTimeout =
    Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 1;
  if (!isValidTimeout) {
    console.error("[llm-client] invalid timeoutMs — using default", {
      errorId: "LLM_GATEWAY_TIMEOUT_INVALID",
      requestedTimeoutMs,
      appliedTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
    });
  }
  const effectiveTimeoutMs = isValidTimeout
    ? requestedTimeoutMs
    : DEFAULT_CALL_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(
    `${gatewayUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: options.prompt }],
        // Deterministic decoding — this helper feeds schema-validated JSON
        // callers (e.g. classifyContent's Zod parse). Any variability would
        // translate directly into routing-decision flapping across otherwise
        // identical requests.
        temperature: 0,
      }),
      signal,
    }
  );

  if (!response.ok) {
    // Preserve the status as the primary error signal. A body-read failure
    // shouldn't silently swallow diagnostic context — log at error level
    // with a stable errorId so on-call can alert on the pattern and tell
    // "empty body" from "body read crashed" apart in postmortem.
    const text = await response.text().catch((err) => {
      console.error("[llm-client] failed to read error response body", {
        errorId: "LLM_GATEWAY_BODY_READ_FAILED",
        status: response.status,
        err,
      });
      return "";
    });
    throw new Error(`LLM gateway error (${response.status}): ${text}`);
  }

  const raw: unknown = await response.json();
  const content = (raw as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("LLM gateway response missing choices[0].message.content");
  }
  return content;
}
