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
  "five_source_retrieval",
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
  retrievalMaterialReadySources: 20,
  retrievalRepresentedSources: 20,
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

const provenance = {
  fixtureCatalogVersion: 2,
  repositoryRevision: "0123456789abcdef0123456789abcdef01234567",
  repositoryTreeState: "clean",
} as const;

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
        provenance,
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
        provenance,
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
      provenance,
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
      provenance,
      fixtureResults: REQUIRED_FIXTURE_IDS.map((id) => ({ id, passed: true })),
    });

    expect(report.decision).toBe("eligible_for_ga_review");
    expect(report.failures).toEqual([]);
    expect(report.observations.fixturePassRatePct).toBe(100);
    expect(report.observations).toMatchObject({
      retrievalRepresentedSources: 20,
      retrievalMaterialReadySources: 20,
      retrievalRepresentationPct: 100,
      retrievalFixturesPassed: 6,
      retrievalFixturesRequired: 6,
      retrievalFixturePassRatePct: 100,
    });
    expect(report.provenance).toEqual(provenance);
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
      provenance,
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
      provenance,
      fixtureResults: REQUIRED_FIXTURE_IDS.map((id) => ({ id, passed: true })),
    });

    expect(report.decision).toBe("controlled_beta");
    expect(report.failures).toContainEqual({
      gate: "citation_resolution",
      failureClass: "citation_measurement_incomplete",
    });
  });

  it("keeps rollout controlled when even one material ready source is absent from retrieval", () => {
    const report = buildProjectReadinessReport({
      generatedAt: "2026-08-11T06:00:00.000Z",
      window: {
        start: "2026-07-12T06:00:00.000Z",
        end: "2026-08-11T06:00:00.000Z",
      },
      observations: {
        ...observations,
        retrievalMaterialReadySources: 5,
        retrievalRepresentedSources: 4,
      },
      policy,
      provenance,
      fixtureResults: REQUIRED_FIXTURE_IDS.map((id) => ({ id, passed: true })),
    });

    expect(report.decision).toBe("controlled_beta");
    expect(report.failures).toContainEqual({
      gate: "retrieval_source_representation",
      failureClass: "silent_source_exclusion",
    });
    expect(report.observations.retrievalRepresentationPct).toBe(80);
  });
});
