// Two disjoint stage vocabularies — keeping them typed prevents accidental
// cross-use (logging an upstream name to the client, or vice versa).

// Server-side log partition: what upstream failed, for Sentry grouping.
export type LogStage =
  | "captions"
  | "vps"
  | "metadata"
  | "llm"
  | "cache"
  | "auth"
  | "unknown";

// Client-facing progress vocabulary: what the UI renders in the status bar.
export type ClientStage = "transcribe" | "summarize";
