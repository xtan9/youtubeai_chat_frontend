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
}

export interface ChatGatewayMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

const SYSTEM_PROMPT_TEMPLATE = `You are a helpful assistant answering questions about a specific YouTube video. The video's transcript and summary are provided below.

Rules:
- Ground every claim in the transcript. If the transcript does not contain the answer, say so plainly.
- When citing a specific moment, include the timestamp in [mm:ss] format (or [hh:mm:ss] for videos longer than an hour). Use timestamps that appear or can be inferred from the transcript only — never invent them.
- Be concise. Match the language of the user's question.
- Do not pretend to play the video, click links, or take any action you cannot actually take.

Video summary:
{{SUMMARY}}

Full transcript:
{{TRANSCRIPT}}`;

/**
 * Build the OpenAI-compatible message array for the chat gateway. The
 * transcript + summary are front-loaded in the system message so the
 * prefix can be prompt-cached if the gateway gains that knob; for v1
 * the cost of paying the prefix every turn is acceptable for typical
 * YouTube content lengths.
 */
export function buildChatMessages(
  params: BuildChatPromptParams
): readonly ChatGatewayMessage[] {
  const system = SYSTEM_PROMPT_TEMPLATE.replace(
    "{{SUMMARY}}",
    params.summary
  ).replace("{{TRANSCRIPT}}", params.transcript);
  const history = params.history.map<ChatGatewayMessage>((m) => ({
    role: m.role,
    content: m.content,
  }));
  return [
    { role: "system", content: system },
    ...history,
    { role: "user", content: params.userMessage },
  ];
}
