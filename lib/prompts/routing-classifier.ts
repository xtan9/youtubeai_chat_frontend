// youtubeai_chat_frontend/lib/prompts/routing-classifier.ts

// Prompt for the Haiku-as-router classifier. Strict JSON-only with fixed
// enums. The caller (classifyContent) does NOT do cleanup — no markdown
// fence stripping, no prose extraction, no retries. Any deviation from
// strict JSON returns null and routing degrades to the token-count
// fallback. Reliability comes from graceful degradation, not from
// trusting the model to always comply.

export interface ClassifierPromptInput {
  readonly transcriptExcerpt: string;
  readonly title: string;
  readonly language: "en" | "zh";
}

function en(input: ClassifierPromptInput): string {
  return `You are classifying a YouTube video transcript excerpt so a downstream summarizer can pick the right LLM.

Respond with ONE JSON object and NOTHING else. No markdown fences, no commentary.

Schema:
{
  "density": "low" | "medium" | "high",
  "type": "tutorial" | "lecture" | "news" | "casual" | "interview" | "other",
  "structure": "structured" | "rambling"
}

Definitions:
- density: information density per minute. "high" = dense technical, jargon-heavy, or rapid-fire facts. "low" = casual chatter, filler, small talk. "medium" = mixed.
- type: closest match to the content shape. If uncertain, use "other".
- structure: "structured" = clear sections, progression, or agenda. "rambling" = free-flowing, tangential, unstructured.

Title: ${input.title}

Transcript excerpt:
${input.transcriptExcerpt}`;
}

function zh(input: ClassifierPromptInput): string {
  return `你正在为 YouTube 视频文字记录摘要做分类，以便下游摘要器选择合适的 LLM。

请仅回复一个 JSON 对象，不要包含任何其他内容。不要使用代码块标记，不要添加评论。

Schema:
{
  "density": "low" | "medium" | "high",
  "type": "tutorial" | "lecture" | "news" | "casual" | "interview" | "other",
  "structure": "structured" | "rambling"
}

定义：
- density（信息密度）：每分钟的信息密度。"high" = 高密度技术内容、专业术语密集、或快速事实陈述。"low" = 闲聊、填充、寒暄。"medium" = 混合。
- type（类型）：最接近的内容形式。不确定时使用 "other"。
- structure（结构）："structured" = 有清晰的章节、进度或议程。"rambling" = 自由发散、离题、无结构。

标题：${input.title}

文字记录节选：
${input.transcriptExcerpt}`;
}

export function buildClassifierPrompt(input: ClassifierPromptInput): string {
  return input.language === "zh" ? zh(input) : en(input);
}
