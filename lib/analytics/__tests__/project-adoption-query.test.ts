import { describe, expect, it } from "vitest";
import {
  buildProjectAdoptionQuery,
  parseProjectAdoptionFailureRows,
  parseProjectAdoptionMetrics,
} from "../project-adoption-query";

const METRIC_COLUMNS = [
  "projects_created",
  "activated_projects",
  "searches",
  "messages",
  "first_messages",
  "subsequent_messages",
  "artifacts",
  "citation_clicks",
  "helpful_feedback",
  "not_helpful_feedback",
  "paywall_views",
  "sources_added",
  "history_sources_added",
  "youtube_url_sources_added",
  "ready_sources_added",
  "processing_sources_added",
  "search_results",
  "search_passages_examined",
  "grounded_answers",
  "coverage_integrity_answers",
  "grounded_total_videos",
  "grounded_ready_videos",
  "grounded_used_videos",
  "grounded_unavailable_videos",
  "grounded_passages_examined",
  "grounded_passages_used",
  "citation_diagnostics",
  "answers_with_citation_diagnostics",
  "citation_candidates",
  "resolved_citations",
  "citation_measured_answers",
  "processing_succeeded",
  "processing_failed",
  "generation_events",
  "measured_generations",
  "cost_eligible_activated_projects",
  "generation_duration_ms",
  "cost_usd_micros",
] as const;

describe("Project adoption PostHog query", () => {
  it("builds bounded 7d/30d metrics and same-Project seven-day return queries", () => {
    const query = buildProjectAdoptionQuery({
      windowDays: 7,
      now: new Date("2026-08-10T12:00:00.000Z"),
    });

    expect(query.window).toEqual({
      start: "2026-08-03T12:00:00.000Z",
      end: "2026-08-10T12:00:00.000Z",
    });
    expect(query.metricsHogql).toContain("project_generation_cost_recorded");
    expect(query.metricsHogql).toContain("project_grounded_answer_completed");
    expect(query.metricsHogql).toContain("project_video_processing_succeeded");
    expect(query.metricsHogql).toContain("project_message_sent");
    expect(query.metricsHogql).toContain("properties['rating'] = 'helpful'");
    expect(query.metricsHogql).toContain("properties['cost_usd_micros']");
    expect(query.metricsHogql).toContain("properties['citation_candidates']");
    expect(query.metricsHogql).toContain("properties['resolved_citations']");
    expect(query.metricsHogql).toContain("properties['citation_measurement_status']");
    expect(query.metricsHogql).toContain("analytics_subject");
    expect(query.returnHogql).toContain("argMax(");
    expect(query.returnHogql).toContain("properties['activation_revision']");
    expect(query.returnHogql).toContain("opened.project_id = activated.project_id");
    expect(query.returnHogql).toContain("opened.opened_at >= activated.activated_at + INTERVAL 7 DAY");
    expect(query.returnHogql).toContain("opened.opened_at < activated.activated_at + INTERVAL 8 DAY");
    expect(query.returnHogql).toContain("eligible_activated_projects");
    expect(query.returnHogql).toContain("2026-07-27T12:00:00.000Z");
    expect(query.returnHogql).toContain("2026-08-02T12:00:00.000Z");
    expect(query.returnHogql).toContain("activated_at <= toDateTime64('2026-08-02T12:00:00.000Z'");
    expect(query.returnHogql).not.toContain("opened.opened_at <= activated.activated_at + INTERVAL 8 DAY");
    expect(query.returnHogql).toContain("event = 'project_opened'");
    expect(query.returnHogql).toContain("analytics_subject");
    expect(query.metricsHogql).toContain("event = 'project_source_added'");
    expect(query.metricsHogql).toContain("properties['source_kind'] = 'history'");
    expect(query.metricsHogql).toContain("properties['source_kind'] = 'youtube_url'");
    expect(query.metricsHogql).toContain("properties['readiness'] = 'ready'");
    expect(query.metricsHogql).toContain("properties['readiness'] = 'processing'");
    expect(query.metricsHogql).toContain("cost_eligible_activated_projects");
    expect(query.metricsHogql).toContain("'project_opened'");
  });

  it.each([0, 14, 31])("rejects an unsupported %d-day window", (windowDays) => {
    expect(() =>
      buildProjectAdoptionQuery({
        windowDays: windowDays as 7,
        now: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).toThrow("Project adoption reporting supports 7 or 30 days");
  });

  it("parses named metrics independent of provider column order", () => {
    const values = Object.fromEntries(
      METRIC_COLUMNS.map((column, index) => [column, index + 1]),
    );
    const columns = [...METRIC_COLUMNS].reverse();

    expect(
      parseProjectAdoptionMetrics({
        columns,
        results: [columns.map((column) => String(values[column]))],
      }),
    ).toMatchObject({
      projectsCreated: 1,
      activatedProjects: 2,
      searches: 3,
      messages: 4,
      helpfulFeedback: 9,
      sourcesAdded: 12,
      historySourcesAdded: 13,
      youtubeUrlSourcesAdded: 14,
      readySourcesAdded: 15,
      processingSourcesAdded: 16,
      answersWithCitationDiagnostics: 28,
      citationCandidates: 29,
      resolvedCitations: 30,
      citationMeasuredAnswers: 31,
      processingSucceeded: 32,
      processingFailed: 33,
      generationEvents: 34,
      measuredGenerations: 35,
      costEligibleActivatedProjects: 36,
      generationDurationMs: 37,
      costUsdMicros: 38,
    });
  });

  it("rejects incomplete, negative, fractional, or multi-row metrics", () => {
    const validRow = METRIC_COLUMNS.map(() => 0);
    expect(() =>
      parseProjectAdoptionMetrics({
        columns: METRIC_COLUMNS.slice(1) as unknown as string[],
        results: [validRow.slice(1)],
      }),
    ).toThrow("invalid metrics");
    expect(() =>
      parseProjectAdoptionMetrics({
        columns: [...METRIC_COLUMNS],
        results: [[-1, ...validRow.slice(1)]],
      }),
    ).toThrow("invalid metrics");
    expect(() =>
      parseProjectAdoptionMetrics({
        columns: [...METRIC_COLUMNS],
        results: [[0.5, ...validRow.slice(1)]],
      }),
    ).toThrow("invalid metrics");
    expect(() =>
      parseProjectAdoptionMetrics({
        columns: [...METRIC_COLUMNS],
        results: [validRow, validRow],
      }),
    ).toThrow("invalid metrics");
  });

  it("accepts only governed failure classes and bounded counts", () => {
    expect(
      parseProjectAdoptionFailureRows({
        columns: ["error_class", "events", "projects"],
        results: [
          ["quota", "4", "3"],
          ["processing", 2, 1],
        ],
      }),
    ).toEqual([
      { errorClass: "quota", events: 4, projects: 3 },
      { errorClass: "processing", events: 2, projects: 1 },
    ]);
    expect(() =>
      parseProjectAdoptionFailureRows({
        columns: ["error_class", "events", "projects"],
        results: [["private_exception_text", 1, 1]],
      }),
    ).toThrow("invalid failure class");
  });
});
