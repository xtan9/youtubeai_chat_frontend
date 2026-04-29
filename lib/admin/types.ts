/** Domain types shared across the admin console. */

export type { TranscriptSource } from "@/lib/services/summarize-cache";
import type { TranscriptSource } from "@/lib/services/summarize-cache";

export type TranscriptModel = "claude-opus-4-7" | "claude-sonnet-4-6" | "claude-haiku-4-5";

export function assertNever(x: never): never {
  throw new Error(`unhandled value: ${String(x)}`);
}

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

export interface AdminUser {
  id: string;
  email: string;
  avIdx: number;
  label: string;
  plan: "free" | "pro";
  summaries: number;
  whisper: number;
  p95: number;
  lastSeen: string;
  joined: string;
  flagged?: true;
  tokens: string;
}
