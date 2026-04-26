import type { TranscriptSegment } from "@/lib/types";

/**
 * One paragraph rendered in the transcript view: the concatenation of
 * several consecutive `TranscriptSegment`s grouped by playback duration
 * and (where possible) ending on a sentence boundary.
 */
export interface TranscriptParagraph {
  /** Start time of the first segment, in seconds. Used to seek the player. */
  readonly start: number;
  /** End time of the last segment (start + duration). Used for highlight. */
  readonly end: number;
  /** Concatenated text of all constituent segments, single-space joined. */
  readonly text: string;
}

const SENTENCE_END_RE = /[.!?。！？](["')\]]*)$/;
export const DEFAULT_TARGET_DURATION_SECONDS = 30;
// Hard cap so a paragraph never grows past 2× target when the model never
// emits sentence-final punctuation (looking at you, Whisper for music).
export const PARAGRAPH_HARD_CAP_MULTIPLIER = 2;

/**
 * Group raw transcript segments into ~`targetDurationSeconds`-long paragraphs.
 *
 * Greedy: accumulates segments until the running duration ≥ target AND the
 * current segment's text ends on a sentence boundary. Falls through to a
 * hard cap (2× target) so a transcript without punctuation can't degenerate
 * into a single 30-minute "paragraph."
 *
 * Pure function — same input always produces the same output. The transcript
 * UI calls this at render time so the chunking is never persisted (the cache
 * stores raw segments, never these display chunks).
 */
export function groupSegments(
  segments: readonly TranscriptSegment[],
  targetDurationSeconds = DEFAULT_TARGET_DURATION_SECONDS
): TranscriptParagraph[] {
  if (segments.length === 0) return [];

  const hardCap = targetDurationSeconds * PARAGRAPH_HARD_CAP_MULTIPLIER;
  const paragraphs: TranscriptParagraph[] = [];
  let bufferText: string[] = [];
  let bufferStart = segments[0].start;
  let bufferEnd = segments[0].start;
  let bufferDuration = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const trimmed = seg.text.trim();
    if (bufferText.length === 0) {
      bufferStart = seg.start;
    }
    bufferText.push(trimmed);
    bufferEnd = seg.start + seg.duration;
    bufferDuration += seg.duration;

    const reachedTarget = bufferDuration >= targetDurationSeconds;
    const endsOnSentence = SENTENCE_END_RE.test(trimmed);
    const reachedHardCap = bufferDuration >= hardCap;

    // Flush when we've gathered enough material AND the line ends a
    // sentence — readability beats hitting the duration target on the nose.
    // The hard cap forces a flush regardless so a punctuation-less stretch
    // can't grow without bound.
    if ((reachedTarget && endsOnSentence) || reachedHardCap) {
      paragraphs.push({
        start: bufferStart,
        end: bufferEnd,
        text: bufferText.join(" "),
      });
      bufferText = [];
      bufferDuration = 0;
    }
  }

  // Tail: flush whatever's left so the last paragraph isn't dropped on the
  // floor. Common case is a video that ends mid-sentence.
  if (bufferText.length > 0) {
    paragraphs.push({
      start: bufferStart,
      end: bufferEnd,
      text: bufferText.join(" "),
    });
  }

  return paragraphs;
}

/**
 * Format a number of seconds as `mm:ss` (under 1 hour) or `h:mm:ss`.
 * Used for the clickable timestamp label rendered above each paragraph.
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}
