import {
  CaptionExtractionError,
  captionErrorId,
  extractCaptions,
  type CaptionResult,
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

type MetadataFields = {
  title?: string;
  channelName?: string;
};

function nonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertUsableSegments(
  segments: readonly TranscriptSegment[]
): void {
  if (
    !Array.isArray(segments) ||
    segments.length === 0 ||
    segments.some((segment) => segment.text.trim().length === 0)
  ) {
    throw new Error("Transcript Acquisition received no usable segments");
  }
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
  error: unknown,
  requestId: string
): TranscriptAcquisitionFailure {
  if (stage === "captions" && error instanceof CaptionExtractionError) {
    return {
      stage,
      errorId: captionErrorId(error.status),
      requestId,
      ...(isKnownFailureStatus(error.status) ? { status: error.status } : {}),
      errorName: error.name,
    };
  }

  if (stage === "transcription" && error instanceof VpsTranscribeError) {
    return {
      stage,
      errorId: vpsErrorId(error.status),
      requestId,
      ...(isKnownFailureStatus(error.status) ? { status: error.status } : {}),
      errorName: error.name,
    };
  }

  // A typed adapter error is the contract for an operational outcome. Any
  // other exception is an invariant or programming failure and must remain
  // visible to the caller instead of being disguised as a known incident.
  throw error;
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
    requestId: failure.requestId,
    ...(failure.errorName ? { errorName: failure.errorName } : {}),
  });
}

type CaptionAttemptFailure = Extract<
  TranscriptAcquisitionOutcome,
  { readonly outcome: "caller_aborted" | "acquisition_failed" }
>;

type CaptionAttemptResult =
  | { readonly ok: true; readonly captions: CaptionResult | null }
  | { readonly ok: false; readonly outcome: CaptionAttemptFailure };

async function acquireCaptionAttempt(
  input: TranscriptAcquisitionInput,
  language: string | undefined
): Promise<CaptionAttemptResult> {
  try {
    const captions = await extractCaptions(
      input.youtubeUrl,
      input.signal,
      language,
      input.requestId
    );

    // A null result after cancellation is not a genuine absence: the caller
    // owns the outcome, and no later caption or audio work may start.
    if (input.signal.aborted && captions === null) {
      return { ok: false, outcome: { outcome: "caller_aborted" } };
    }

    return { ok: true, captions };
  } catch (error) {
    if (input.signal.aborted) {
      return { ok: false, outcome: { outcome: "caller_aborted" } };
    }
    const failure = classifyFailure("captions", error, input.requestId);
    logAcquisitionFailure(input, failure);
    return { ok: false, outcome: { outcome: "acquisition_failed", failure } };
  }
}

function shouldAttemptEnglishCaption(
  metadata: VpsMetadataResult,
  detectedLanguage: string | undefined
): boolean {
  return (
    metadata.ok &&
    detectedLanguage !== undefined &&
    detectedLanguage !== "en" &&
    metadata.data.availableCaptions.some(
      (language) => primarySubtag(language) === "en"
    )
  );
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

type MetadataRecovery = {
  readonly fields: MetadataFields;
  readonly recovered: boolean;
};

async function recoverMissingMetadata(
  input: TranscriptAcquisitionInput,
  fields: MetadataFields
): Promise<MetadataRecovery> {
  if (hasCompleteMetadata(fields)) return { fields, recovered: false };

  const metadata = await recoverMetadata(input);
  if (!metadata.ok) {
    logMetadataRecoveryFailure(input, metadata);
    return { fields, recovered: false };
  }

  return mergeMetadata(fields, metadata);
}

type AbortableWait<T> =
  | { readonly aborted: true }
  | { readonly aborted: false; readonly value: T };

async function waitUnlessCallerAborted<T>(
  signal: AbortSignal,
  promise: Promise<T>
): Promise<AbortableWait<T>> {
  if (signal.aborted) {
    // The promise argument is evaluated before this helper runs. Keep a
    // late provider rejection observed even when the caller aborts in that
    // tiny hand-off window.
    void promise.catch(() => undefined);
    return { aborted: true };
  }

  return new Promise<AbortableWait<T>>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ aborted: true });
    };

    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ aborted: false, value });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );

    if (signal.aborted) onAbort();
  });
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
  assertUsableSegments(cached.segments);

  emitProgress(input, { type: "stored_reuse" });
  let fields: MetadataFields = {
    title: nonBlank(cached.title),
    channelName: nonBlank(cached.channelName),
  };

  if (input.signal.aborted) return { outcome: "caller_aborted" };

  let settledRecovery: MetadataRecovery | undefined;
  const recoveryPromise = recoverMissingMetadata(input, fields).then(
    (recovery) => {
      settledRecovery = recovery;
      return recovery;
    }
  );
  const recoveryWait = await waitUnlessCallerAborted(
    input.signal,
    recoveryPromise
  );
  if (recoveryWait.aborted) {
    if (settledRecovery) fields = settledRecovery.fields;
    if (settledRecovery?.recovered) {
      await persistBestEffort(
        input,
        fields,
        cached.segments,
        cached.transcriptSource,
        cached.language,
        true
      );
    }
    return { outcome: "caller_aborted" };
  }

  fields = recoveryWait.value.fields;

  // A usable stored Transcript is already available. If the caller
  // disconnects during best-effort repair, still finish the short sparse
  // write when there are recovered fields, then report cancellation.
  if (recoveryWait.value.recovered) {
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

  const vpsMetadataWait = await waitUnlessCallerAborted(
    input.signal,
    fetchVpsMetadata(
      input.youtubeUrl,
      input.signal,
      input.requestId
    )
  );
  if (vpsMetadataWait.aborted) return { outcome: "caller_aborted" };
  const vpsMetadata = vpsMetadataWait.value;
  // The metadata adapter normally returns `reason: "aborted"` together
  // with an aborted caller signal. Honor the explicit discriminated outcome
  // as well so a cancellation classified at the adapter boundary cannot
  // accidentally fall through into caption or audio work.
  if (
    input.signal.aborted ||
    (!vpsMetadata.ok && vpsMetadata.reason === "aborted")
  ) {
    return { outcome: "caller_aborted" };
  }
  if (vpsMetadata.ok) {
    detectedLanguage = primarySubtag(vpsMetadata.data.language);
    emitProgress(input, { type: "language_detection", detectedLanguage });
  } else {
    logMetadataDegradation(input, vpsMetadata);
  }

  if (input.signal.aborted) return { outcome: "caller_aborted" };

  emitProgress(input, { type: "caption_acquisition" });
  if (input.signal.aborted) return { outcome: "caller_aborted" };
  const detectedCaptionAttempt = await acquireCaptionAttempt(
    input,
    detectedLanguage
  );
  if (!detectedCaptionAttempt.ok) return detectedCaptionAttempt.outcome;

  let captions = detectedCaptionAttempt.captions;
  if (input.signal.aborted && captions === null) {
    return { outcome: "caller_aborted" };
  }
  if (
    captions === null &&
    shouldAttemptEnglishCaption(vpsMetadata, detectedLanguage)
  ) {
    const englishCaptionAttempt = await acquireCaptionAttempt(input, "en");
    if (!englishCaptionAttempt.ok) return englishCaptionAttempt.outcome;
    captions = englishCaptionAttempt.captions;
    if (input.signal.aborted && captions === null) {
      return { outcome: "caller_aborted" };
    }
  }

  let segments: readonly TranscriptSegment[];
  let transcriptSource: TranscriptSource;
  let promptLocale: PromptLocale;
  let fields: MetadataFields = {};
  let metadataPromise: Promise<VideoMetadataResult> | undefined;
  let settledMetadata: VideoMetadataResult | undefined;

  if (captions !== null) {
    assertUsableSegments(captions.segments);
    segments = captions.segments;
    transcriptSource = captions.source;
    promptLocale = captions.language;
    fields = {
      title: nonBlank(captions.title),
      channelName: nonBlank(captions.channelName),
    };
  } else {
    emitProgress(input, { type: "audio_transcription" });
    if (input.signal.aborted) return { outcome: "caller_aborted" };
    // Metadata is auxiliary and may resolve while the expensive audio
    // operation runs. While the caller is active, await it before success;
    // after cancellation, consume only a settled result before persistence.
    metadataPromise = recoverMetadata(input).then((metadata) => {
      settledMetadata = metadata;
      return metadata;
    });
    let transcription: Awaited<ReturnType<typeof transcribeViaVps>>;
    try {
      transcription = await transcribeViaVps(
        input.youtubeUrl,
        input.signal,
        detectedLanguage,
        input.requestId
      );
    } catch (error) {
      if (input.signal.aborted) return { outcome: "caller_aborted" };
      const failure = classifyFailure(
        "transcription",
        error,
        input.requestId
      );
      logAcquisitionFailure(input, failure);
      return { outcome: "acquisition_failed", failure };
    }
    assertUsableSegments(transcription.segments);
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
  }

  // Once canonical segments exist, persistence is non-cancellable. This
  // preserves expensive work even if the caller disconnects in this window.
  if (input.signal.aborted) {
    if (settledMetadata?.ok) {
      fields = mergeMetadata(fields, settledMetadata).fields;
    }
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
    const metadataWait = await waitUnlessCallerAborted(
      input.signal,
      metadataPromise
    );
    if (metadataWait.aborted) {
      if (settledMetadata?.ok) {
        fields = mergeMetadata(fields, settledMetadata).fields;
      }
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
    const metadata = metadataWait.value;
    if (metadata.ok) fields = mergeMetadata(fields, metadata).fields;
    else logMetadataRecoveryFailure(input, metadata);
  } else {
    let settledRecovery:
      | { readonly fields: MetadataFields; readonly recovered: boolean }
      | undefined;
    const recoveryPromise = recoverMissingMetadata(input, fields).then(
      (recovery) => {
        settledRecovery = recovery;
        return recovery;
      }
    );
    const recoveryWait = await waitUnlessCallerAborted(
      input.signal,
      recoveryPromise
    );
    if (recoveryWait.aborted) {
      if (settledRecovery) fields = settledRecovery.fields;
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
    fields = recoveryWait.value.fields;
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
  if (input.signal.aborted) return { outcome: "caller_aborted" };

  const startedAt = Date.now();
  const cachedWait = await waitUnlessCallerAborted(
    input.signal,
    getCachedTranscript(input.youtubeUrl)
  );
  if (cachedWait.aborted) return { outcome: "caller_aborted" };
  const cached = cachedWait.value;
  if (cached) return acquireStoredTranscript(input, cached);
  return acquireFreshTranscript(input, startedAt);
}
