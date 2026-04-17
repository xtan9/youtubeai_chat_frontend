import type { Language } from "./summarize-cache";

/**
 * Returns "zh" if the sample contains any CJK unified ideograph, "en" otherwise.
 * Used against video titles or the leading slice of a transcript.
 */
export function detectLanguage(text: string): Language {
  if (!text) return "en";
  return /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
}
