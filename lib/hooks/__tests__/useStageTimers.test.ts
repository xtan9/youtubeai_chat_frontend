import { describe, it, expect } from "vitest";
import {
  advanceStageTimerState,
  computeStageElapsed,
  type StageTimerState,
} from "../useStageTimers";

const fresh = (): StageTimerState => ({
  startedAt: null,
  transcribeEndedAt: null,
  summarizeEndedAt: null,
});

describe("advanceStageTimerState", () => {
  it("captures startedAt on the first observed stage", () => {
    const next = advanceStageTimerState(fresh(), "downloading", 1_000);
    expect(next.startedAt).toBe(1_000);
    expect(next.transcribeEndedAt).toBeNull();
    expect(next.summarizeEndedAt).toBeNull();
  });

  it("freezes transcribeEndedAt the first time stage hits summarizing", () => {
    const after = advanceStageTimerState(
      { startedAt: 1_000, transcribeEndedAt: null, summarizeEndedAt: null },
      "summarizing",
      4_000
    );
    expect(after.transcribeEndedAt).toBe(4_000);
    expect(after.summarizeEndedAt).toBeNull();
  });

  it("never overwrites a recorded boundary on later transitions", () => {
    // Regression guard: stickiness matters because if a later "complete"
    // event re-set transcribeEndedAt, the summary stopwatch would always
    // read 0s.
    const seeded: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: null,
    };
    const after = advanceStageTimerState(seeded, "complete", 9_000);
    expect(after.transcribeEndedAt).toBe(4_000);
    expect(after.summarizeEndedAt).toBe(9_000);
  });

  it("treats stage=complete as ending both stopwatches when transcribe never fired", () => {
    // Cached path: server emits metadata + content + summary back-to-back,
    // so the parsed stage may jump straight to 'complete' without an
    // intervening 'summarizing' tick. Both boundaries must still close so
    // the live-tick fallback doesn't read negative or unbounded time.
    const after = advanceStageTimerState(fresh(), "complete", 5_000);
    expect(after.startedAt).toBe(5_000);
    expect(after.transcribeEndedAt).toBe(5_000);
    expect(after.summarizeEndedAt).toBe(5_000);
  });

  it("returns the same reference when stage is undefined", () => {
    // Hook depends on referential equality to avoid render loops when the
    // upstream parser hasn't produced a stage yet.
    const seeded = fresh();
    expect(advanceStageTimerState(seeded, undefined, 123)).toBe(seeded);
  });
});

describe("computeStageElapsed", () => {
  it("returns zeros before any stage has been observed", () => {
    expect(computeStageElapsed(fresh(), 5_000, {})).toEqual({
      transcriptionTime: 0,
      summaryTime: 0,
    });
  });

  it("ticks transcription time against `now` while the stage is in flight", () => {
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: null,
      summarizeEndedAt: null,
    };
    expect(computeStageElapsed(state, 3_500, {})).toEqual({
      transcriptionTime: 2.5,
      summaryTime: 0,
    });
  });

  it("freezes transcription and ticks summary once transcription closes", () => {
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: null,
    };
    expect(computeStageElapsed(state, 7_500, {})).toEqual({
      transcriptionTime: 3,
      summaryTime: 3.5,
    });
  });

  it("freezes both values once summary closes", () => {
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: 9_000,
    };
    // `now` advancing past summarizeEndedAt must not push the stopwatch.
    expect(computeStageElapsed(state, 99_000, {})).toEqual({
      transcriptionTime: 3,
      summaryTime: 5,
    });
  });

  it("prefers positive server-reported finals over the live tick", () => {
    // Once the SSE `summary` event arrives the server's measured times are
    // canonical — they exclude the network latency baked into our wall-
    // clock baseline.
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: null,
      summarizeEndedAt: null,
    };
    expect(
      computeStageElapsed(state, 99_000, {
        transcriptionTime: 12.3,
        summaryTime: 4.7,
      })
    ).toEqual({ transcriptionTime: 12.3, summaryTime: 4.7 });
  });

  it("falls back to the live tick when finals are zero or undefined", () => {
    // Defensive: a buggy upstream that emits a `summary` event with
    // zeroed-out times must not erase the running stopwatch we've been
    // showing the user.
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: 7_000,
    };
    expect(
      computeStageElapsed(state, 7_000, {
        transcriptionTime: 0,
        summaryTime: undefined,
      })
    ).toEqual({ transcriptionTime: 3, summaryTime: 3 });
  });
});
