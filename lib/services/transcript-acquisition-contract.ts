import {
  type PromptLocale,
  type TranscriptSegment,
  type TranscriptSource,
} from "./summarize-cache";

/**
 * Semantic milestones emitted by Transcript Acquisition. The route maps
 * these to its own transport and product copy; this module never emits SSE
 * events or user-facing strings.
 */
export type TranscriptAcquisitionProgress =
  | { readonly type: "stored_reuse" }
  | {
      readonly type: "language_detection";
      readonly detectedLanguage: string;
    }
  | { readonly type: "caption_acquisition" }
  | { readonly type: "audio_transcription" };

/** Input for one request-scoped Transcript Acquisition operation. */
export interface TranscriptAcquisitionInput {
  /** A Video URL already validated by the request boundary. */
  readonly youtubeUrl: string;
  /** The caller's signal; internal provider timeouts remain provider-owned. */
  readonly signal: AbortSignal;
  /** Correlates cache, metadata, caption, and audio-transcription work. */
  readonly requestId: string;
  /** Synchronous semantic progress observer owned by the caller. */
  readonly onProgress?: (event: TranscriptAcquisitionProgress) => void;
}

export type TranscriptAcquisitionFailureStage = "captions" | "transcription";

export type TranscriptAcquisitionFailureStatus =
  | number
  | "network"
  | "timeout"
  | "schema";

export interface TranscriptAcquisitionFailure {
  readonly stage: TranscriptAcquisitionFailureStage;
  /** Stable identifier; callers do not need to inspect provider exceptions. */
  readonly errorId: string;
  readonly requestId: string;
  readonly status?: TranscriptAcquisitionFailureStatus;
  readonly errorName?: string;
}

export interface TranscriptAcquisitionSuccess {
  readonly outcome: "success";
  readonly segments: readonly TranscriptSegment[];
  readonly transcriptSource: TranscriptSource;
  readonly promptLocale: PromptLocale;
  readonly detectedLanguage?: string;
  readonly title?: string;
  readonly channelName?: string;
  readonly reusedStoredTranscript: boolean;
  readonly acquisitionDurationSeconds: number;
}

export type TranscriptAcquisitionOutcome =
  | TranscriptAcquisitionSuccess
  | { readonly outcome: "caller_aborted" }
  | {
      readonly outcome: "acquisition_failed";
      readonly failure: TranscriptAcquisitionFailure;
    };
