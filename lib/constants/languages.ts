// Supported output languages for the summary language picker. The first
// 13 entries are the Anthropic-benchmarked high performers (≥90% on Haiku
// 4.5 per the published multilingual MMLU). The last four (Russian,
// Vietnamese, Turkish, Thai) aren't on the benchmark sheet but sit in
// YouTube's top-language markets and Claude handles them well anecdotally;
// flag in UI copy if we ever surface a "benchmarked vs not" distinction.
//
// Order is intentional: English first (our UI default), then the benchmarked
// set roughly sorted by benchmark score, then the unbenchmarked quartet.
// See docs/superpowers/specs/2026-04-24-summary-language-design.md.

export const SUPPORTED_OUTPUT_LANGUAGES = [
  { code: "en", english: "English", native: "English" },
  { code: "es", english: "Spanish", native: "Español" },
  { code: "pt", english: "Portuguese", native: "Português" },
  { code: "it", english: "Italian", native: "Italiano" },
  { code: "fr", english: "French", native: "Français" },
  { code: "de", english: "German", native: "Deutsch" },
  { code: "id", english: "Indonesian", native: "Bahasa Indonesia" },
  { code: "zh", english: "Chinese (Simplified)", native: "简体中文" },
  { code: "zh-TW", english: "Chinese (Traditional, Taiwan)", native: "繁體中文（台灣）" },
  { code: "ja", english: "Japanese", native: "日本語" },
  { code: "ko", english: "Korean", native: "한국어" },
  { code: "ar", english: "Arabic", native: "العربية" },
  { code: "hi", english: "Hindi", native: "हिन्दी" },
  { code: "bn", english: "Bengali", native: "বাংলা" },
  { code: "ru", english: "Russian", native: "Русский" },
  { code: "vi", english: "Vietnamese", native: "Tiếng Việt" },
  { code: "tr", english: "Turkish", native: "Türkçe" },
  { code: "th", english: "Thai", native: "ไทย" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_OUTPUT_LANGUAGES)[number];
export type SupportedLanguageCode = SupportedLanguage["code"];

// Kept as a tuple literal (not `readonly SupportedLanguageCode[]`) so zod's
// `.enum()` can infer the exact string-literal union without a cast at the
// call site. The runtime value is identical to the array form.
export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_OUTPUT_LANGUAGES.map(
  (l) => l.code
) as unknown as readonly [SupportedLanguageCode, ...SupportedLanguageCode[]];

const BY_CODE: ReadonlyMap<SupportedLanguageCode, SupportedLanguage> = new Map(
  SUPPORTED_OUTPUT_LANGUAGES.map((l) => [l.code, l])
);

export function isSupportedLanguageCode(
  value: string
): value is SupportedLanguageCode {
  return BY_CODE.has(value as SupportedLanguageCode);
}

export function getLanguage(
  code: SupportedLanguageCode
): SupportedLanguage {
  // Safe: SupportedLanguageCode is constrained to keys we built the map from.
  return BY_CODE.get(code)!;
}
