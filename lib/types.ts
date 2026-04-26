import { z } from "zod";

/**
 * Single source of truth for the transcript segment runtime shape. Imported
 * by every layer that crosses a trust boundary: VPS captions response, VPS
 * transcribe response, jsonb cache read, jsonb cache write, SSE protocol
 * type. Centralizing closes the drift surface — a regression that allowed
 * NaN through one parser used to be invisible at every other layer.
 *
 * `.finite().nonnegative()` rules out NaN and negative numbers. NaN would
 * make every `[start, end)` comparison silently false (highlight goes
 * permanently dark); negative numbers would invert the interval and seek
 * the YouTube player to a nonsense position.
 */
export const TranscriptSegmentSchema = z.object({
  text: z.string(),
  start: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
});

/**
 * One transcript line with its playback timing. Used to render clickable
 * timestamps that seek the embedded YouTube player.
 *
 * Same shape produced by both the YouTube captions API and the Whisper
 * fallback so consumers don't need to branch on transcript source.
 *
 * Sentinel: `start === 0 && duration === 0` flags "legacy backfill, no
 * real timing data" (see migration 20260424000006). Consumers that depend
 * on clickable timing should detect this and degrade gracefully — the
 * paragraph view does so by showing a "Timestamps not available" hint.
 */
export interface TranscriptSegment {
  readonly text: string;
  readonly start: number; // seconds since video start
  readonly duration: number; // seconds
}

export interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

export interface SummaryResult {
  title: string;
  duration: string;
  summary: string;
  transcriptionTime: number;
  summaryTime: number;
  segments?: readonly TranscriptSegment[];
}

export interface StreamingStatus {
  stage: "preparing" | "transcribing" | "summarizing" | "complete";
  progress?: number;
  message?: string;
}
