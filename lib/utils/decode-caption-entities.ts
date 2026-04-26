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

function decodeOnce(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => NAMED_XML_ENTITIES[m] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

export function decodeCaptionEntities(text: string): string {
  const once = decodeOnce(text);
  if (once === text) return once;
  return decodeOnce(once);
}
