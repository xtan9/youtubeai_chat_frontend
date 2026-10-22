import {
  SummaryRequestSchema,
  SummarySseStreamDecoder,
  type SummarySseDecodeItem,
} from "@/lib/api-contracts/summary";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/lib/request-id";
import {
  type SummaryRunInput,
  type SummaryRunOutcome,
  type SummaryRunSnapshot,
  type SummaryRunController,
  type SummaryRunControllerOptions,
} from "./summary-run-types";
import {
  SummaryRequestError,
  getSummaryRunFailureMessage,
  SummaryRunProtocolFailure,
  SummaryQuotaRequestFailure,
  requestFailureForStatus,
  toFailure,
  quotaInfoFromResponse,
} from "./summary-run-failures";
import {
  type TerminalSummaryEvent,
  type ActiveRun,
  freezeInput,
  freezeDraft,
  freezeProgress,
  freezeTranscript,
  initialTranscriptState,
  reduceEvent,
  validateCompletedRun,
  summaryFromRun,
  successOutcomeForRun,
  failureOutcomeForRun,
  makeRunningSnapshot,
} from "./summary-run-state";

const DEFAULT_PROGRESS_MESSAGE = "Preparing summary...";

export function createRunId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return `summary-run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  const isCurrentRun = (run: ActiveRun): boolean =>
    activeRun === run && !run.controller.signal.aborted;

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
      if (!isCurrentRun(run)) return;
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

  const emitOutcome = (run: ActiveRun, outcome: SummaryRunOutcome): void => {
    if (run.outcomeEmitted) return;
    run.outcomeEmitted = true;
    try {
      options.onOutcome?.(outcome);
    } catch {
      // An observer is an integration boundary. It must never turn a
      // terminal Summary Run into a second lifecycle failure.
    }
  };

  const failRun = (run: ActiveRun, error: unknown) => {
    if (!isCurrentRun(run)) return;
    stopElapsedTimer();
    const failure = toFailure(error);
    const outcome = failureOutcomeForRun(run, failure);
    activeRun = null;
    lastFailedInput = run.input;
    run.controller.abort();
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
    emitOutcome(run, outcome);
  };

  const succeedRun = (run: ActiveRun, terminal: TerminalSummaryEvent) => {
    if (!isCurrentRun(run)) return;
    stopElapsedTimer();
    const summary = summaryFromRun(run, terminal);
    if (summary.origin !== "cache" && summary.origin !== "generated") {
      failRun(run, new SummaryRunProtocolFailure("MISSING_ORIGIN"));
      return;
    }
    const outcome = successOutcomeForRun(run, terminal, summary.origin);
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
    emitOutcome(run, outcome);
  };

  const processDecodedItems = (
    run: ActiveRun,
    items: SummarySseDecodeItem[],
  ) => {
    for (const item of items) {
      if (!isCurrentRun(run)) return;
      if (item.kind === "error") {
        if (run.terminal !== null) {
          throw new SummaryRunProtocolFailure("EVENT_AFTER_TERMINATION");
        }
        if (item.error.code === "invalid_full_transcript") {
          run.transcript = {
            status: "unavailable",
            diagnostic: item.error.code,
          };
          if (isCurrentRun(run)) {
            setSnapshot(makeRunningSnapshot(run, now()));
          }
          continue;
        }
        throw item.error;
      }

      reduceEvent(run, item.event);
      if (isCurrentRun(run)) {
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
      if (!isCurrentRun(run)) return;

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

      if (!isCurrentRun(run)) return;
      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          // The status code remains sufficient to classify the failure. The
          // body is never used as user-facing copy.
        }
        if (!isCurrentRun(run)) return;
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
        if (!isCurrentRun(run)) return;
        const { done, value } = await reader.read();
        if (!isCurrentRun(run)) return;
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
      if (!isCurrentRun(run)) return;
      failRun(run, error);
    }
  };

  const start = (input: SummaryRunInput): Promise<void> => {
    if (activeRun) {
      const previousRun = activeRun;
      activeRun = null;
      stopElapsedTimer();
      previousRun.controller.abort();
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
      outcomeEmitted: false,
    };
    activeRun = run;
    startElapsedTimer(run);
    setSnapshot(makeRunningSnapshot(run, now()));
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
      activeRun = null;
      stopElapsedTimer();
      run.controller.abort();
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

export {
  type SummaryRunVideo,
  type SummaryRunInput,
  type SummaryRunStage,
  type SummaryRunOrigin,
  SUMMARY_TRANSCRIPT_DIAGNOSTICS,
  type SummaryTranscriptDiagnostic,
  SUMMARY_RUN_FAILURE_KINDS,
  type SummaryRunFailureKind,
  type SummaryRunFailureCode,
  type SummaryQuotaErrorCode,
  type SummaryRunQuotaInfo,
  type SummaryTranscriptState,
  type SummaryRunProgress,
  type SummaryDraft,
  type SummaryRunFailure,
  type SummaryRunTiming,
  type SummaryRunSuccessOutcome,
  type SummaryRunFailureOutcome,
  type SummaryRunOutcome,
  type SummaryRunOutcomeObserver,
  type CompletedSummary,
  type SummaryRunIdleSnapshot,
  type SummaryRunRunningSnapshot,
  type SummaryRunSucceededSnapshot,
  type SummaryRunFailedSnapshot,
  type SummaryRunCancelledSnapshot,
  type SummaryRunSnapshot,
  type SummaryRunController,
  type SummaryRunControllerOptions,
} from "./summary-run-types";

export {
  SummaryRequestError,
  SUMMARY_RUN_FAILURE_MESSAGES,
  getSummaryRunFailureMessage,
} from "./summary-run-failures";
