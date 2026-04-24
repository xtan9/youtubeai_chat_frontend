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
    const next = advanceStageTimerState(fresh(), "preparing", 1_000);
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
    // Regression guard: a later "complete" event re-setting transcribeEndedAt
    // would zero out the summary stopwatch.
    const seeded: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: null,
    };
    const after = advanceStageTimerState(seeded, "complete", 9_000);
    expect(after.transcribeEndedAt).toBe(4_000);
    expect(after.summarizeEndedAt).toBe(9_000);
  });

  it("closes both stopwatches when stage=complete arrives without a prior summarizing", () => {
    // Defensive: today the parser always emits "summarizing" first
    // (content events set stage=summarizing before the summary event flips
    // to complete). Future event-ordering changes that drop the
    // intermediate tick must still leave both boundaries closed.
    const after = advanceStageTimerState(fresh(), "complete", 5_000);
    expect(after.startedAt).toBe(5_000);
    expect(after.transcribeEndedAt).toBe(5_000);
    expect(after.summarizeEndedAt).toBe(5_000);
  });

  it("returns the same reference when stage is undefined", () => {
    // The hook depends on this for its render-loop bailout.
    const seeded = fresh();
    expect(advanceStageTimerState(seeded, undefined, 123)).toBe(seeded);
  });

  it("resets all boundaries when a new run starts on the same component instance", () => {
    // Without this, a second submission would tick from the first run's
    // startedAt — the user would see e.g. "327.4s" the moment they hit
    // submit again. Regresses if the if-null guards on startedAt are
    // taken to imply "always sticky."
    const completed: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: 9_000,
    };
    const restarted = advanceStageTimerState(completed, "preparing", 50_000);
    expect(restarted).toEqual({
      startedAt: 50_000,
      transcribeEndedAt: null,
      summarizeEndedAt: null,
    });
  });

  it("does not reset a still-running run when stage flips back to transcribing", () => {
    // Restart is gated on summarizeEndedAt being set (the previous run
    // actually finished). A status event flipping back mid-run must not
    // restart the clock.
    const midRun: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: null,
    };
    const after = advanceStageTimerState(midRun, "transcribing", 6_000);
    expect(after.startedAt).toBe(1_000);
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
    expect(computeStageElapsed(state, 99_000, {})).toEqual({
      transcriptionTime: 3,
      summaryTime: 5,
    });
  });

  it("prefers positive server-reported finals over the live tick", () => {
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

  it("treats NaN finals as missing", () => {
    // Math on coerced upstream values can produce NaN; the live tick
    // must not be silently overwritten by it.
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: 7_000,
    };
    expect(
      computeStageElapsed(state, 7_000, {
        transcriptionTime: Number.NaN,
        summaryTime: Number.NaN,
      })
    ).toEqual({ transcriptionTime: 3, summaryTime: 3 });
  });

  it("uses each final independently when only one is reported", () => {
    const state: StageTimerState = {
      startedAt: 1_000,
      transcribeEndedAt: 4_000,
      summarizeEndedAt: null,
    };
    expect(
      computeStageElapsed(state, 6_000, {
        transcriptionTime: 12.3,
        summaryTime: undefined,
      })
    ).toEqual({ transcriptionTime: 12.3, summaryTime: 2 });
  });

  it("clamps to zero when now < startedAt (clock skew between setNow and setState)", () => {
    // The hook commits setNow(t) and setState(advance(..., t)) with the
    // same t, but the interval ticker can write a slightly later setNow
    // between them. Removing this clamp would render -0.x seconds for
    // one frame at every transition.
    const state: StageTimerState = {
      startedAt: 5_000,
      transcribeEndedAt: null,
      summarizeEndedAt: null,
    };
    expect(computeStageElapsed(state, 4_000, {})).toEqual({
      transcriptionTime: 0,
      summaryTime: 0,
    });
  });
});
