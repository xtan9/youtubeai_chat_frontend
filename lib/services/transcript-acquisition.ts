import {
  CaptionExtractionError,
  captionErrorId,
  extractCaptions,
} from "./caption-extractor";
import {
  getCachedTranscript,
  writeCachedTranscript,
  type PromptLocale,
  type TranscriptSegment,
  type TranscriptSource,
} from "./summarize-cache";
import {
  fetchVideoMetadata,
  type VideoMetadataResult,
} from "./video-metadata";
import {
  fetchVpsMetadata,
  primarySubtag,
  type VpsMetadataResult,
} from "./vps-metadata";
import {
  transcribeViaVps,
  VpsTranscribeError,
  vpsErrorId,
} from "./vps-client";
import { detectLocale } from "./language-detect";
import { logAppEvent, videoIdForLog } from "../observability";

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

type MetadataFields = {
  title?: string;
  channelName?: string;
};

function nonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function hasCompleteMetadata(fields: MetadataFields): boolean {
  return fields.title !== undefined && fields.channelName !== undefined;
}

function mergeMetadata(
  current: MetadataFields,
  result: VideoMetadataResult
): { fields: MetadataFields; recovered: boolean } {
  if (!result.ok) return { fields: current, recovered: false };

  const recoveredTitle =
    current.title === undefined ? nonBlank(result.data.title) : undefined;
  const recoveredChannel =
    current.channelName === undefined
      ? nonBlank(result.data.channelName)
      : undefined;

  return {
    fields: {
      title: current.title ?? recoveredTitle,
      channelName: current.channelName ?? recoveredChannel,
    },
    recovered: recoveredTitle !== undefined || recoveredChannel !== undefined,
  };
}

function emitProgress(
  input: TranscriptAcquisitionInput,
  event: TranscriptAcquisitionProgress
): void {
  if (!input.signal.aborted) input.onProgress?.(event);
}

function isKnownFailureStatus(value: unknown): value is TranscriptAcquisitionFailureStatus {
  return (
    typeof value === "number" ||
    value === "network" ||
    value === "timeout" ||
    value === "schema"
  );
}

function classifyFailure(
  stage: TranscriptAcquisitionFailureStage,
  error: unknown
): TranscriptAcquisitionFailure {
  if (stage === "captions" && error instanceof CaptionExtractionError) {
    return {
      stage,
      errorId: captionErrorId(error.status),
      ...(isKnownFailureStatus(error.status) ? { status: error.status } : {}),
      errorName: error.name,
    };
  }

  if (stage === "transcription" && error instanceof VpsTranscribeError) {
    return {
      stage,
      errorId: vpsErrorId(error.status),
      ...(isKnownFailureStatus(error.status) ? { status: error.status } : {}),
      errorName: error.name,
    };
  }

  return {
    stage,
    errorId:
      stage === "captions"
        ? "TRANSCRIPT_ACQUISITION_CAPTIONS_FAILED"
        : "TRANSCRIPT_ACQUISITION_TRANSCRIPTION_FAILED",
    errorName: error instanceof Error ? error.name : typeof error,
  };
}

function logAcquisitionFailure(
  input: TranscriptAcquisitionInput,
  failure: TranscriptAcquisitionFailure
): void {
  logAppEvent("error", "[transcript-acquisition] acquisition failed", {
    errorId: failure.errorId,
    stage: failure.stage,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    videoId: videoIdForLog(input.youtubeUrl),
    requestId: input.requestId,
    ...(failure.errorName ? { errorName: failure.errorName } : {}),
  });
}

function logMetadataDegradation(
  input: TranscriptAcquisitionInput,
  result: Exclude<VpsMetadataResult, { ok: true }>
): void {
  if (result.reason === "aborted" || input.signal.aborted) return;

  if (result.reason === "non_ok" && result.status === 404) {
    logAppEvent("warn", "[transcript-acquisition] metadata endpoint unavailable", {
      errorId: "VPS_METADATA_404",
      status: 404,
      videoId: videoIdForLog(input.youtubeUrl),
      requestId: input.requestId,
    });
    return;
  }

  logAppEvent("error", "[transcript-acquisition] language detection degraded", {
    errorId: "TRANSCRIPT_LANGUAGE_DETECTION_DEGRADED",
    reason: result.reason,
    ...(result.reason === "non_ok" ? { status: result.status } : {}),
    ...(result.reason === "error"
      ? {
          errorName:
            result.error instanceof Error
              ? result.error.name
              : typeof result.error,
        }
      : {}),
    videoId: videoIdForLog(input.youtubeUrl),
    requestId: input.requestId,
  });
}

function logMetadataRecoveryFailure(
  input: TranscriptAcquisitionInput,
  result: Exclude<VideoMetadataResult, { ok: true }>
): void {
  if (result.reason === "aborted" || input.signal.aborted) return;

  logAppEvent("warn", "[transcript-acquisition] metadata recovery failed", {
    errorId: "TRANSCRIPT_METADATA_RECOVERY_FAILED",
    reason: result.reason,
    ...(result.reason === "non_ok" ? { status: result.status } : {}),
    ...(result.reason === "error"
      ? {
          errorName:
            result.error instanceof Error
              ? result.error.name
              : typeof result.error,
        }
      : {}),
    videoId: videoIdForLog(input.youtubeUrl),
    requestId: input.requestId,
  });
}

async function recoverMetadata(
  input: TranscriptAcquisitionInput
): Promise<VideoMetadataResult> {
  try {
    return await fetchVideoMetadata(input.youtubeUrl, input.signal);
  } catch (error) {
    return input.signal.aborted
      ? { ok: false, reason: "aborted" }
      : { ok: false, reason: "error", error };
  }
}

async function persistBestEffort(
  input: TranscriptAcquisitionInput,
  fields: MetadataFields,
  segments: readonly TranscriptSegment[],
  transcriptSource: TranscriptSource,
  promptLocale: PromptLocale,
  reusedStoredTranscript: boolean
): Promise<void> {
  try {
    await writeCachedTranscript({
      youtubeUrl: input.youtubeUrl,
      segments,
      transcriptSource,
      language: promptLocale,
      ...(fields.title ? { title: fields.title } : {}),
      ...(fields.channelName ? { channelName: fields.channelName } : {}),
    });
  } catch (error) {
    logAppEvent("error", "[transcript-acquisition] Transcript persistence failed", {
      errorId: "TRANSCRIPT_PERSISTENCE_FAILED",
      videoId: videoIdForLog(input.youtubeUrl),
      requestId: input.requestId,
      source: transcriptSource,
      reusedStoredTranscript,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function successResult(params: {
  segments: readonly TranscriptSegment[];
  transcriptSource: TranscriptSource;
  promptLocale: PromptLocale;
  detectedLanguage?: string;
  fields: MetadataFields;
  reusedStoredTranscript: boolean;
  acquisitionDurationSeconds: number;
}): TranscriptAcquisitionSuccess {
  return {
    outcome: "success",
    segments: params.segments,
    transcriptSource: params.transcriptSource,
    promptLocale: params.promptLocale,
    ...(params.detectedLanguage
      ? { detectedLanguage: params.detectedLanguage }
      : {}),
    ...(params.fields.title ? { title: params.fields.title } : {}),
    ...(params.fields.channelName
      ? { channelName: params.fields.channelName }
      : {}),
    reusedStoredTranscript: params.reusedStoredTranscript,
    acquisitionDurationSeconds: params.acquisitionDurationSeconds,
  };
}

async function acquireStoredTranscript(
  input: TranscriptAcquisitionInput,
  cached: Awaited<ReturnType<typeof getCachedTranscript>>
): Promise<TranscriptAcquisitionOutcome> {
  if (!cached) throw new Error("acquireStoredTranscript requires a cache hit");

  emitProgress(input, { type: "stored_reuse" });
  let fields: MetadataFields = {
    title: nonBlank(cached.title),
    channelName: nonBlank(cached.channelName),
  };

  if (input.signal.aborted) return { outcome: "caller_aborted" };

  let metadataRecovered = false;
  if (!hasCompleteMetadata(fields)) {
    const metadata = await recoverMetadata(input);
    if (metadata.ok) {
      const merged = mergeMetadata(fields, metadata);
      fields = merged.fields;
      metadataRecovered = merged.recovered;
    } else {
      logMetadataRecoveryFailure(input, metadata);
    }
  }

  // A usable stored Transcript is already available. If the caller
  // disconnects during best-effort repair, still finish the short sparse
  // write when there are recovered fields, then report cancellation.
  if (metadataRecovered) {
    await persistBestEffort(
      input,
      fields,
      cached.segments,
      cached.transcriptSource,
      cached.language,
      true
    );
  }

  if (input.signal.aborted) return { outcome: "caller_aborted" };

  return successResult({
    segments: cached.segments,
    transcriptSource: cached.transcriptSource,
    promptLocale: cached.language,
    fields,
    reusedStoredTranscript: true,
    acquisitionDurationSeconds: 0,
  });
}

async function acquireFreshTranscript(
  input: TranscriptAcquisitionInput,
  startedAt: number
): Promise<TranscriptAcquisitionOutcome> {
  let detectedLanguage: string | undefined;

  const vpsMetadata = await fetchVpsMetadata(
    input.youtubeUrl,
    input.signal,
    input.requestId
  );
  if (input.signal.aborted) return { outcome: "caller_aborted" };
  if (vpsMetadata.ok) {
    detectedLanguage = primarySubtag(vpsMetadata.data.language);
    emitProgress(input, { type: "language_detection", detectedLanguage });
  } else {
    logMetadataDegradation(input, vpsMetadata);
  }

  emitProgress(input, { type: "caption_acquisition" });
  let captions;
  try {
    captions = await extractCaptions(
      input.youtubeUrl,
      input.signal,
      detectedLanguage,
      input.requestId
    );
  } catch (error) {
    if (input.signal.aborted) return { outcome: "caller_aborted" };
    const failure = classifyFailure("captions", error);
    logAcquisitionFailure(input, failure);
    return { outcome: "acquisition_failed", failure };
  }
  // A provider can still return usable canonical segments after the caller
  // signal fires (for example, a response crossed the abort boundary). Keep
  // those segments so the non-cancellable persistence step below can heal
  // the cache before reporting caller_aborted.
  if (input.signal.aborted && !captions) {
    return { outcome: "caller_aborted" };
  }

  if (
    !captions &&
    detectedLanguage !== undefined &&
    detectedLanguage !== "en" &&
    vpsMetadata.ok &&
    vpsMetadata.data.availableCaptions.map(primarySubtag).includes("en")
  ) {
    try {
      captions = await extractCaptions(
        input.youtubeUrl,
        input.signal,
        "en",
        input.requestId
      );
    } catch (error) {
      if (input.signal.aborted) return { outcome: "caller_aborted" };
      const failure = classifyFailure("captions", error);
      logAcquisitionFailure(input, failure);
      return { outcome: "acquisition_failed", failure };
    }
    if (input.signal.aborted && !captions) {
      return { outcome: "caller_aborted" };
    }
  }

  let segments: readonly TranscriptSegment[];
  let transcriptSource: TranscriptSource;
  let promptLocale: PromptLocale;
  let fields: MetadataFields = {};
  let metadataPromise: Promise<VideoMetadataResult> | undefined;

  if (captions) {
    segments = captions.segments;
    transcriptSource = captions.source;
    promptLocale = captions.language;
    fields = {
      title: nonBlank(captions.title),
      channelName: nonBlank(captions.channelName),
    };
  } else {
    emitProgress(input, { type: "audio_transcription" });
    // Metadata is auxiliary and may resolve while the expensive audio
    // operation runs. Its result is still awaited before persistence.
    metadataPromise = recoverMetadata(input);
    try {
      const transcription = await transcribeViaVps(
        input.youtubeUrl,
        input.signal,
        detectedLanguage,
        input.requestId
      );
      segments = transcription.segments;
      transcriptSource = "whisper";
      promptLocale =
        detectedLanguage === "zh"
          ? "zh"
          : detectLocale(
              segments
                .map((segment) => segment.text)
                .join(" ")
                .slice(0, 500)
            );
    } catch (error) {
      if (input.signal.aborted) return { outcome: "caller_aborted" };
      const failure = classifyFailure("transcription", error);
      logAcquisitionFailure(input, failure);
      return { outcome: "acquisition_failed", failure };
    }
  }

  // Once canonical segments exist, persistence is non-cancellable. This
  // preserves expensive work even if the caller disconnects in this window.
  if (input.signal.aborted) {
    await persistBestEffort(
      input,
      fields,
      segments,
      transcriptSource,
      promptLocale,
      false
    );
    return { outcome: "caller_aborted" };
  }

  if (metadataPromise) {
    const metadata = await metadataPromise;
    if (metadata.ok) {
      fields = mergeMetadata(fields, metadata).fields;
    } else {
      logMetadataRecoveryFailure(input, metadata);
    }
  } else if (!hasCompleteMetadata(fields)) {
    const metadata = await recoverMetadata(input);
    if (metadata.ok) {
      fields = mergeMetadata(fields, metadata).fields;
    } else {
      logMetadataRecoveryFailure(input, metadata);
    }
  }

  await persistBestEffort(
    input,
    fields,
    segments,
    transcriptSource,
    promptLocale,
    false
  );

  if (input.signal.aborted) return { outcome: "caller_aborted" };

  return successResult({
    segments,
    transcriptSource,
    promptLocale,
    detectedLanguage,
    fields,
    reusedStoredTranscript: false,
    acquisitionDurationSeconds: Math.max(0, (Date.now() - startedAt) / 1000),
  });
}

/**
 * Acquire one canonical Transcript. The cache is deliberately read first:
 * requested Summary language never participates in Transcript identity.
 */
export async function acquireTranscript(
  input: TranscriptAcquisitionInput
): Promise<TranscriptAcquisitionOutcome> {
  const cached = await getCachedTranscript(input.youtubeUrl);
  if (input.signal.aborted) return { outcome: "caller_aborted" };
  if (cached) return acquireStoredTranscript(input, cached);
  return acquireFreshTranscript(input, Date.now());
}
