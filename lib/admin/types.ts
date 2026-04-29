/**
 * Domain types shared across the admin console.
 *
 * `TranscriptSource` and `TranscriptModel` mirror the production schema's
 * `summaries.transcript_source` enum and the model IDs used by the LLM
 * gateway. Closed unions catch typos and let renderers exhaustiveness-check.
 */

export type TranscriptSource = "manual_captions" | "auto_captions" | "whisper";
export type TranscriptModel = "claude-opus-4-7" | "claude-sonnet-4-6" | "claude-haiku-4-5";

export interface TranscriptSummary {
  title: string;
  channel: string;
  /** BCP-47-ish "src→dst" pair, e.g. "en→en", "zh→en". */
  lang: string;
  source: TranscriptSource;
  model: TranscriptModel;
  /** Total processing time in seconds. */
  time: number;
}

/** Visual tone for KPI deltas + status pills. Single shared vocabulary across the console. */
export type Tone = "ok" | "warn" | "bad" | "primary";

/** Direction-of-change tone for time-series KPIs. */
export type Delta = "up" | "down" | "warn" | "flat";

/**
 * One row in the users table. Stays a UI-shape today; will eventually be
 * derived from a Supabase view.
 */
export interface AdminUser {
  id: string;
  email: string;
  /** Avatar gradient palette idx (1-7). Unconstrained `number` at runtime to keep mock data simple. */
  avIdx: number;
  /** Two-letter initials for the avatar. */
  label: string;
  plan: "free" | "pro";
  /** Summaries in the last 30 days. */
  summaries: number;
  /** Whisper-fallback rate as a percentage 0-100. */
  whisper: number;
  /** p95 latency in seconds. */
  p95: number;
  lastSeen: string;
  joined: string;
  /** Present-only flag — `flagged: true` means flagged; absence means not flagged. */
  flagged?: true;
  tokens: string;
}
