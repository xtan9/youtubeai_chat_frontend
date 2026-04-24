import type { SupportedLanguageCode } from "@/lib/constants/languages";

// Walk the browser's declared language preferences (`navigator.languages` is
// ordered by user preference) and return the first one that's in our
// supported-set. Falls back to English when nothing matches — English is a
// safe default for the picker because our supported-set includes it and
// every user can read an English label in the dropdown.
//
// Kept as a pure function (no DOM reads) so it's unit-testable in node.
// The caller passes `navigator.languages` (or an explicit test fixture).
export function pickDefaultLanguage(
  navigatorLanguages: readonly string[],
  supported: readonly SupportedLanguageCode[]
): SupportedLanguageCode {
  const supportedSet = new Set<string>(supported);
  for (const raw of navigatorLanguages) {
    if (!raw) continue;
    // BCP-47 tags look like "en", "en-US", "zh-Hans-CN", "es-419". We only
    // care about the primary language subtag (the part before the first
    // hyphen) for matching against our 2-letter supported-set. Lowercase
    // because some browsers report mixed case.
    const primary = raw.toLowerCase().split("-")[0];
    if (supportedSet.has(primary)) {
      return primary as SupportedLanguageCode;
    }
  }
  return "en";
}
