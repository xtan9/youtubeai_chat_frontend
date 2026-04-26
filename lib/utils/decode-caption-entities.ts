// Decode the XML entities that survive `youtube-transcript-plus`'s single
// pass on caption-track text. The library covers `&amp; &lt; &gt; &quot;
// &apos; &#39;` once; YouTube sometimes emits double-encoded forms
// (`&amp;#39;` survives the first pass as `&#39;`) and the library skips
// hex (`&#x27;`) and arbitrary decimal entities (`&#8212;`) entirely.
// Without this defense, undecoded text reaches React, which escapes the
// leading `&` on render and the user sees "I&#39;m" instead of "I'm".
//
// Used by both the VPS-client (fresh captions) and the cache-read path
// (rows persisted before the VPS-side fix landed) so the same text
// regression converges from both directions.
//
// Bounded to two passes — enough to unwrap `&amp;<entity>;` without
// looping forever on adversarial input that happens to keep producing
// entity-shaped substrings. Whisper output is plain text; this is a
// no-op on those segments.
const NAMED_XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
};

// `String.fromCodePoint` throws `RangeError` for values > 0x10FFFF (e.g.
// the adversarial `&#999999999999;`). A defensive decoder must never
// throw — a single malformed entity would otherwise crash an entire
// transcript fetch and re-bill the LLM gateway. Return the original
// match unchanged when the codepoint is out of range so the caller
// sees the raw entity text instead of a 500.
const MAX_UNICODE_CODEPOINT = 0x10ffff;
function safeFromCodePoint(cp: number, originalMatch: string): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > MAX_UNICODE_CODEPOINT) {
    return originalMatch;
  }
  try {
    return String.fromCodePoint(cp);
  } catch {
    return originalMatch;
  }
}

function decodeOnce(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => NAMED_XML_ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) =>
      safeFromCodePoint(parseInt(hex, 16), m)
    )
    .replace(/&#(\d+);/g, (m, dec) =>
      safeFromCodePoint(parseInt(dec, 10), m)
    );
}

export function decodeCaptionEntities(text: string): string {
  const once = decodeOnce(text);
  if (once === text) return once;
  return decodeOnce(once);
}
