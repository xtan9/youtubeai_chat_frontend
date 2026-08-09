export type CitationPart =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "timestamp";
      readonly raw: string;
      readonly seconds: number;
      readonly endSeconds?: number;
    };

// Match [mm:ss], [hh:mm:ss], or a range containing either shape. The bracket
// boundaries make false positives like "in 2:30 minutes" (without brackets)
// safe. Ranges accept the common hyphen, en dash, and em dash separators.
const TIMESTAMP_VALUE = String.raw`\d{1,2}:\d{2}(?::\d{2})?`;
const TIMESTAMP_RE = new RegExp(
  String.raw`\[(${TIMESTAMP_VALUE})(?:\s*[-–—]\s*(${TIMESTAMP_VALUE}))?\]`,
  "g",
);

function parseTimestampValue(value: string): number | null {
  const components = value.split(":").map(Number);
  if (components.length === 2) {
    const [minutes, seconds] = components;
    return seconds < 60 ? minutes * 60 + seconds : null;
  }

  const [hours, minutes, seconds] = components;
  return minutes < 60 && seconds < 60
    ? hours * 3600 + minutes * 60 + seconds
    : null;
}

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
    const startSeconds = parseTimestampValue(m[1]);
    const endSeconds = m[2] ? parseTimestampValue(m[2]) : null;
    const validRange =
      !m[2] ||
      (startSeconds !== null &&
        endSeconds !== null &&
        endSeconds >= startSeconds);
    if (startSeconds !== null && validRange) {
      parts.push(
        endSeconds === null
          ? { type: "timestamp", raw: m[0], seconds: startSeconds }
          : {
              type: "timestamp",
              raw: m[0],
              seconds: startSeconds,
              endSeconds,
            },
      );
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
