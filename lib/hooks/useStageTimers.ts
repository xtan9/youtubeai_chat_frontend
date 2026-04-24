"use client";

import { useEffect, useState } from "react";
import type { StreamingProgress } from "@/app/summary/utils";

export interface StageTimerState {
  startedAt: number | null;
  transcribeEndedAt: number | null;
  summarizeEndedAt: number | null;
}

export interface StageTimerFinals {
  transcriptionTime?: number;
  summaryTime?: number;
}

export interface StageTimerValues {
  transcriptionTime: number;
  summaryTime: number;
}

const INITIAL_STATE: StageTimerState = {
  startedAt: null,
  transcribeEndedAt: null,
  summarizeEndedAt: null,
};

// Boundaries are sticky: the first transition into "summarizing" or
// "complete" wins, so a later event can't reset transcribeEndedAt and
// zero out the summary stopwatch. Exception: a fresh run on the same
// component instance — detected when stage regresses to "preparing"/
// "transcribing" after we already sealed summarizeEndedAt — must clear
// all boundaries so the new run's stopwatch doesn't inherit the previous
// run's startedAt.
export function advanceStageTimerState(
  prev: StageTimerState,
  stage: StreamingProgress["stage"] | undefined,
  now: number
): StageTimerState {
  if (!stage) return prev;
  const isRestart =
    (stage === "preparing" || stage === "transcribing") &&
    prev.summarizeEndedAt !== null;
  if (isRestart) {
    return { startedAt: now, transcribeEndedAt: null, summarizeEndedAt: null };
  }
  const next: StageTimerState = { ...prev };
  if (next.startedAt === null) next.startedAt = now;
  if (
    (stage === "summarizing" || stage === "complete") &&
    next.transcribeEndedAt === null
  ) {
    next.transcribeEndedAt = now;
  }
  if (stage === "complete" && next.summarizeEndedAt === null) {
    next.summarizeEndedAt = now;
  }
  return next;
}

// Server-reported timings supersede the wall-clock tick once present.
// The upstream parser coalesces missing values to 0 (utils.ts), so we
// treat 0 as "not reported yet" and keep the running stopwatch visible
// until a positive number arrives.
export function computeStageElapsed(
  state: StageTimerState,
  now: number,
  finalTimes: StageTimerFinals
): StageTimerValues {
  const liveTranscription =
    state.startedAt === null
      ? 0
      : ((state.transcribeEndedAt ?? now) - state.startedAt) / 1000;
  const liveSummary =
    state.transcribeEndedAt === null
      ? 0
      : ((state.summarizeEndedAt ?? now) - state.transcribeEndedAt) / 1000;

  const finalTranscription = finalTimes.transcriptionTime;
  const finalSummary = finalTimes.summaryTime;
  const transcriptionTime =
    typeof finalTranscription === "number" &&
    Number.isFinite(finalTranscription) &&
    finalTranscription > 0
      ? finalTranscription
      : Math.max(0, liveTranscription);
  const summaryTime =
    typeof finalSummary === "number" &&
    Number.isFinite(finalSummary) &&
    finalSummary > 0
      ? finalSummary
      : Math.max(0, liveSummary);

  return { transcriptionTime, summaryTime };
}

export function useStageTimers(
  stage: StreamingProgress["stage"] | undefined,
  finalTimes: StageTimerFinals
): StageTimerValues {
  const [state, setState] = useState<StageTimerState>(INITIAL_STATE);
  const [now, setNow] = useState<number>(() => performance.now());

  useEffect(() => {
    const t = performance.now();
    setState((prev) => {
      const next = advanceStageTimerState(prev, stage, t);
      return next === prev ? prev : next;
    });
    setNow(t);
  }, [stage]);

  const isComplete = stage === "complete";
  useEffect(() => {
    if (isComplete || state.startedAt === null) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [isComplete, state.startedAt]);

  return computeStageElapsed(state, now, finalTimes);
}
