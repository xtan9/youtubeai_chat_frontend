import { BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER } from "./queries";

const DAY_MS = 86_400_000;

export type ProjectAdoptionWindowDays = 7 | 30;

export interface ProjectAdoptionQueryResult {
  columns: string[];
  results: unknown[][];
}

export interface ProjectAdoptionMetrics {
  projectsCreated: number;
  activatedProjects: number;
  searches: number;
  messages: number;
  firstMessages: number;
  subsequentMessages: number;
  artifacts: number;
  citationClicks: number;
  helpfulFeedback: number;
  notHelpfulFeedback: number;
  paywallViews: number;
  searchResults: number;
  searchPassagesExamined: number;
  groundedAnswers: number;
  coverageIntegrityAnswers: number;
  groundedTotalVideos: number;
  groundedReadyVideos: number;
  groundedUsedVideos: number;
  groundedUnavailableVideos: number;
  groundedPassagesExamined: number;
  groundedPassagesUsed: number;
  citationDiagnostics: number;
  answersWithCitationDiagnostics: number;
  processingSucceeded: number;
  processingFailed: number;
  generationEvents: number;
  measuredGenerations: number;
  activeCostProjects: number;
  generationDurationMs: number;
  costUsdMicros: number;
}

export interface ProjectAdoptionFailureRow {
  errorClass: string;
  events: number;
  projects: number;
}

const REPORT_EVENTS = [
  "project_created",
  "project_activated",
  "project_search_completed",
  "project_message_sent",
  "project_grounded_answer_completed",
  "project_artifact_generation_completed",
  "project_citation_clicked",
  "project_answer_feedback_submitted",
  "project_paywall_viewed",
  "project_limit_reached",
  "project_video_processing_succeeded",
  "project_video_processing_failed",
  "project_artifact_generation_blocked",
  "project_action_failed",
  "project_generation_cost_recorded",
] as const;

const FAILURE_CLASSES = new Set([
  "authentication",
  "authorization",
  "quota",
  "rate_limit",
  "request",
  "network",
  "processing",
  "protocol",
  "persistence",
  "interrupted",
  "evidence",
  "generation",
]);

export function buildProjectAdoptionQuery(input: {
  windowDays: ProjectAdoptionWindowDays;
  now: Date;
}) {
  if (input.windowDays !== 7 && input.windowDays !== 30) {
    throw new Error("Project adoption reporting supports 7 or 30 days");
  }
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Project adoption reporting requires a valid date");
  }
  const window = {
    start: new Date(input.now.getTime() - input.windowDays * DAY_MS).toISOString(),
    end: input.now.toISOString(),
  };
  const returnCohort = {
    start: new Date(
      new Date(window.start).getTime() - 7 * DAY_MS,
    ).toISOString(),
    end: new Date(new Date(window.end).getTime() - 7 * DAY_MS).toISOString(),
  };
  const timeFilter = [
    `timestamp >= ${hogqlDateTime(window.start)}`,
    `timestamp < ${hogqlDateTime(window.end)}`,
  ].join(" AND ");
  const events = REPORT_EVENTS.map(quote).join(", ");
  const distinctProjects = (event: string) =>
    `count(DISTINCT if(event = '${event}', properties['project_id'], NULL))`;
  const coverageIntegrity = [
    "event = 'project_grounded_answer_completed'",
    "toUInt64OrZero(properties['ready_videos']) + toUInt64OrZero(properties['unavailable_videos']) = toUInt64OrZero(properties['total_videos'])",
    "toUInt64OrZero(properties['used_videos']) <= toUInt64OrZero(properties['ready_videos'])",
    "toUInt64OrZero(properties['passages_used']) <= toUInt64OrZero(properties['passages_examined'])",
  ].join(" AND ");

  return {
    window,
    metricsHogql: [
      "SELECT",
      `  ${distinctProjects("project_created")} AS projects_created,`,
      `  ${distinctProjects("project_activated")} AS activated_projects,`,
      "  countIf(event = 'project_search_completed') AS searches,",
      "  countIf(event = 'project_message_sent') AS messages,",
      "  countIf(event = 'project_message_sent' AND properties['message_kind'] = 'first') AS first_messages,",
      "  countIf(event = 'project_message_sent' AND properties['message_kind'] = 'subsequent') AS subsequent_messages,",
      "  countIf(event = 'project_artifact_generation_completed') AS artifacts,",
      "  countIf(event = 'project_citation_clicked') AS citation_clicks,",
      "  countIf(event = 'project_answer_feedback_submitted' AND properties['rating'] = 'helpful') AS helpful_feedback,",
      "  countIf(event = 'project_answer_feedback_submitted' AND properties['rating'] = 'not_helpful') AS not_helpful_feedback,",
      "  countIf(event IN ('project_paywall_viewed', 'project_limit_reached')) AS paywall_views,",
      "  sumIf(toUInt64OrZero(properties['result_count']), event = 'project_search_completed') AS search_results,",
      "  sumIf(toUInt64OrZero(properties['passages_examined']), event = 'project_search_completed') AS search_passages_examined,",
      "  countIf(event = 'project_grounded_answer_completed') AS grounded_answers,",
      `  countIf(${coverageIntegrity}) AS coverage_integrity_answers,`,
      "  sumIf(toUInt64OrZero(properties['total_videos']), event = 'project_grounded_answer_completed') AS grounded_total_videos,",
      "  sumIf(toUInt64OrZero(properties['ready_videos']), event = 'project_grounded_answer_completed') AS grounded_ready_videos,",
      "  sumIf(toUInt64OrZero(properties['used_videos']), event = 'project_grounded_answer_completed') AS grounded_used_videos,",
      "  sumIf(toUInt64OrZero(properties['unavailable_videos']), event = 'project_grounded_answer_completed') AS grounded_unavailable_videos,",
      "  sumIf(toUInt64OrZero(properties['passages_examined']), event = 'project_grounded_answer_completed') AS grounded_passages_examined,",
      "  sumIf(toUInt64OrZero(properties['passages_used']), event = 'project_grounded_answer_completed') AS grounded_passages_used,",
      "  sumIf(toUInt64OrZero(properties['citation_diagnostics']), event = 'project_grounded_answer_completed') AS citation_diagnostics,",
      "  countIf(event = 'project_grounded_answer_completed' AND toUInt64OrZero(properties['citation_diagnostics']) > 0) AS answers_with_citation_diagnostics,",
      "  countIf(event = 'project_video_processing_succeeded') AS processing_succeeded,",
      "  countIf(event = 'project_video_processing_failed') AS processing_failed,",
      "  countIf(event = 'project_generation_cost_recorded') AS generation_events,",
      "  countIf(event = 'project_generation_cost_recorded' AND properties['cost_status'] = 'measured') AS measured_generations,",
      `  ${distinctProjects("project_generation_cost_recorded")} AS active_cost_projects,`,
      "  sumIf(toUInt64OrZero(properties['duration_ms']), event = 'project_generation_cost_recorded') AS generation_duration_ms,",
      "  sumIf(toUInt64OrZero(properties['cost_usd_micros']), event = 'project_generation_cost_recorded' AND properties['cost_status'] = 'measured') AS cost_usd_micros",
      "FROM events",
      `WHERE ${timeFilter}`,
      `  AND event IN (${events})`,
      `  AND ${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
    ].join("\n"),
    returnHogql: [
      "WITH activation_history AS (",
      "  SELECT",
      "    properties['project_id'] AS project_id,",
      "    argMax(parseDateTime64BestEffortOrNull(properties['activation_occurred_at']), toUInt64OrZero(properties['activation_revision'])) AS activated_at",
      "  FROM events",
      "  WHERE event = 'project_activated'",
      `    AND timestamp < ${hogqlDateTime(window.end)}`,
      `    AND ${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
      "  GROUP BY project_id",
      "), activated AS (",
      "  SELECT project_id, activated_at",
      "  FROM activation_history",
      `  WHERE activated_at >= ${hogqlDateTime(returnCohort.start)}`,
      `    AND activated_at < ${hogqlDateTime(returnCohort.end)}`,
      "), opened AS (",
      "  SELECT properties['project_id'] AS project_id, timestamp AS opened_at",
      "  FROM events",
      "  WHERE event = 'project_opened'",
      `    AND ${timeFilter}`,
      `    AND ${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
      ")",
      "SELECT",
      "  count(DISTINCT activated.project_id) AS eligible_activated_projects,",
      "  count(DISTINCT if(opened.opened_at >= activated.activated_at + INTERVAL 7 DAY, opened.project_id, NULL)) AS returned_projects",
      "FROM activated",
      "LEFT JOIN opened ON opened.project_id = activated.project_id",
    ].join("\n"),
    failuresHogql: [
      "SELECT",
      "  if(event = 'project_artifact_generation_blocked', properties['failure_category'], properties['error_class']) AS error_class,",
      "  count() AS events,",
      "  count(DISTINCT properties['project_id']) AS projects",
      "FROM events",
      `WHERE ${timeFilter}`,
      "  AND event IN ('project_action_failed', 'project_video_processing_failed', 'project_artifact_generation_blocked')",
      `  AND ${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
      "GROUP BY error_class",
      "ORDER BY events DESC, error_class",
    ].join("\n"),
  };
}

const METRIC_COLUMNS = {
  projectsCreated: "projects_created",
  activatedProjects: "activated_projects",
  searches: "searches",
  messages: "messages",
  firstMessages: "first_messages",
  subsequentMessages: "subsequent_messages",
  artifacts: "artifacts",
  citationClicks: "citation_clicks",
  helpfulFeedback: "helpful_feedback",
  notHelpfulFeedback: "not_helpful_feedback",
  paywallViews: "paywall_views",
  searchResults: "search_results",
  searchPassagesExamined: "search_passages_examined",
  groundedAnswers: "grounded_answers",
  coverageIntegrityAnswers: "coverage_integrity_answers",
  groundedTotalVideos: "grounded_total_videos",
  groundedReadyVideos: "grounded_ready_videos",
  groundedUsedVideos: "grounded_used_videos",
  groundedUnavailableVideos: "grounded_unavailable_videos",
  groundedPassagesExamined: "grounded_passages_examined",
  groundedPassagesUsed: "grounded_passages_used",
  citationDiagnostics: "citation_diagnostics",
  answersWithCitationDiagnostics: "answers_with_citation_diagnostics",
  processingSucceeded: "processing_succeeded",
  processingFailed: "processing_failed",
  generationEvents: "generation_events",
  measuredGenerations: "measured_generations",
  activeCostProjects: "active_cost_projects",
  generationDurationMs: "generation_duration_ms",
  costUsdMicros: "cost_usd_micros",
} as const;

export function parseProjectAdoptionMetrics(
  result: ProjectAdoptionQueryResult,
): ProjectAdoptionMetrics {
  if (result.results.length !== 1) throw new Error("Project adoption returned invalid metrics");
  const indexes = indexColumns(result.columns);
  const row = result.results[0];
  return Object.fromEntries(
    Object.entries(METRIC_COLUMNS).map(([property, column]) => [
      property,
      readCount(row, indexes, column, "metrics"),
    ]),
  ) as unknown as ProjectAdoptionMetrics;
}

export function parseProjectAdoptionReturnedProjects(
  result: ProjectAdoptionQueryResult,
) {
  if (result.results.length !== 1) throw new Error("Project adoption returned invalid return metrics");
  const indexes = indexColumns(result.columns);
  const row = result.results[0];
  const eligibleActivatedProjects = readCount(
    row,
    indexes,
    "eligible_activated_projects",
    "return metrics",
  );
  const returnedProjects = readCount(
    row,
    indexes,
    "returned_projects",
    "return metrics",
  );
  if (returnedProjects > eligibleActivatedProjects) {
    throw new Error("Project adoption returned invalid return metrics");
  }
  return { eligibleActivatedProjects, returnedProjects };
}

export function parseProjectAdoptionFailureRows(
  result: ProjectAdoptionQueryResult,
): ProjectAdoptionFailureRow[] {
  const indexes = indexColumns(result.columns);
  return result.results.map((row) => {
    const index = indexes.get("error_class");
    const errorClass = index === undefined ? undefined : row[index];
    if (typeof errorClass !== "string" || !FAILURE_CLASSES.has(errorClass)) {
      throw new Error("Project adoption returned an invalid failure class");
    }
    return {
      errorClass,
      events: readCount(row, indexes, "events", "failure metrics"),
      projects: readCount(row, indexes, "projects", "failure metrics"),
    };
  });
}

function indexColumns(columns: readonly string[]) {
  return new Map(columns.map((column, index) => [column, index]));
}

function readCount(
  row: readonly unknown[],
  indexes: ReadonlyMap<string, number>,
  column: string,
  group: string,
) {
  const index = indexes.get(column);
  const raw = index === undefined ? undefined : row[index];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Project adoption returned invalid ${group}`);
  }
  return value;
}

function hogqlDateTime(iso: string) {
  return `toDateTime64('${iso}', 3, 'UTC')`;
}

function quote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
