import "server-only";

import {
  buildProjectAdoptionQuery,
  parseProjectAdoptionFailureRows,
  parseProjectAdoptionMetrics,
  parseProjectAdoptionReturnedProjects,
  type ProjectAdoptionMetrics,
  type ProjectAdoptionWindowDays,
  type ProjectAdoptionFailureRow,
} from "@/lib/analytics/project-adoption-query";
import {
  executePostHogHogQlQuery,
  type PostHogHogQlRequest,
  type PostHogHogQlResult,
} from "@/lib/analytics/posthog-query";

export interface ProjectAdoptionReport {
  windowDays: ProjectAdoptionWindowDays;
  window: { start: string; end: string };
  metrics: ProjectAdoptionMetrics & {
    eligibleActivatedProjects: number;
    returnedProjects: number;
  };
  ratios: {
    sevenDayReturnPct: number;
    sourceReadyAtAddPct: number;
    helpfulFeedbackPct: number;
    retrievalYieldPct: number;
    sourceCoverageIntegrityPct: number;
    processingFailurePct: number;
    answersWithCitationDiagnosticsPct: number;
    measuredCostCoveragePct: number;
    averageGenerationDurationMs: number;
    costPerActiveProjectUsdMicros: number;
  };
  failures: ProjectAdoptionFailureRow[];
  isCached: boolean;
}

export async function loadProjectAdoptionReport(
  input: { windowDays: ProjectAdoptionWindowDays; now: Date },
  dependencies: {
    executeQuery?: (request: PostHogHogQlRequest) => Promise<PostHogHogQlResult>;
  } = {},
): Promise<ProjectAdoptionReport> {
  const query = buildProjectAdoptionQuery(input);
  const executeQuery = dependencies.executeQuery ?? executePostHogHogQlQuery;
  const [metricResult, returnResult, failureResult] = await Promise.all([
    executeQuery({
      hogql: query.metricsHogql,
      name: `project_adoption_metrics_${input.windowDays}_day`,
    }),
    executeQuery({
      hogql: query.returnHogql,
      name: `project_adoption_seven_day_return_${input.windowDays}_day`,
    }),
    executeQuery({
      hogql: query.failuresHogql,
      name: `project_adoption_failures_${input.windowDays}_day`,
    }),
  ]);
  const baseMetrics = parseProjectAdoptionMetrics(metricResult);
  const returnMetrics = parseProjectAdoptionReturnedProjects(returnResult);
  const metrics = { ...baseMetrics, ...returnMetrics };

  return {
    windowDays: input.windowDays,
    window: query.window,
    metrics,
    ratios: {
      sevenDayReturnPct: percentage(
        metrics.returnedProjects,
        metrics.eligibleActivatedProjects,
      ),
      sourceReadyAtAddPct: percentage(
        metrics.readySourcesAdded,
        metrics.sourcesAdded,
      ),
      helpfulFeedbackPct: percentage(
        metrics.helpfulFeedback,
        metrics.helpfulFeedback + metrics.notHelpfulFeedback,
      ),
      retrievalYieldPct: percentage(metrics.searchResults, metrics.searchPassagesExamined),
      sourceCoverageIntegrityPct: percentage(
        metrics.coverageIntegrityAnswers,
        metrics.groundedAnswers,
      ),
      processingFailurePct: percentage(
        metrics.processingFailed,
        metrics.processingSucceeded + metrics.processingFailed,
      ),
      answersWithCitationDiagnosticsPct: percentage(
        metrics.answersWithCitationDiagnostics,
        metrics.groundedAnswers,
      ),
      measuredCostCoveragePct: percentage(
        metrics.measuredGenerations,
        metrics.generationEvents,
      ),
      averageGenerationDurationMs: ratio(
        metrics.generationDurationMs,
        metrics.generationEvents,
      ),
      costPerActiveProjectUsdMicros: ratio(
        metrics.costUsdMicros,
        metrics.costEligibleActivatedProjects,
      ),
    },
    failures: parseProjectAdoptionFailureRows(failureResult),
    isCached:
      metricResult.isCached && returnResult.isCached && failureResult.isCached,
  };
}

function percentage(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1_000) / 10;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.round(numerator / denominator);
}
