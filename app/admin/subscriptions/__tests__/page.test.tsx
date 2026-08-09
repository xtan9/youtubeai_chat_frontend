/** @vitest-environment happy-dom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubscriptionFunnelReport } from "@/lib/admin/subscription-funnel-report";
import { SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS } from "@/lib/analytics/subscription-funnel-query";

const mocks = vi.hoisted(() => ({
  requireAdminPage: vi.fn(),
  readReleaseAt: vi.fn(),
  loadReport: vi.fn(),
}));

vi.mock("@/app/admin/_components/admin-gate", () => ({
  requireAdminPage: mocks.requireAdminPage,
}));

vi.mock("@/lib/admin/subscription-funnel-report", () => ({
  readSubscriptionFunnelReleaseAt: mocks.readReleaseAt,
  loadSubscriptionFunnelReport: mocks.loadReport,
}));

import AdminSubscriptionsPage from "../page";

const stages = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.map((event, index) => ({
  event,
  current: { events: 100 - index * 10, learners: 80 - index * 8 },
  baseline: { events: 50 - index * 5, learners: 40 - index * 4 },
  currentDropOff:
    index === 0 ? null : { learners: 8, ratePct: 10 },
  baselineDropOff:
    index === 0 ? null : { learners: 4, ratePct: 10 },
}));

const report: SubscriptionFunnelReport = {
  windowDays: 14,
  releaseAt: "2026-08-10T12:00:00.000Z",
  windows: {
    baseline: {
      start: "2026-07-27T12:00:00.000Z",
      end: "2026-08-10T12:00:00.000Z",
    },
    current: {
      start: "2026-08-10T12:00:00.000Z",
      end: "2026-08-24T12:00:00.000Z",
    },
    status: "complete",
  },
  isCached: false,
  stages,
  checkoutFailures: {
    current: { events: 6, learners: 4, outcomeRatePct: 33.3 },
    baseline: { events: 3, learners: 2, outcomeRatePct: 30 },
  },
  segments: [
    {
      dimension: "source_surface",
      value: "global_header",
      stages,
      checkoutFailures: {
        current: { events: 0, learners: 0, outcomeRatePct: 0 },
        baseline: { events: 0, learners: 0, outcomeRatePct: 0 },
      },
    },
  ],
  failureCategories: [
    {
      category: "network_error",
      current: { events: 4, learners: 3 },
      baseline: { events: 1, learners: 1 },
    },
  ],
};

describe("AdminSubscriptionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminPage.mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
      allowlist: new Set(["admin@example.com"]),
    });
    mocks.readReleaseAt.mockReturnValue(
      new Date("2026-08-10T12:00:00.000Z"),
    );
    mocks.loadReport.mockResolvedValue(report);
  });

  it("protects and renders the complete 14-day conversion diagnosis", async () => {
    const ui = await AdminSubscriptionsPage({
      searchParams: Promise.resolve({ window: "14" }),
    });
    render(ui);

    expect(mocks.requireAdminPage).toHaveBeenCalledOnce();
    expect(mocks.loadReport).toHaveBeenCalledWith({
      windowDays: 14,
      releaseAt: new Date("2026-08-10T12:00:00.000Z"),
      now: expect.any(Date),
    });
    expect(
      screen.getByRole("heading", { name: "Subscription conversion" }),
    ).toBeTruthy();
    expect(screen.getByText("Plan control viewed")).toBeTruthy();
    expect(screen.getByText("Subscription activated")).toBeTruthy();
    expect(screen.getByText("Checkout failures")).toBeTruthy();
    expect(screen.getByText("Network error")).toBeTruthy();
    expect(screen.getByText("Global header")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Failed" })).toBeTruthy();
    expect(
      screen.getAllByLabelText(
        "8 learners lost in the current window, 10.0%; 4 learners lost in the baseline window, 10.0%",
      ),
    ).toHaveLength(5);
    expect(screen.getAllByText("−4 base")).toHaveLength(5);
    expect(
      screen.getByText(/Smoke Account activity is excluded/i),
    ).toBeTruthy();
  });
});
