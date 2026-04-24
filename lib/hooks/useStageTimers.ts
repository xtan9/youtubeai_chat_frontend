"use client";

import { useEffect, useRef, useState } from "react";
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

// Pure transition: given the prior recorded timestamps, the current stage,
// and a wall-clock `now`, return the next state. Boundaries are sticky —
// once a stage end is captured, later transitions never overwrite it. This
// means the very first time we see e.g. "summarizing" wins, even if a later
// "complete" event also implies "transcribe ended."
export function advanceStageTimerState(
  prev: StageTimerState,
  stage: StreamingProgress["stage"] | undefined,
  now: number
): StageTimerState {
  if (!stage) return prev;
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

// Pure elapsed-time math, in seconds. Server-reported finals win when
// they're positive (the SSE `summary` event fires for both live and cached
// paths, and is more accurate than wall-clock since it excludes network
// latency from the start). Otherwise fall back to wall-clock from the
// recorded boundaries — using `now` for the unfrozen end so the value
// ticks up while the stage is still in flight.
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

  const transcriptionTime =
    finalTimes.transcriptionTime && finalTimes.transcriptionTime > 0
      ? finalTimes.transcriptionTime
      : Math.max(0, liveTranscription);
  const summaryTime =
    finalTimes.summaryTime && finalTimes.summaryTime > 0
      ? finalTimes.summaryTime
      : Math.max(0, liveSummary);

  return { transcriptionTime, summaryTime };
}

// React wrapper: tracks stage transitions on a single state machine and
// ticks every 100ms while the run is in flight so the UI re-renders.
// `finalTimes` short-circuit the live computation as soon as the server's
// terminal `summary` event lands.
export function useStageTimers(
  stage: StreamingProgress["stage"] | undefined,
  finalTimes: StageTimerFinals
): StageTimerValues {
  const [state, setState] = useState<StageTimerState>(INITIAL_STATE);
  const [now, setNow] = useState<number>(() => performance.now());
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const t = performance.now();
    const next = advanceStageTimerState(stateRef.current, stage, t);
    if (next !== stateRef.current) {
      // Only commit when something actually changed — referential equality
      // from the helper means no transition happened and we'd cause a no-op
      // render loop otherwise.
      const changed =
        next.startedAt !== stateRef.current.startedAt ||
        next.transcribeEndedAt !== stateRef.current.transcribeEndedAt ||
        next.summarizeEndedAt !== stateRef.current.summarizeEndedAt;
      if (changed) {
        setState(next);
        setNow(t);
      }
    }
  }, [stage]);

  const isComplete = stage === "complete";

  useEffect(() => {
    if (isComplete || state.startedAt === null) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [isComplete, state.startedAt]);

  return computeStageElapsed(state, now, finalTimes);
}
