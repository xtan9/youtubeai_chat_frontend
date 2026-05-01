import type { SupportedLanguageCode } from "@/lib/constants/languages";

// BCP-47 tag → supported code, applied before the primary-subtag fallback.
// Keep keys lowercase to match the lowercased navigator tag.
const TAG_ALIASES: Readonly<Record<string, SupportedLanguageCode>> = {
  "zh-tw": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  "zh-hant": "zh-TW",
};

// Walk the browser's declared language preferences (`navigator.languages`
// is ordered by user preference) and return the first one that matches
// our supported set. Match priority for each navigator tag:
//
//   1. Exact match against the supported set (case-insensitive).
//      "zh-tw" → "zh-TW" when "zh-TW" is supported.
//   2. Full-tag alias substitution. "zh-hk" → "zh-TW".
//   3. Script-stripped alias. "zh-hant-cn" → "zh-TW" via "zh-hant".
//   4. Primary-subtag fallback. "zh-cn" → "zh", "en-US" → "en", "es-419" → "es".
//
// Falls back to English if nothing matches — English is in the supported
// set and every user can read an English label in the dropdown.
export function pickDefaultLanguage(
  navigatorLanguages: readonly string[],
  supported: readonly SupportedLanguageCode[]
): SupportedLanguageCode {
  const supportedSet = new Set<string>(supported);

  for (const raw of navigatorLanguages) {
    if (!raw) continue;
    // Lowercase + normalize POSIX-style underscore separators ("zh_TW" from
    // some Android WebViews / Electron hosts) so they hit the same alias /
    // fallback paths as the BCP-47 hyphenated form.
    const tag = raw.toLowerCase().replace(/_/g, "-");

    // Walk the supported set so an exact match returns its canonical
    // casing — e.g. "zh-tw" → "zh-TW".
    const exact = supported.find((c) => c.toLowerCase() === tag);
    if (exact) return exact;

    const fullAlias = TAG_ALIASES[tag];
    if (fullAlias) return fullAlias;

    // Try progressively shorter prefixes so "zh-hant-cn" finds the
    // "zh-hant" alias before the primary-subtag fallback would have
    // collapsed it to "zh".
    const parts = tag.split("-");
    for (let len = parts.length - 1; len >= 2; len--) {
      const prefix = parts.slice(0, len).join("-");
      const aliased = TAG_ALIASES[prefix];
      if (aliased) return aliased;
    }

    const primary = parts[0];
    if (supportedSet.has(primary)) {
      return primary as SupportedLanguageCode;
    }
  }

  return "en";
}
