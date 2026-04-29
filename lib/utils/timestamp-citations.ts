export type CitationPart =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "timestamp";
      readonly raw: string;
      readonly seconds: number;
    };

// Match [mm:ss] or [hh:mm:ss]. The bracket boundaries make false positives
// like "in 2:30 minutes" (without brackets) safe.
const TIMESTAMP_RE = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]/g;

/**
 * Parse a string into alternating text + timestamp parts. Timestamps that
 * fail validation (minute/second components out of range) are kept as plain
 * text so the user sees the model's literal output rather than us silently
 * dropping a malformed citation.
 *
 * Pure function — safe to call from render.
 */
export function parseCitations(input: string): CitationPart[] {
  const parts: CitationPart[] = [];
  let lastIndex = 0;
  for (const m of input.matchAll(TIMESTAMP_RE)) {
    const idx = m.index ?? 0;
    if (idx > lastIndex) {
      parts.push({ type: "text", value: input.slice(lastIndex, idx) });
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    const c = m[3] !== undefined ? Number(m[3]) : null;
    const valid =
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      b < 60 &&
      (c === null || (Number.isFinite(c) && c < 60));
    if (valid) {
      const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c;
      parts.push({ type: "timestamp", raw: m[0], seconds });
    } else {
      parts.push({ type: "text", value: m[0] });
    }
    lastIndex = idx + m[0].length;
  }
  if (lastIndex < input.length) {
    parts.push({ type: "text", value: input.slice(lastIndex) });
  }
  return parts;
}

/**
 * Format seconds back to [mm:ss] or [hh:mm:ss] for display when we
 * synthesize a chip from a number rather than parsed text.
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const mmStr = String(mm).padStart(2, "0");
  const ssStr = String(ss).padStart(2, "0");
  if (hh > 0) {
    const hhStr = String(hh).padStart(2, "0");
    return `[${hhStr}:${mmStr}:${ssStr}]`;
  }
  return `[${mm}:${ssStr}]`;
}
