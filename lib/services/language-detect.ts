/**
 * Detect language from video title.
 * Checks for Chinese characters (CJK Unified Ideographs range).
 * Returns "zh" if any Chinese characters found, "en" otherwise.
 */
export function detectLanguage(title: string): "en" | "zh" {
  if (!title) return "en";
  const chinesePattern = /[\u4e00-\u9fff]/;
  return chinesePattern.test(title) ? "zh" : "en";
}
