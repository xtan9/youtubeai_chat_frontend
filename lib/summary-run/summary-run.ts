import {
  SummaryRequestSchema,
  SummarySseStreamDecoder,
  SummaryStreamProtocolError,
  type SummarySseDecodeItem,
  type SummarySseEvent,
  type SummaryStreamProtocolErrorCode,
} from "@/lib/api-contracts/summary";
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import type {
  SummaryResult,
  TranscriptSegment,
  TranscriptSource,
} from "@/lib/types";

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
      readonly diagnostic?: string;
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
  readonly now?: () => number;
  readonly elapsedTickMs?: number;
  readonly createRunId?: () => string;
}

export class SummaryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = "SummaryRequestError";
  }
}

const DEFAULT_PROGRESS_MESSAGE = "Preparing summary...";
export const SUMMARY_RUN_FAILURE_MESSAGES: Readonly<
  Record<SummaryRunFailureCode, string>
> = Object.freeze({
  AUTH_REQUIRED:
    "Authentication is required to summarize this video. Please sign in again.",
  AUTHENTICATION_FAILED: "Authentication failed. Please sign in again.",
  QUOTA_EXCEEDED: "You've reached your summary limit. Upgrade to continue.",
  RATE_LIMITED:
    "Too many summary requests. Please wait a moment and try again.",
  INVALID_REQUEST: "Please check the YouTube URL and try again.",
  REQUEST_FAILED:
    "The summary request could not be completed. Please try again.",
  NETWORK_FAILURE:
    "Couldn't connect to the summary service. Please try again.",
  PROCESSING_FAILURE:
    "Couldn't process this video. Please try again or try a different URL.",
  PROTOCOL_FAILURE: "The summary stream was invalid. Please try again.",
  malformed_json: "The summary stream was invalid. Please try again.",
  unknown_event_variant: "The summary stream was invalid. Please try again.",
  invalid_event: "The summary stream was invalid. Please try again.",
  invalid_full_transcript:
    "The summary stream contained an unavailable Transcript. Please try again.",
  PREMATURE_EOF:
    "The summary stream ended before the Summary was complete. Please try again.",
  MISSING_METADATA: "The summary stream was invalid. Please try again.",
  DUPLICATE_METADATA: "The summary stream was invalid. Please try again.",
  EMPTY_SUMMARY:
    "The summary service returned no usable Summary. Please try again.",
  EVENT_AFTER_TERMINATION: "The summary stream was invalid. Please try again.",
  MISSING_ORIGIN: "The summary stream was invalid. Please try again.",
});

const DEFAULT_FAILURE_CODE_BY_KIND: Record<
  SummaryRunFailureKind,
  SummaryRunFailureCode
> = {
  authentication: "AUTHENTICATION_FAILED",
  quota: "QUOTA_EXCEEDED",
  rate_limit: "RATE_LIMITED",
  request: "REQUEST_FAILED",
  network: "NETWORK_FAILURE",
  processing: "PROCESSING_FAILURE",
  protocol: "PROTOCOL_FAILURE",
};

/** Resolve the safe display copy even for a snapshot assembled by another adapter. */
export function getSummaryRunFailureMessage(
  failure: Pick<SummaryRunFailure, "kind" | "code">,
): string {
  return (
    SUMMARY_RUN_FAILURE_MESSAGES[failure.code] ??
    SUMMARY_RUN_FAILURE_MESSAGES[DEFAULT_FAILURE_CODE_BY_KIND[failure.kind]] ??
    SUMMARY_RUN_FAILURE_MESSAGES.PROCESSING_FAILURE
  );
}

type MetadataEvent = Extract<SummarySseEvent, { type: "metadata" }>;
type TerminalSummaryEvent = Extract<SummarySseEvent, { type: "summary" }>;

interface RunAccumulator {
  readonly input: SummaryRunInput;
  readonly startedAt: number;
  summaryText: string;
  metadata: MetadataEvent | null;
  metadataCount: number;
  stage: SummaryRunStage;
  message: string;
  transcript: SummaryTranscriptState;
  terminal: "summary" | null;
  terminalSummary: TerminalSummaryEvent | null;
}

interface ActiveRun extends RunAccumulator {
  readonly id: string;
  readonly controller: AbortController;
}

class SummaryRunFailureError extends Error {
  constructor(readonly failure: SummaryRunFailure) {
    super(failure.message);
    this.name = "SummaryRunFailureError";
  }
}

class SummaryRunProtocolFailure extends Error {
  constructor(
    readonly code: SummaryRunFailureCode,
    message = SUMMARY_RUN_FAILURE_MESSAGES.PROTOCOL_FAILURE,
  ) {
    super(message);
    this.name = "SummaryRunProtocolFailure";
  }
}

class SummaryRunPrematureEofFailure extends Error {
  constructor() {
    super(SUMMARY_RUN_FAILURE_MESSAGES.PREMATURE_EOF);
    this.name = "SummaryRunPrematureEofFailure";
  }
}

class SummaryQuotaRequestFailure extends Error {
  constructor(readonly quota: SummaryRunQuotaInfo) {
    super(SUMMARY_RUN_FAILURE_MESSAGES.QUOTA_EXCEEDED);
    this.name = "SummaryQuotaRequestFailure";
  }
}

function freezeInput(input: SummaryRunInput): SummaryRunInput {
  const captured: SummaryRunInput = {
    video: {
      youtubeUrl: input.video.youtubeUrl,
    },
    outputLanguage: input.outputLanguage,
    includeTranscript: input.includeTranscript,
  };
  Object.freeze(captured.video);
  return Object.freeze(captured);
}

function freezeDraft(text: string): SummaryDraft {
  return Object.freeze({ text });
}

function freezeSegments(
  segments: readonly TranscriptSegment[],
): readonly TranscriptSegment[] {
  return Object.freeze(
    segments.map((segment) => Object.freeze({ ...segment })),
  );
}

function freezeProgress(
  run: RunAccumulator,
  now: number,
  stage = run.stage,
  message = run.message,
): SummaryRunProgress {
  return Object.freeze({
    stage,
    message,
    elapsedSeconds: Math.max(0, (now - run.startedAt) / 1000),
  });
}

function freezeTranscript(
  transcript: SummaryTranscriptState,
): SummaryTranscriptState {
  if (transcript.status === "available") {
    return Object.freeze({
      ...transcript,
      segments: freezeSegments(transcript.segments),
    });
  }
  return Object.freeze({ ...transcript });
}

function initialTranscriptState(
  includeTranscript: boolean,
): SummaryTranscriptState {
  return includeTranscript
    ? { status: "unavailable", diagnostic: "not_received" }
    : { status: "not_requested" };
}

function createRunId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `summary-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusStage(stage: Extract<SummarySseEvent, { type: "status" }>["stage"]):
  | "transcribing"
  | "summarizing" {
  return stage === "transcribe" ? "transcribing" : "summarizing";
}

function requestFailureForStatus(status: number): {
  readonly kind: SummaryRunFailureKind;
  readonly code: SummaryRunFailureCode;
} {
  if (status === 401 || status === 403) {
    return { kind: "authentication", code: "AUTHENTICATION_FAILED" };
  }
  if (status === 402) {
    return { kind: "quota", code: "QUOTA_EXCEEDED" };
  }
  if (status === 429) {
    return { kind: "rate_limit", code: "RATE_LIMITED" };
  }
  if (status === 400) {
    return { kind: "request", code: "INVALID_REQUEST" };
  }
  return { kind: "request", code: "REQUEST_FAILED" };
}

function makeFailure(
  kind: SummaryRunFailureKind,
  code: SummaryRunFailureCode = DEFAULT_FAILURE_CODE_BY_KIND[kind],
  status?: number,
  quota?: SummaryRunQuotaInfo,
): SummaryRunFailureError {
  const failure: SummaryRunFailure = {
    kind,
    code,
    message: getSummaryRunFailureMessage({ kind, code }),
    ...(status !== undefined ? { status } : {}),
    ...(quota ? { quota: Object.freeze(quota) } : {}),
  };
  return new SummaryRunFailureError(Object.freeze(failure));
}

function toFailure(error: unknown): SummaryRunFailure {
  if (error instanceof SummaryRunFailureError) return error.failure;

  if (error instanceof SummaryRunProtocolFailure) {
    return makeFailure("protocol", error.code).failure;
  }

  if (error instanceof SummaryRunPrematureEofFailure) {
    return makeFailure("protocol", "PREMATURE_EOF").failure;
  }

  if (error instanceof SummaryStreamProtocolError) {
    return makeFailure("protocol", error.code).failure;
  }

  if (error instanceof SummaryQuotaRequestFailure) {
    return makeFailure(
      "quota",
      "QUOTA_EXCEEDED",
      402,
      error.quota,
    ).failure;
  }

  if (error instanceof SummaryRequestError) {
    const classification = requestFailureForStatus(error.status);
    const code =
      error.status === 401 && error.errorCode === "AUTH_REQUIRED"
        ? "AUTH_REQUIRED"
        : classification.code;
    return {
      ...makeFailure(classification.kind, code, error.status).failure,
    };
  }

  return makeFailure("network").failure;
}

function terminalFailure(
  kind: SummaryRunFailureKind,
  code: SummaryRunFailureCode = DEFAULT_FAILURE_CODE_BY_KIND[kind],
): SummaryRunFailureError {
  return makeFailure(kind, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function quotaInfoFromResponse(value: unknown): SummaryRunQuotaInfo {
  const errorCode: SummaryQuotaErrorCode =
    isRecord(value) && value.errorCode === "anon_quota_exceeded"
      ? "anon_quota_exceeded"
      : "free_quota_exceeded";
  return Object.freeze({
    errorCode,
    tier: errorCode === "anon_quota_exceeded" ? "anon" : "free",
    upgradeUrl: "/pricing",
  });
}

function reduceEvent(run: RunAccumulator, event: SummarySseEvent): void {
  if (run.terminal !== null) {
    throw new SummaryRunProtocolFailure("EVENT_AFTER_TERMINATION");
  }

  switch (event.type) {
    case "metadata":
      run.metadataCount += 1;
      if (run.metadataCount !== 1) {
        throw new SummaryRunProtocolFailure("DUPLICATE_METADATA");
      }
      run.metadata = event;
      return;

    case "status":
      run.stage = statusStage(event.stage);
      // The message is accepted only as the display value for the validated
      // status event. Stage transitions never inspect or infer from it.
      run.message = event.message;
      return;

    case "content":
      run.summaryText += event.text;
      return;

    case "full_transcript":
      run.transcript = {
        status: "available",
        segments: event.segments,
        source: event.source,
      };
      return;

    case "summary":
      run.terminal = "summary";
      run.terminalSummary = event;
      run.stage = "complete";
      run.message = "Summary complete";
      return;

    case "error":
      // The event's message and errorId are transport data. They are useful
      // to server logs, but neither is trusted enough to become user copy or
      // the public lifecycle code.
      throw terminalFailure("processing", "PROCESSING_FAILURE");

    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function validateCompletedRun(run: RunAccumulator): TerminalSummaryEvent {
  if (run.metadataCount !== 1 || run.metadata === null) {
    throw new SummaryRunProtocolFailure("MISSING_METADATA");
  }
  if (run.summaryText.trim().length === 0) {
    throw new SummaryRunProtocolFailure("EMPTY_SUMMARY");
  }
  if (run.terminal !== "summary" || run.terminalSummary === null) {
    throw new SummaryRunPrematureEofFailure();
  }
  return run.terminalSummary;
}

function summaryFromRun(
  run: RunAccumulator,
  terminal: TerminalSummaryEvent,
): CompletedSummary {
  const metadata = run.metadata;
  if (!metadata) throw new SummaryRunProtocolFailure("MISSING_METADATA");

  const transcript =
    run.transcript.status === "available" ? run.transcript : undefined;
  const segments = transcript ? freezeSegments(transcript.segments) : undefined;

  return Object.freeze({
    title: metadata.title?.trim() || "Video Summary",
    duration: `${terminal.total_time.toFixed(1)}s total`,
    summary: run.summaryText,
    transcriptionTime: terminal.transcribe_time,
    summaryTime: terminal.summarize_time,
    ...(transcript
      ? {
          segments,
          transcriptSource: transcript.source,
        }
      : {}),
    origin: metadata.cached ? "cache" : "generated",
  });
}

function makeRunningSnapshot(
  run: ActiveRun,
  now: number,
): SummaryRunRunningSnapshot {
  return Object.freeze({
    status: "running" as const,
    runId: run.id,
    input: run.input,
    draft: freezeDraft(run.summaryText),
    progress: freezeProgress(run, now),
    origin: run.metadata?.cached ? "cache" : run.metadata ? "generated" : null,
    transcript: freezeTranscript(run.transcript),
  });
}

export function createSummaryRunController(
  options: SummaryRunControllerOptions,
): SummaryRunController {
  const listeners = new Set<(snapshot: SummaryRunSnapshot) => void>();
  const now = options.now ?? (() => Date.now());
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const runIdFactory = options.createRunId ?? createRunId;
  const elapsedTickMs = options.elapsedTickMs ?? 100;

  let snapshot: SummaryRunSnapshot = Object.freeze({ status: "idle" });
  let activeRun: ActiveRun | null = null;
  let lastFailedInput: SummaryRunInput | null = null;
  const allocatedRunIds = new Set<string>();
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  const notify = () => {
    for (const listener of [...listeners]) listener(snapshot);
  };

  const setSnapshot = (next: SummaryRunSnapshot) => {
    snapshot = next;
    notify();
  };

  const stopElapsedTimer = () => {
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  };

  const startElapsedTimer = (run: ActiveRun) => {
    stopElapsedTimer();
    elapsedTimer = setInterval(() => {
      if (activeRun?.id !== run.id) return;
      setSnapshot(makeRunningSnapshot(run, now()));
    }, elapsedTickMs);
  };

  const allocateRunId = (): string => {
    const requestedId = runIdFactory();
    if (!allocatedRunIds.has(requestedId)) {
      allocatedRunIds.add(requestedId);
      return requestedId;
    }

    let sequence = 1;
    let distinctId = `${requestedId}-retry-${sequence}`;
    while (allocatedRunIds.has(distinctId)) {
      sequence += 1;
      distinctId = `${requestedId}-retry-${sequence}`;
    }
    allocatedRunIds.add(distinctId);
    return distinctId;
  };

  const failRun = (run: ActiveRun, error: unknown) => {
    if (activeRun?.id !== run.id || run.controller.signal.aborted) return;
    stopElapsedTimer();
    const failure = toFailure(error);
    run.controller.abort();
    activeRun = null;
    lastFailedInput = run.input;
    setSnapshot(
      Object.freeze({
        status: "failed" as const,
        runId: run.id,
        input: run.input,
        draft: freezeDraft(run.summaryText),
        progress: freezeProgress(run, now()),
        origin:
          run.metadata?.cached === true
            ? ("cache" as const)
            : run.metadata
              ? ("generated" as const)
              : null,
        transcript: freezeTranscript(run.transcript),
        error: Object.freeze(failure),
      }),
    );
  };

  const succeedRun = (run: ActiveRun, terminal: TerminalSummaryEvent) => {
    if (activeRun?.id !== run.id || run.controller.signal.aborted) return;
    stopElapsedTimer();
    const summary = summaryFromRun(run, terminal);
    if (summary.origin !== "cache" && summary.origin !== "generated") {
      failRun(run, new SummaryRunProtocolFailure("MISSING_ORIGIN"));
      return;
    }
    activeRun = null;
    setSnapshot(
      Object.freeze({
        status: "succeeded" as const,
        runId: run.id,
        input: run.input,
        summary,
        progress: freezeProgress(run, now(), "complete", "Summary complete"),
        origin: summary.origin,
        transcript: freezeTranscript(run.transcript),
      }),
    );
  };

  const processDecodedItems = (
    run: ActiveRun,
    items: SummarySseDecodeItem[],
  ) => {
    for (const item of items) {
      if (item.kind === "error") {
        if (run.terminal !== null) {
          throw new SummaryRunProtocolFailure("EVENT_AFTER_TERMINATION");
        }
        if (item.error.code === "invalid_full_transcript") {
          run.transcript = {
            status: "unavailable",
            diagnostic: item.error.code,
          };
          if (activeRun?.id === run.id) {
            setSnapshot(makeRunningSnapshot(run, now()));
          }
          continue;
        }
        throw item.error;
      }

      reduceEvent(run, item.event);
      if (activeRun?.id === run.id) {
        setSnapshot(makeRunningSnapshot(run, now()));
      }
    }
  };

  const execute = async (run: ActiveRun): Promise<void> => {
    try {
      if (!fetchImpl) throw new Error("Fetch is not available");

      const accessToken = await options.getAccessToken();
      if (!accessToken) {
        throw new SummaryRequestError(
          "No authentication available. Please wait a moment while we set up anonymous access.",
          401,
          "AUTH_REQUIRED",
        );
      }
      if (run.controller.signal.aborted) return;

      const requestBodyResult = SummaryRequestSchema.safeParse({
        youtube_url: run.input.video.youtubeUrl,
        include_transcript: run.input.includeTranscript,
        ...(run.input.outputLanguage !== null
          ? { output_language: run.input.outputLanguage }
          : {}),
      });
      if (!requestBodyResult.success) {
        throw new SummaryRequestError("Invalid request body", 400, "INVALID_REQUEST");
      }

      const requestId = resolveRequestId(undefined);
      const response = await fetchImpl("/api/summarize/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          [REQUEST_ID_HEADER]: requestId,
        },
        body: JSON.stringify(requestBodyResult.data),
        signal: run.controller.signal,
      });

      if (run.controller.signal.aborted) return;
      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          // The status code remains sufficient to classify the failure. The
          // body is never used as user-facing copy.
        }
        if (run.controller.signal.aborted) return;
        if (response.status === 402) {
          throw new SummaryQuotaRequestFailure(
            quotaInfoFromResponse(errorData),
          );
        }

        const classification = requestFailureForStatus(response.status);
        const message = getSummaryRunFailureMessage(classification);
        if (classification.kind === "authentication") {
          options.onAuthError?.(response.status, message);
        }
        throw new SummaryRequestError(
          message,
          response.status,
          classification.code,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Failed to get response reader");

      const textDecoder = new TextDecoder();
      const sseDecoder = new SummarySseStreamDecoder();
      while (true) {
        if (run.controller.signal.aborted) return;
        const { done, value } = await reader.read();
        if (done) {
          const trailingText = textDecoder.decode();
          if (trailingText) {
            processDecodedItems(run, sseDecoder.pushRecovering(trailingText));
          }
          processDecodedItems(run, sseDecoder.finishRecovering());
          break;
        }
        const chunk = textDecoder.decode(value, { stream: true });
        if (chunk) processDecodedItems(run, sseDecoder.pushRecovering(chunk));
      }

      const terminal = validateCompletedRun(run);
      succeedRun(run, terminal);
    } catch (error) {
      if (run.controller.signal.aborted) return;
      failRun(run, error);
    }
  };

  const start = (input: SummaryRunInput): Promise<void> => {
    if (activeRun) {
      activeRun.controller.abort();
      activeRun = null;
      stopElapsedTimer();
    }

    const capturedInput = freezeInput(input);
    lastFailedInput = null;
    const run: ActiveRun = {
      id: allocateRunId(),
      input: capturedInput,
      startedAt: now(),
      controller: new AbortController(),
      summaryText: "",
      metadata: null,
      metadataCount: 0,
      stage: "preparing",
      message: DEFAULT_PROGRESS_MESSAGE,
      transcript: initialTranscriptState(capturedInput.includeTranscript),
      terminal: null,
      terminalSummary: null,
    };
    activeRun = run;
    setSnapshot(makeRunningSnapshot(run, now()));
    startElapsedTimer(run);
    return execute(run);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    cancel: () => {
      if (!activeRun) return;
      const run = activeRun;
      run.controller.abort();
      activeRun = null;
      stopElapsedTimer();
      setSnapshot(
        Object.freeze({
          status: "cancelled" as const,
          runId: run.id,
          input: run.input,
          draft: freezeDraft(run.summaryText),
          progress: freezeProgress(run, now()),
          origin:
            run.metadata?.cached === true
              ? ("cache" as const)
              : run.metadata
                ? ("generated" as const)
                : null,
          transcript: freezeTranscript(run.transcript),
        }),
      );
    },
    retry: () =>
      snapshot.status === "failed" && lastFailedInput
        ? start(lastFailedInput)
        : Promise.resolve(),
  };
}
