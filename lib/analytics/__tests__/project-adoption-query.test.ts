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
  "processing_succeeded",
  "processing_failed",
  "generation_events",
  "measured_generations",
  "active_cost_projects",
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
    expect(query.metricsHogql).toContain("analytics_subject");
    expect(query.returnHogql).toContain("argMax(");
    expect(query.returnHogql).toContain("properties['activation_revision']");
    expect(query.returnHogql).toContain("opened.project_id = activated.project_id");
    expect(query.returnHogql).toContain("activated.activated_at + INTERVAL 7 DAY");
    expect(query.returnHogql).toContain("eligible_activated_projects");
    expect(query.returnHogql).toContain("2026-07-27T12:00:00.000Z");
    expect(query.returnHogql).toContain("2026-08-03T12:00:00.000Z");
    expect(query.returnHogql).toContain("event = 'project_opened'");
    expect(query.returnHogql).toContain("analytics_subject");
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
      answersWithCitationDiagnostics: 23,
      processingSucceeded: 24,
      processingFailed: 25,
      generationEvents: 26,
      measuredGenerations: 27,
      activeCostProjects: 28,
      generationDurationMs: 29,
      costUsdMicros: 30,
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
