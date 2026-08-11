import { describe, expect, it } from "vitest";

import {
  buildProjectReadinessReport,
  parseProjectReadinessInput,
} from "../project-readiness";

const REQUIRED_FIXTURE_IDS = [
  "citation_identity",
  "fabricated_citations",
  "source_coverage",
  "transcript_truncation",
  "retrieval",
  "multilingual_project",
  "long_project",
  "disagreement_abstention",
  "project_rls",
  "evidence_snapshot_privacy",
  "analytics_privacy",
  "service_role_boundaries",
  "project_creation_atomic_cap",
  "project_message_atomic_cap",
  "artifact_generation_atomic_cap",
  "video_processing_reliability",
] as const;

const observations = {
  citationCandidates: 20,
  resolvedCitations: 20,
  citationMeasuredAnswers: 10,
  groundedAnswers: 10,
  coverageIntegrityAnswers: 10,
  processingSucceeded: 19,
  processingFailed: 1,
  measuredGenerations: 8,
  generationEvents: 8,
  activeProjects: 4,
  costUsdMicros: 80_000,
  eligibleActivatedProjects: 6,
  returnedProjects: 3,
};

const policy = {
  maxProcessingFailurePct: 10,
  maxCostPerActivatedProjectUsdMicros: 25_000,
};

describe("buildProjectReadinessReport", () => {
  it("fails closed at the report boundary for malformed, duplicate, or contradictory evidence", () => {
    expect(() =>
      parseProjectReadinessInput({
        generatedAt: "not-a-date",
        window: {
          start: "2026-08-11T06:00:00.000Z",
          end: "2026-08-10T06:00:00.000Z",
        },
        observations: {
          ...observations,
          resolvedCitations: 21,
        },
        policy: {
          maxProcessingFailurePct: 101,
          maxCostPerActivatedProjectUsdMicros: -1,
        },
        fixtureResults: [
          { id: "citation_identity", passed: true },
          { id: "citation_identity", passed: true },
        ],
      }),
    ).toThrow(/invalid Project readiness input/i);
  });

  it("rejects unknown fixture IDs instead of letting ungoverned evidence into the report", () => {
    expect(() =>
      parseProjectReadinessInput({
        generatedAt: "2026-08-11T06:00:00.000Z",
        window: {
          start: "2026-07-12T06:00:00.000Z",
          end: "2026-08-11T06:00:00.000Z",
        },
        observations,
        policy,
        fixtureResults: [{ id: "looks_reassuring", passed: true }],
      }),
    ).toThrow(/invalid Project readiness input/i);
  });

  it("keeps controlled availability when a required trust fixture fails", () => {
    const report = buildProjectReadinessReport({
      generatedAt: "2026-08-11T06:00:00.000Z",
      window: {
        start: "2026-07-12T06:00:00.000Z",
        end: "2026-08-11T06:00:00.000Z",
      },
      observations,
      policy,
      fixtureResults: [
        { id: "citation_identity", passed: false, failureClass: "wrong_video" },
      ],
    });

    expect(report.decision).toBe("controlled_beta");
    expect(report.failures).toContainEqual({
      gate: "citation_identity",
      failureClass: "wrong_video",
    });
    expect(report.observations).toMatchObject({
      citationResolutionPct: 100,
      sourceCoverageIntegrityPct: 100,
      processingFailurePct: 5,
      costPerActivatedProjectUsdMicros: 20_000,
      sevenDayReturnBaselinePct: 50,
    });
    expect(report.retention).toEqual({
      status: "observed_baseline",
      sevenDayReturnPct: 50,
      targetPct: null,
    });
    expect(report.scope.excluded).toEqual([
      "external_web_research",
      "mixed_sources",
      "projects_over_five_videos",
    ]);
  });

  it("marks a complete passing report eligible for human GA review", () => {
    const report = buildProjectReadinessReport({
      generatedAt: "2026-08-11T06:00:00.000Z",
      window: {
        start: "2026-07-12T06:00:00.000Z",
        end: "2026-08-11T06:00:00.000Z",
      },
      observations,
      policy,
      fixtureResults: REQUIRED_FIXTURE_IDS.map((id) => ({ id, passed: true })),
    });

    expect(report.decision).toBe("eligible_for_ga_review");
    expect(report.failures).toEqual([]);
    expect(report.observations.fixturePassRatePct).toBe(100);
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
    expect(report.retention.targetPct).toBeNull();
  });

  it("does not invent processing or cost policy when operators have not approved it", () => {
    const report = buildProjectReadinessReport({
      generatedAt: "2026-08-11T06:00:00.000Z",
      window: {
        start: "2026-07-12T06:00:00.000Z",
        end: "2026-08-11T06:00:00.000Z",
      },
      observations,
      policy: {
        maxProcessingFailurePct: null,
        maxCostPerActivatedProjectUsdMicros: null,
      },
      fixtureResults: REQUIRED_FIXTURE_IDS.map((id) => ({ id, passed: true })),
    });

    expect(report.decision).toBe("controlled_beta");
    expect(report.failures).toEqual(
      expect.arrayContaining([
        { gate: "processing_reliability", failureClass: "policy_missing" },
        { gate: "cost_guardrail", failureClass: "policy_missing" },
      ]),
    );
    expect(report.retention.targetPct).toBeNull();
  });

  it("keeps rollout controlled when legacy Grounded Answers lack citation measurement", () => {
    const report = buildProjectReadinessReport({
      generatedAt: "2026-08-11T06:00:00.000Z",
      window: {
        start: "2026-07-12T06:00:00.000Z",
        end: "2026-08-11T06:00:00.000Z",
      },
      observations: { ...observations, citationMeasuredAnswers: 1 },
      policy,
      fixtureResults: REQUIRED_FIXTURE_IDS.map((id) => ({ id, passed: true })),
    });

    expect(report.decision).toBe("controlled_beta");
    expect(report.failures).toContainEqual({
      gate: "citation_resolution",
      failureClass: "citation_measurement_incomplete",
    });
  });
});
