import { z } from "zod";

import {
  buildProjectAdoptionQuery,
  parseProjectAdoptionMetrics,
  parseProjectAdoptionReturnedProjects,
  type ProjectAdoptionQueryResult,
} from "../lib/analytics/project-adoption-query";
import {
  PROJECT_READINESS_FIXTURE_CATALOG_VERSION,
  runProjectReadinessFixtures,
  type ProjectReadinessFixtureCommand,
} from "../lib/admin/project-readiness-fixtures";
import { buildProjectReadinessReport } from "../lib/admin/project-readiness";
import { runBoundedCommand } from "../lib/admin/project-readiness-command";
import {
  buildDisposableReadinessPsqlEnvironment,
  resolveDisposableReadinessDatabase,
} from "../lib/admin/project-readiness-database";

const PostHogResultSchema = z
  .object({
    columns: z.array(z.string()),
    results: z.array(z.array(z.unknown())),
  })
  .passthrough();

async function main() {
  const generatedAt = new Date();
  const query = buildProjectAdoptionQuery({ windowDays: 30, now: generatedAt });
  const repositoryRevision = await loadCleanRepositoryRevision();
  const fixtureResults = await runProjectReadinessFixtures(runFixtureCommand);
  const observations = await loadProductionObservations(query).catch((error) => {
    process.stderr.write(
      `Production aggregate metrics unavailable: ${error instanceof Error ? error.name : "UnknownError"}\n`,
    );
    return emptyObservations();
  });
  const report = buildProjectReadinessReport({
    generatedAt: generatedAt.toISOString(),
    window: query.window,
    provenance: {
      fixtureCatalogVersion: PROJECT_READINESS_FIXTURE_CATALOG_VERSION,
      repositoryRevision,
      repositoryTreeState: "clean",
    },
    observations,
    policy: {
      maxProcessingFailurePct: readOptionalPolicyNumber(
        "PROJECT_READINESS_MAX_PROCESSING_FAILURE_PCT",
        100,
      ),
      maxCostPerActivatedProjectUsdMicros: readOptionalPolicyNumber(
        "PROJECT_READINESS_MAX_COST_PER_ACTIVATED_PROJECT_USD_MICROS",
        Number.MAX_SAFE_INTEGER,
      ),
    },
    fixtureResults,
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.decision !== "eligible_for_ga_review") process.exitCode = 2;
}

async function loadProductionObservations(
  query: ReturnType<typeof buildProjectAdoptionQuery>,
) {
  const [metricsResult, returnResult] = await Promise.all([
    executePostHogQuery(query.metricsHogql, "project_readiness_metrics_30_day"),
    executePostHogQuery(query.returnHogql, "project_readiness_d7_return_30_day"),
  ]);
  const metrics = parseProjectAdoptionMetrics(metricsResult);
  const returns = parseProjectAdoptionReturnedProjects(returnResult);
  return {
    citationCandidates: metrics.citationCandidates,
    resolvedCitations: metrics.resolvedCitations,
    citationMeasuredAnswers: metrics.citationMeasuredAnswers,
    groundedAnswers: metrics.groundedAnswers,
    coverageIntegrityAnswers: metrics.coverageIntegrityAnswers,
    retrievalMaterialReadySources: metrics.groundedReadyVideos,
    retrievalRepresentedSources: metrics.groundedUsedVideos,
    processingSucceeded: metrics.processingSucceeded,
    processingFailed: metrics.processingFailed,
    measuredGenerations: metrics.measuredGenerations,
    generationEvents: metrics.generationEvents,
    activeProjects: metrics.costEligibleActivatedProjects,
    costUsdMicros: metrics.costUsdMicros,
    eligibleActivatedProjects: returns.eligibleActivatedProjects,
    returnedProjects: returns.returnedProjects,
  };
}

async function executePostHogQuery(
  hogql: string,
  name: string,
): Promise<ProjectAdoptionQueryResult> {
  const projectId = process.env.POSTHOG_PROJECT_ID?.trim();
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  const host = (process.env.POSTHOG_QUERY_HOST?.trim() || "https://us.posthog.com")
    .replace(/\/+$/u, "");
  if (!projectId || !personalApiKey) throw new Error("PostHogConfigurationUnavailable");
  const response = await fetch(
    `${host}/api/projects/${encodeURIComponent(projectId)}/query/`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${personalApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql }, name }),
    },
  );
  if (!response.ok) throw new Error("PostHogQueryFailed");
  const parsed = PostHogResultSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("PostHogSchemaMismatch");
  return parsed.data;
}

async function runFixtureCommand(command: ProjectReadinessFixtureCommand) {
  process.stderr.write(`Running Project readiness fixture group: ${command.id}\n`);
  let childEnvironment = process.env;
  if (command.executable === "psql") {
    const target = resolveDisposableReadinessDatabase(process.env);
    childEnvironment = buildDisposableReadinessPsqlEnvironment(
      process.env,
      target,
    );
  }
  return runBoundedCommand({
    executable: command.executable === "node" ? process.execPath : command.executable,
    args: command.args,
    timeoutMs: command.timeoutMs,
    cwd: process.cwd(),
    env: childEnvironment,
    onStdout: (chunk) => process.stderr.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
}

async function loadCleanRepositoryRevision() {
  const result = await runBoundedCommand({
    executable: "git",
    args: ["rev-parse", "HEAD"],
    timeoutMs: 5_000,
    cwd: process.cwd(),
    env: process.env,
    captureStdout: true,
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  const revision = result.stdout?.trim() ?? "";
  if (result.exitCode !== 0 || result.timedOut || !/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error("RepositoryRevisionUnavailable");
  }
  const status = await runBoundedCommand({
    executable: "git",
    args: ["status", "--porcelain=v1", "--untracked-files=normal"],
    timeoutMs: 5_000,
    cwd: process.cwd(),
    env: process.env,
    captureStdout: true,
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  if (status.exitCode !== 0 || status.timedOut || status.stdout?.trim()) {
    throw new Error("RepositoryTreeNotClean");
  }
  return revision;
}

function readOptionalPolicyNumber(name: string, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function emptyObservations() {
  return {
    citationCandidates: 0,
    resolvedCitations: 0,
    citationMeasuredAnswers: 0,
    groundedAnswers: 0,
    coverageIntegrityAnswers: 0,
    retrievalMaterialReadySources: 0,
    retrievalRepresentedSources: 0,
    processingSucceeded: 0,
    processingFailed: 0,
    measuredGenerations: 0,
    generationEvents: 0,
    activeProjects: 0,
    costUsdMicros: 0,
    eligibleActivatedProjects: 0,
    returnedProjects: 0,
  };
}

void main().catch((error) => {
  process.stderr.write(
    `Project readiness report failed: ${error instanceof Error ? error.name : "UnknownError"}\n`,
  );
  process.exitCode = 1;
});
