import { type SummaryStreamProtocolErrorCode } from "@/lib/api-contracts/summary";
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import type { SummaryResult, TranscriptSegment, TranscriptSource } from "@/lib/types";

export interface SummaryRunVideo {
  readonly youtubeUrl: string;
}

/** The one immutable tuple captured by each explicit Summary Run start. */
export interface SummaryRunInput {
  readonly video: SummaryRunVideo;
  readonly outputLanguage: SupportedLanguageCode | null;
  readonly includeTranscript: boolean;
}

export type SummaryRunStage =
  | "preparing"
  | "transcribing"
  | "summarizing"
  | "complete";

export type SummaryRunOrigin = "cache" | "generated";

export const SUMMARY_TRANSCRIPT_DIAGNOSTICS = [
  "not_received",
  "invalid_full_transcript",
] as const;

export type SummaryTranscriptDiagnostic =
  (typeof SUMMARY_TRANSCRIPT_DIAGNOSTICS)[number];

export const SUMMARY_RUN_FAILURE_KINDS = [
  "authentication",
  "quota",
  "rate_limit",
  "request",
  "network",
  "processing",
  "protocol",
] as const;

export type SummaryRunFailureKind =
  (typeof SUMMARY_RUN_FAILURE_KINDS)[number];

/** Stable public codes. Wire error IDs and exception messages never cross this boundary. */
export type SummaryRunFailureCode =
  | "AUTH_REQUIRED"
  | "AUTHENTICATION_FAILED"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "REQUEST_FAILED"
  | "NETWORK_FAILURE"
  | "PROCESSING_FAILURE"
  | "PROTOCOL_FAILURE"
  | SummaryStreamProtocolErrorCode
  | "PREMATURE_EOF"
  | "MISSING_METADATA"
  | "DUPLICATE_METADATA"
  | "EMPTY_SUMMARY"
  | "EVENT_AFTER_TERMINATION"
  | "MISSING_ORIGIN";

export type SummaryQuotaErrorCode =
  | "free_quota_exceeded"
  | "anon_quota_exceeded";

export interface SummaryRunQuotaInfo {
  readonly errorCode: SummaryQuotaErrorCode;
  readonly tier: "free" | "anon";
  readonly upgradeUrl: "/pricing";
}

export type SummaryTranscriptState =
  | { readonly status: "not_requested" }
  | {
      readonly status: "available";
      readonly segments: readonly TranscriptSegment[];
      readonly source: TranscriptSource;
    }
  | {
      readonly status: "unavailable";
      readonly diagnostic: SummaryTranscriptDiagnostic;
    };

export interface SummaryRunProgress {
  readonly stage: SummaryRunStage;
  /** The validated protocol message for the current status, when present. */
  readonly message: string;
  /** Wall-clock time since this run was explicitly started. */
  readonly elapsedSeconds: number;
}

export interface SummaryDraft {
  readonly text: string;
}

export interface SummaryRunFailure {
  readonly kind: SummaryRunFailureKind;
  readonly code: SummaryRunFailureCode;
  readonly message: string;
  readonly status?: number;
  readonly quota?: SummaryRunQuotaInfo;
}

export interface SummaryRunTiming {
  readonly totalSeconds: number;
  readonly transcriptionSeconds: number;
  readonly summarySeconds: number;
}

export interface SummaryRunSuccessOutcome {
  readonly outcome: "success";
  readonly runId: string;
  readonly outputLanguage: SupportedLanguageCode | null;
  readonly origin: SummaryRunOrigin;
  readonly timings: SummaryRunTiming;
}

export interface SummaryRunFailureOutcome {
  readonly outcome: "failure";
  readonly runId: string;
  readonly outputLanguage: SupportedLanguageCode | null;
  readonly failure: {
    readonly kind: SummaryRunFailureKind;
    readonly code: SummaryRunFailureCode;
    readonly status?: number;
  };
}

export type SummaryRunOutcome =
  | SummaryRunSuccessOutcome
  | SummaryRunFailureOutcome;

export type SummaryRunOutcomeObserver = (outcome: SummaryRunOutcome) => void;

export type CompletedSummary = SummaryResult & {
  readonly origin: SummaryRunOrigin;
};

export interface SummaryRunIdleSnapshot {
  readonly status: "idle";
}

export interface SummaryRunRunningSnapshot {
  readonly status: "running";
  readonly runId: string;
  readonly input: SummaryRunInput;
  readonly draft: SummaryDraft;
  readonly progress: SummaryRunProgress;
  readonly origin: SummaryRunOrigin | null;
  readonly transcript: SummaryTranscriptState;
}

export interface SummaryRunSucceededSnapshot {
  readonly status: "succeeded";
  readonly runId: string;
  readonly input: SummaryRunInput;
  readonly summary: CompletedSummary;
  readonly progress: SummaryRunProgress;
  readonly origin: SummaryRunOrigin;
  readonly transcript: SummaryTranscriptState;
}

export interface SummaryRunFailedSnapshot {
  readonly status: "failed";
  readonly runId: string;
  readonly input: SummaryRunInput;
  readonly draft: SummaryDraft;
  readonly progress: SummaryRunProgress;
  readonly origin: SummaryRunOrigin | null;
  readonly transcript: SummaryTranscriptState;
  readonly error: SummaryRunFailure;
}

export interface SummaryRunCancelledSnapshot {
  readonly status: "cancelled";
  readonly runId: string;
  readonly input: SummaryRunInput;
  readonly draft: SummaryDraft;
  readonly progress: SummaryRunProgress;
  readonly origin: SummaryRunOrigin | null;
  readonly transcript: SummaryTranscriptState;
}

export type SummaryRunSnapshot =
  | SummaryRunIdleSnapshot
  | SummaryRunRunningSnapshot
  | SummaryRunSucceededSnapshot
  | SummaryRunFailedSnapshot
  | SummaryRunCancelledSnapshot;

export interface SummaryRunController {
  getSnapshot(): SummaryRunSnapshot;
  subscribe(listener: (snapshot: SummaryRunSnapshot) => void): () => void;
  start(input: SummaryRunInput): Promise<void>;
  cancel(): void;
  retry(): Promise<void>;
}

export interface SummaryRunControllerOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly getAccessToken: () => string | null | Promise<string | null>;
  readonly onAuthError?: (status: number, message: string) => void;
  readonly onOutcome?: SummaryRunOutcomeObserver;
  readonly now?: () => number;
  readonly elapsedTickMs?: number;
  readonly createRunId?: () => string;
}
