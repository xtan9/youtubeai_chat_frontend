// Two disjoint stage vocabularies: server-side error partitions (for log
// grouping and alerting) and client-facing progress labels (for the UI
// status bar). Typing them separately keeps either from leaking across the
// SSE boundary as a bare `string`.
export type LogStage =
  | "captions"
  | "vps"
  | "metadata"
  | "llm"
  | "cache"
  | "auth"
  | "unknown";

export type ClientStage = "transcribe" | "summarize";
