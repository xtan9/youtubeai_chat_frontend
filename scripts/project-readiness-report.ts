import { spawn } from "node:child_process";
import { z } from "zod";

import {
  buildProjectAdoptionQuery,
  parseProjectAdoptionMetrics,
  parseProjectAdoptionReturnedProjects,
  type ProjectAdoptionQueryResult,
} from "../lib/analytics/project-adoption-query";
import {
  runProjectReadinessFixtures,
  type ProjectReadinessFixtureCommand,
} from "../lib/admin/project-readiness-fixtures";
import { buildProjectReadinessReport } from "../lib/admin/project-readiness";

const PostHogResultSchema = z
  .object({
    columns: z.array(z.string()),
    results: z.array(z.array(z.unknown())),
  })
  .passthrough();

async function main() {
  const generatedAt = new Date();
  const query = buildProjectAdoptionQuery({ windowDays: 30, now: generatedAt });
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
  if (
    command.executable === "psql" &&
    process.env.PROJECT_READINESS_ALLOW_DATABASE_FIXTURES !== "true"
  ) {
    throw new Error("DatabaseFixtureSafetyConfirmationMissing");
  }
  process.stderr.write(`Running Project readiness fixture group: ${command.id}\n`);
  return new Promise<{ exitCode: number }>((resolve, reject) => {
    const executable = command.executable === "node" ? process.execPath : command.executable;
    const child = spawn(executable, [...command.args], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ exitCode: code ?? 1 }));
  });
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
