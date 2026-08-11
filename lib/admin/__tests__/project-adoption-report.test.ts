import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { loadProjectAdoptionReport } from "../project-adoption-report";

const columns = [
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
];

describe("loadProjectAdoptionReport", () => {
  it("loads named protected-query inputs and derives trust, processing, and cost ratios", async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({
        columns,
        results: [[
          10, 6, 20, 12, 4, 8, 5, 7, 8, 2, 3, 20, 8, 12, 7, 13, 30, 100, 10, 9,
          25, 20, 15, 5, 80, 25, 4, 3, 10, 9, 10, 18, 2, 6, 5, 4, 2400, 120000,
        ]],
        isCached: false,
      })
      .mockResolvedValueOnce({
        columns: ["eligible_activated_projects", "returned_projects"],
        results: [[4, 3]],
        isCached: true,
      })
      .mockResolvedValueOnce({
        columns: ["error_class", "events", "projects"],
        results: [["quota", 3, 2]],
        isCached: true,
      });

    const report = await loadProjectAdoptionReport(
      { windowDays: 30, now: new Date("2026-08-10T12:00:00.000Z") },
      { executeQuery },
    );

    expect(executeQuery.mock.calls.map((call) => call[0].name)).toEqual([
      "project_adoption_metrics_30_day",
      "project_adoption_seven_day_return_30_day",
      "project_adoption_failures_30_day",
    ]);
    expect(report.metrics.returnedProjects).toBe(3);
    expect(report.ratios).toEqual({
      sevenDayReturnPct: 75,
      sourceReadyAtAddPct: 35,
      helpfulFeedbackPct: 80,
      retrievalYieldPct: 30,
      sourceCoverageIntegrityPct: 90,
      processingFailurePct: 10,
      answersWithCitationDiagnosticsPct: 30,
      citationResolutionPct: 90,
      citationMeasurementCoveragePct: 100,
      measuredCostCoveragePct: 83.3,
      averageGenerationDurationMs: 400,
      costPerActiveProjectUsdMicros: 30000,
    });
    expect(report.failures).toEqual([
      { errorClass: "quota", events: 3, projects: 2 },
    ]);
    expect(report.isCached).toBe(false);
  });

  it("uses zero, not NaN or Infinity, for empty denominators", async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({
        columns,
        results: [columns.map(() => 0)],
        isCached: true,
      })
      .mockResolvedValueOnce({
        columns: ["eligible_activated_projects", "returned_projects"],
        results: [[0, 0]],
        isCached: true,
      })
      .mockResolvedValueOnce({
        columns: ["error_class", "events", "projects"],
        results: [],
        isCached: true,
      });

    const report = await loadProjectAdoptionReport(
      { windowDays: 7, now: new Date("2026-08-10T12:00:00.000Z") },
      { executeQuery },
    );

    expect(Object.values(report.ratios).every((value) => value === 0)).toBe(true);
    expect(report.isCached).toBe(true);
  });
});
