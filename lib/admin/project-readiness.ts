import { z } from "zod";

export const PROJECT_READINESS_FIXTURE_IDS = [
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

const CountSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const ProjectReadinessFixtureResultSchema = z
  .object({
    id: z.enum(PROJECT_READINESS_FIXTURE_IDS),
    passed: z.boolean(),
    failureClass: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u).optional(),
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.passed && fixture.failureClass !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Passing fixture evidence cannot carry a failure class.",
      });
    }
  });

const ProjectReadinessInputSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    window: z
      .object({ start: z.iso.datetime(), end: z.iso.datetime() })
      .strict(),
    observations: z
      .object({
        citationCandidates: CountSchema,
        resolvedCitations: CountSchema,
        citationMeasuredAnswers: CountSchema,
        groundedAnswers: CountSchema,
        coverageIntegrityAnswers: CountSchema,
        processingSucceeded: CountSchema,
        processingFailed: CountSchema,
        measuredGenerations: CountSchema,
        generationEvents: CountSchema,
        activeProjects: CountSchema,
        costUsdMicros: CountSchema,
        eligibleActivatedProjects: CountSchema,
        returnedProjects: CountSchema,
      })
      .strict(),
    policy: z
      .object({
        maxProcessingFailurePct: z.number().min(0).max(100).nullable(),
        maxCostPerActivatedProjectUsdMicros: CountSchema.nullable(),
      })
      .strict(),
    fixtureResults: z.array(ProjectReadinessFixtureResultSchema),
  })
  .strict()
  .superRefine((input, context) => {
    const start = Date.parse(input.window.start);
    const end = Date.parse(input.window.end);
    const generatedAt = Date.parse(input.generatedAt);
    if (start >= end || end > generatedAt) {
      context.addIssue({ code: "custom", message: "Report dates are inconsistent." });
    }
    const observations = input.observations;
    for (const [actual, total, path] of [
      [observations.resolvedCitations, observations.citationCandidates, "resolvedCitations"],
      [observations.citationMeasuredAnswers, observations.groundedAnswers, "citationMeasuredAnswers"],
      [observations.coverageIntegrityAnswers, observations.groundedAnswers, "coverageIntegrityAnswers"],
      [observations.measuredGenerations, observations.generationEvents, "measuredGenerations"],
      [observations.returnedProjects, observations.eligibleActivatedProjects, "returnedProjects"],
    ] as const) {
      if (actual > total) {
        context.addIssue({
          code: "custom",
          path: ["observations", path],
          message: "Observed subset exceeds its total.",
        });
      }
    }
    const seen = new Set<string>();
    for (const fixture of input.fixtureResults) {
      if (seen.has(fixture.id)) {
        context.addIssue({
          code: "custom",
          path: ["fixtureResults"],
          message: "Fixture evidence IDs must be unique.",
        });
      }
      seen.add(fixture.id);
    }
  });

export type ProjectReadinessFixtureResult = z.infer<
  typeof ProjectReadinessFixtureResultSchema
>;
export type ProjectReadinessInput = z.infer<typeof ProjectReadinessInputSchema>;

export function parseProjectReadinessInput(value: unknown): ProjectReadinessInput {
  const parsed = ProjectReadinessInputSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid Project readiness input");
  return parsed.data;
}

export function buildProjectReadinessReport(input: ProjectReadinessInput) {
  input = parseProjectReadinessInput(input);
  const fixturesById = new Map(
    input.fixtureResults.map((fixture) => [fixture.id, fixture]),
  );
  const fixtureGates = PROJECT_READINESS_FIXTURE_IDS.map((id) => {
    const fixture = fixturesById.get(id);
    if (!fixture) return failedGate(id, "evidence_missing");
    return fixture.passed
      ? passedGate(id)
      : failedGate(id, fixture.failureClass ?? "fixture_failed");
  });
  const observations = {
    citationResolutionPct: percentage(
      input.observations.resolvedCitations,
      input.observations.citationCandidates,
    ),
    sourceCoverageIntegrityPct: percentage(
      input.observations.coverageIntegrityAnswers,
      input.observations.groundedAnswers,
    ),
    processingFailurePct: percentage(
      input.observations.processingFailed,
      input.observations.processingSucceeded + input.observations.processingFailed,
    ),
    measuredCostCoveragePct: percentage(
      input.observations.measuredGenerations,
      input.observations.generationEvents,
    ),
    costPerActivatedProjectUsdMicros: ratio(
      input.observations.costUsdMicros,
      input.observations.activeProjects,
    ),
    sevenDayReturnBaselinePct: percentage(
      input.observations.returnedProjects,
      input.observations.eligibleActivatedProjects,
    ),
    fixturePassRatePct: percentage(
      fixtureGates.filter((gate) => gate.status === "passed").length,
      PROJECT_READINESS_FIXTURE_IDS.length,
    ),
  };
  const productionGates = [
    input.observations.citationMeasuredAnswers === input.observations.groundedAnswers &&
    input.observations.citationCandidates > 0 &&
    observations.citationResolutionPct === 100
      ? passedGate("citation_resolution")
      : failedGate(
          "citation_resolution",
          input.observations.citationMeasuredAnswers !== input.observations.groundedAnswers
            ? "citation_measurement_incomplete"
            : input.observations.citationCandidates === 0
            ? "observation_missing"
            : "citation_resolution_regression",
        ),
    input.observations.groundedAnswers > 0 &&
    observations.sourceCoverageIntegrityPct === 100
      ? passedGate("source_coverage_integrity")
      : failedGate(
          "source_coverage_integrity",
          input.observations.groundedAnswers === 0
            ? "observation_missing"
            : "source_coverage_integrity",
        ),
    input.policy.maxProcessingFailurePct !== null &&
    input.observations.processingSucceeded + input.observations.processingFailed > 0 &&
    observations.processingFailurePct <= input.policy.maxProcessingFailurePct
      ? passedGate("processing_reliability")
      : failedGate(
          "processing_reliability",
          input.policy.maxProcessingFailurePct === null
            ? "policy_missing"
            : input.observations.processingSucceeded + input.observations.processingFailed === 0
            ? "observation_missing"
            : "processing_failure_rate",
        ),
    input.policy.maxCostPerActivatedProjectUsdMicros !== null &&
    input.observations.activeProjects > 0 &&
    input.observations.generationEvents > 0 &&
    observations.measuredCostCoveragePct === 100 &&
    observations.costPerActivatedProjectUsdMicros <=
      input.policy.maxCostPerActivatedProjectUsdMicros
      ? passedGate("cost_guardrail")
      : failedGate(
          "cost_guardrail",
          input.policy.maxCostPerActivatedProjectUsdMicros === null
            ? "policy_missing"
            : input.observations.activeProjects === 0 ||
          input.observations.generationEvents === 0
            ? "observation_missing"
            : observations.measuredCostCoveragePct !== 100
              ? "cost_measurement_incomplete"
              : "cost_guardrail_exceeded",
        ),
  ];
  const gates = [...fixtureGates, ...productionGates];
  const failures = gates.flatMap((gate) =>
    gate.status === "failed"
      ? [{ gate: gate.id, failureClass: gate.failureClass }]
      : [],
  );

  return {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    window: input.window,
    decision: failures.length === 0
      ? "eligible_for_ga_review" as const
      : "controlled_beta" as const,
    failures,
    gates,
    observations,
    retention: {
      status: "observed_baseline" as const,
      sevenDayReturnPct: observations.sevenDayReturnBaselinePct,
      targetPct: null,
    },
    scope: {
      included: ["youtube_projects_up_to_five_videos"] as const,
      excluded: [
        "external_web_research",
        "mixed_sources",
        "projects_over_five_videos",
      ] as const,
    },
  };
}

function passedGate(id: string) {
  return { id, status: "passed" as const };
}

function failedGate(id: string, failureClass: string) {
  return { id, status: "failed" as const, failureClass };
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0
    ? 0
    : Math.round((numerator / denominator) * 1_000) / 10;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round(numerator / denominator);
}
