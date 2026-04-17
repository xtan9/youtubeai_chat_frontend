import type { PromptLocale } from "./summarize-cache";

// Matches any CJK unified ideograph as a cheap proxy for "the prompt should
// be Chinese." Non-CJK (incl. Japanese/Korean) collapses to the English prompt
// — the only two prompt variants we currently ship.
export function detectLocale(text: string): PromptLocale {
  if (!text) return "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}
