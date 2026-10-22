import { type SummarySseEvent } from "@/lib/api-contracts/summary";
import type { TranscriptSegment } from "@/lib/types";
import {
  type SummaryRunInput,
  type SummaryRunStage,
  type SummaryRunOrigin,
  type SummaryTranscriptState,
  type SummaryRunProgress,
  type SummaryDraft,
  type SummaryRunFailure,
  type SummaryRunSuccessOutcome,
  type SummaryRunFailureOutcome,
  type CompletedSummary,
  type SummaryRunRunningSnapshot,
} from "./summary-run-types";
import {
  SummaryRunProtocolFailure,
  SummaryRunPrematureEofFailure,
  terminalFailure,
} from "./summary-run-failures";

type MetadataEvent = Extract<SummarySseEvent, { type: "metadata" }>;

export type TerminalSummaryEvent = Extract<SummarySseEvent, { type: "summary" }>;

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

export interface ActiveRun extends RunAccumulator {
  readonly id: string;
  readonly controller: AbortController;
  outcomeEmitted: boolean;
}

export function freezeInput(input: SummaryRunInput): SummaryRunInput {
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

export function freezeDraft(text: string): SummaryDraft {
  return Object.freeze({ text });
}

function freezeSegments(
  segments: readonly TranscriptSegment[],
): readonly TranscriptSegment[] {
  return Object.freeze(
    segments.map((segment) => Object.freeze({ ...segment })),
  );
}

export function freezeProgress(
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

export function freezeTranscript(
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

export function initialTranscriptState(
  includeTranscript: boolean,
): SummaryTranscriptState {
  return includeTranscript
    ? { status: "unavailable", diagnostic: "not_received" }
    : { status: "not_requested" };
}

function statusStage(stage: Extract<SummarySseEvent, { type: "status" }>["stage"]):
  | "transcribing"
  | "summarizing" {
  return stage === "transcribe" ? "transcribing" : "summarizing";
}

export function reduceEvent(run: RunAccumulator, event: SummarySseEvent): void {
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

export function validateCompletedRun(run: RunAccumulator): TerminalSummaryEvent {
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

export function summaryFromRun(
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

export function successOutcomeForRun(
  run: ActiveRun,
  terminal: TerminalSummaryEvent,
  origin: SummaryRunOrigin,
): SummaryRunSuccessOutcome {
  return Object.freeze({
    outcome: "success" as const,
    runId: run.id,
    outputLanguage: run.input.outputLanguage,
    origin,
    timings: Object.freeze({
      totalSeconds: terminal.total_time,
      transcriptionSeconds: terminal.transcribe_time,
      summarySeconds: terminal.summarize_time,
    }),
  });
}

export function failureOutcomeForRun(
  run: ActiveRun,
  failure: SummaryRunFailure,
): SummaryRunFailureOutcome {
  return Object.freeze({
    outcome: "failure" as const,
    runId: run.id,
    outputLanguage: run.input.outputLanguage,
    failure: Object.freeze({
      kind: failure.kind,
      code: failure.code,
      ...(failure.status !== undefined ? { status: failure.status } : {}),
    }),
  });
}

export function makeRunningSnapshot(
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
