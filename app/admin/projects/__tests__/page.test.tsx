/** @vitest-environment happy-dom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAdoptionReport } from "@/lib/admin/project-adoption-report";

const mocks = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  loadReport: vi.fn(),
}));

vi.mock("@/app/admin/_components/admin-gate", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));
vi.mock("@/lib/admin/project-adoption-report", () => ({
  loadProjectAdoptionReport: mocks.loadReport,
}));

import AdminProjectsPage from "../page";

const report: ProjectAdoptionReport = {
  windowDays: 7,
  window: {
    start: "2026-08-03T12:00:00.000Z",
    end: "2026-08-10T12:00:00.000Z",
  },
  metrics: {
    projectsCreated: 10,
    activatedProjects: 6,
    eligibleActivatedProjects: 4,
    returnedProjects: 3,
    searches: 20,
    messages: 12,
    firstMessages: 4,
    subsequentMessages: 8,
    artifacts: 5,
    citationClicks: 7,
    helpfulFeedback: 8,
    notHelpfulFeedback: 2,
    paywallViews: 3,
    searchResults: 30,
    searchPassagesExamined: 100,
    groundedAnswers: 10,
    coverageIntegrityAnswers: 9,
    groundedTotalVideos: 25,
    groundedReadyVideos: 20,
    groundedUsedVideos: 15,
    groundedUnavailableVideos: 5,
    groundedPassagesExamined: 80,
    groundedPassagesUsed: 25,
    citationDiagnostics: 4,
    answersWithCitationDiagnostics: 3,
    processingSucceeded: 18,
    processingFailed: 2,
    generationEvents: 6,
    measuredGenerations: 5,
    activeCostProjects: 4,
    generationDurationMs: 2400,
    costUsdMicros: 120000,
  },
  ratios: {
    sevenDayReturnPct: 75,
    helpfulFeedbackPct: 80,
    retrievalYieldPct: 30,
    sourceCoverageIntegrityPct: 90,
    processingFailurePct: 10,
    answersWithCitationDiagnosticsPct: 30,
    measuredCostCoveragePct: 83.3,
    averageGenerationDurationMs: 400,
    costPerActiveProjectUsdMicros: 30000,
  },
  failures: [{ errorClass: "quota", events: 3, projects: 2 }],
  isCached: false,
};

describe("AdminProjectsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAdminPage.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
      allowlist: new Set(["admin@example.com"]),
    });
    mocks.loadReport.mockResolvedValue(report);
  });

  it("protects and renders the content-free 7-day Project report", async () => {
    render(
      await AdminProjectsPage({
        searchParams: Promise.resolve({ window: "7" }),
      }),
    );

    expect(mocks.requireAdminPage).toHaveBeenCalledOnce();
    expect(mocks.loadReport).toHaveBeenCalledWith({
      windowDays: 7,
      now: expect.any(Date),
    });
    expect(screen.getByRole("heading", { name: "Project adoption" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "7d" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "30d" }).getAttribute("href")).toBe("?window=30");
    expect(screen.getByText("Seven-day return")).toBeTruthy();
    expect(screen.getByText("75.0%")).toBeTruthy();
    expect(screen.getByText("Source Coverage integrity")).toBeTruthy();
    expect(screen.getByText("Processing failure rate")).toBeTruthy();
    expect(screen.getByText("Measured cost coverage")).toBeTruthy();
    expect(screen.getByText("$0.0300")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Project failure classes" })).toBeTruthy();
    expect(screen.getByText("Quota")).toBeTruthy();
    expect(screen.getByText(/Smoke Accounts are excluded/i)).toBeTruthy();
    expect(screen.getByText(/names, Goals, URLs, queries, prompts, answers/i)).toBeTruthy();
  });

  it("defaults an unsupported window to 30 days", async () => {
    mocks.loadReport.mockResolvedValue({ ...report, windowDays: 30 });

    await AdminProjectsPage({
      searchParams: Promise.resolve({ window: "90" }),
    });

    expect(mocks.loadReport).toHaveBeenCalledWith({
      windowDays: 30,
      now: expect.any(Date),
    });
  });
});
