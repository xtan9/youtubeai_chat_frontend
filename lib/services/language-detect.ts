import type { PromptLocale } from "./summarize-cache";

// Matches any CJK unified ideograph as a cheap proxy for "the prompt should
// be Chinese." Non-CJK (incl. Korean hangul) collapses to the English prompt —
// the only two prompt variants we currently ship.
//
// Japanese content containing kanji falls into the `zh` bucket on purpose: a
// Chinese-language prompt is a closer fit than the English one for mixed
// CJK content. Don't "fix" this regex by excluding kanji without shipping a
// dedicated `ja` prompt first — doing so would regress zh detection too.
export function detectLocale(text: string): PromptLocale {
  if (!text) return "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}
