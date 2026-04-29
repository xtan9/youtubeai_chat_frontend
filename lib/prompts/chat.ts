import type { ChatMessageRow } from "@/lib/services/chat-store";

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
 * transcript + summary are baked into the system message so they sit at
 * the front of the prompt — gateways that proxy to Anthropic with prompt
 * caching can mark this prefix as cacheable in a follow-up; for v1 we
 * pay the prefix tokens every turn, which is acceptable for typical
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
