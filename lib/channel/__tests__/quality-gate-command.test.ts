import { describe, expect, it } from "vitest";

import { executeChannelQualityGateCommand } from "../quality-gate-command";

describe("Channel quality-gate command", () => {
  it("publishes a blocked report when the frozen aggregate artifact is absent", async () => {
    const report = await executeChannelQualityGateCommand({
      inputPath:
        "C:/definitely-not-a-channel-quality-gate-input/channel-gate.json",
    });

    expect(report.decision).toBe("blocked");
    expect(report.releaseReviewEligible).toBe(false);
    expect(report.productionActivationPerformed).toBe(false);
    expect(report.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "quality_gate_input_missing",
        "harness_evidence_missing",
        "corpus_evidence_missing",
        "final_tuple_evaluation_missing",
        "evaluation_observations_missing",
      ]),
    );
  });

  it("fails closed when the artifact is not valid JSON", async () => {
    const report = await executeChannelQualityGateCommand({
      inputPath: "C:/definitely-not-a-channel-quality-gate-input/broken.json",
      readFile: async () => "{not-json",
    });

    expect(report.decision).toBe("blocked");
    expect(report.failures[0]).toMatchObject({
      code: "quality_gate_input_json_invalid",
    });
  });
});
