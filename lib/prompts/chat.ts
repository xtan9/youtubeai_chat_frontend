import type { ChatMessageRow } from "@/lib/services/chat-store";

/**
 * Hard cap on how many prior turns the prompt builder includes. The route
 * truncates the persisted history to the last N messages before passing
 * it in here, so a long-running thread can't blow Claude's context window
 * or balloon per-turn cost. 16 ≈ 8 user/assistant pairs — comfortably
 * past the conversational horizon for follow-up Q&A on a single video.
 */
export const MAX_HISTORY_MESSAGES = 16;

export interface BuildChatPromptParams {
  readonly transcript: string;
  readonly summary: string;
  readonly history: readonly ChatMessageRow[];
  readonly userMessage: string;
  /**
   * When true, the synthetic primer (transcript + summary + rules) is
   * emitted as a content-array with `cache_control: ephemeral` on the
   * single block so an Anthropic-aware gateway can hit the prompt
   * cache for repeated chat turns on the same video. Default false —
   * the OpenAI-compat gateway (CLIProxyAPI) hasn't been verified to
   * pass cache_control through at the time of writing, and stripped
   * cache_control gracefully degrades to "no cache" rather than a
   * 4xx, so the flag-default-off rollout is safe to ship.
   */
  readonly cacheStablePrefix?: boolean;
}

/**
 * Anthropic-style content block. The OpenAI-compat surface accepts
 * `content` as either a string or an array of blocks; the array form
 * lets us tag the long, stable prefix with `cache_control` so a
 * forwarding gateway can pass it through to Anthropic's prompt cache.
 */
export interface ChatGatewayContentBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: { readonly type: "ephemeral" };
}

export interface ChatGatewayMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string | readonly ChatGatewayContentBlock[];
}

const CONTEXT_PRIMER_TEMPLATE = `I'm going to ask follow-up questions about this YouTube video. Use the transcript and summary below as your only source of truth.

Rules:
- Ground every claim in the transcript. If the transcript does not contain the answer, say so plainly.
- When citing a specific moment, include the timestamp in [mm:ss] format (or [hh:mm:ss] for videos longer than an hour). Use timestamps that appear or can be inferred from the transcript only — never invent them.
- Be concise. Match the language of my question.
- Do not pretend to play the video, click links, or take any action you cannot actually take.

Video summary:
{{SUMMARY}}

Full transcript:
{{TRANSCRIPT}}`;

const PRIMER_ACK =
  "Got it. I'll answer your questions about this video grounded in the transcript, and cite timestamps as [mm:ss] when relevant.";

/**
 * Build the OpenAI-compatible message array for the chat gateway.
 *
 * The OpenAI-compat gateway in front of Claude (CLIProxyAPI) is unreliable
 * about forwarding `role: "system"` messages — the model frequently
 * answered "I don't see any content to summarize" when the transcript
 * lived in a system message, mirroring an upstream-strip failure mode.
 * The summary pipeline avoids this by using a single user-role message
 * (lib/services/llm-client.ts), and we follow the same discipline here:
 * the transcript+summary+rules go in a synthetic FIRST user message,
 * followed by a synthetic assistant ack. The real chat history then
 * follows, ending with the user's new question. The model treats the
 * primer as "the conversation already started with this context" and
 * answers from it correctly.
 */
export function buildChatMessages(
  params: BuildChatPromptParams
): readonly ChatGatewayMessage[] {
  const primer = CONTEXT_PRIMER_TEMPLATE.replace(
    "{{SUMMARY}}",
    params.summary
  ).replace("{{TRANSCRIPT}}", params.transcript);
  // The primer is the cache target — it's the long, stable prefix
  // (transcript + summary + rules) that repeats verbatim across every
  // chat turn for a given (user, video). Emit it as a content-array
  // with cache_control on the lone block when caching is enabled;
  // otherwise emit as a plain string so the wire shape exactly matches
  // the prior, verified behavior.
  const primerMessage: ChatGatewayMessage = params.cacheStablePrefix
    ? {
        role: "user",
        content: [
          {
            type: "text",
            text: primer,
            cache_control: { type: "ephemeral" },
          },
        ],
      }
    : { role: "user", content: primer };
  const history = params.history.map<ChatGatewayMessage>((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [
    primerMessage,
    { role: "assistant", content: PRIMER_ACK },
    ...history,
    { role: "user", content: params.userMessage },
  ];
}
