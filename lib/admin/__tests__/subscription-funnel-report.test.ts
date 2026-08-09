import { describe, expect, it, vi } from "vitest";
import type { SubscriptionDiscoveryEventName } from "@/lib/analytics/subscription-discovery";
import type {
  SubscriptionFunnelProgressionRow,
  SubscriptionFunnelProgressionStageEvent,
  SubscriptionFunnelQueryDimension,
  SubscriptionFunnelQueryRow,
} from "@/lib/analytics/subscription-funnel-query";
import { SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS } from "@/lib/analytics/subscription-funnel-query";

vi.mock("server-only", () => ({}));

import {
  buildSubscriptionFunnelReport,
  loadSubscriptionFunnelReport,
  readSubscriptionFunnelReleaseAt,
} from "../subscription-funnel-report";

function row(
  period: "baseline" | "current",
  event: SubscriptionDiscoveryEventName,
  eventCount: number,
  learnerCount: number,
  segment: {
    dimension: SubscriptionFunnelQueryDimension;
    value: string;
  } = { dimension: "overall", value: "all" },
): SubscriptionFunnelQueryRow {
  return {
    period,
    event,
    eventCount,
    learnerCount,
    segmentDimension: segment.dimension,
    segmentValue: segment.value,
  };
}

const PROGRESSION_EVENTS = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.slice(
  1,
) as readonly SubscriptionFunnelProgressionStageEvent[];

function progression(
  period: "baseline" | "current",
  learnerCounts: readonly number[],
  segment: {
    dimension: SubscriptionFunnelQueryDimension;
    value: string;
  } = { dimension: "overall", value: "all" },
): SubscriptionFunnelProgressionRow {
  return {
    period,
    segmentDimension: segment.dimension,
    segmentValue: segment.value,
    progressedLearners: Object.fromEntries(
      PROGRESSION_EVENTS.map((event, index) => [
        event,
        learnerCounts[index] ?? 0,
      ]),
    ) as Record<SubscriptionFunnelProgressionStageEvent, number>,
  };
}

describe("buildSubscriptionFunnelReport", () => {
  it("reports the successful path drop-offs and checkout failures against baseline", () => {
    const report = buildSubscriptionFunnelReport({
      windowDays: 7,
      releaseAt: "2026-08-10T12:00:00.000Z",
      windows: {
        baseline: {
          start: "2026-08-03T12:00:00.000Z",
          end: "2026-08-10T12:00:00.000Z",
        },
        current: {
          start: "2026-08-10T12:00:00.000Z",
          end: "2026-08-17T12:00:00.000Z",
        },
        status: "complete",
      },
      isCached: false,
      rows: [
        row("current", "subscription_discovery_viewed", 120, 80),
        // Seventy learners clicked, but only forty first viewed and then
        // clicked. Drop-off must use the ordered intersection, not 80 - 70.
        row("current", "subscription_discovery_clicked", 85, 70),
        row("current", "pricing_viewed", 48, 38),
        row("current", "plan_choice_attempted", 25, 18),
        row("current", "checkout_started", 12, 9),
        row("current", "checkout_failed", 6, 4),
        row("current", "subscription_activated", 7, 6),
        row("baseline", "subscription_discovery_viewed", 70, 50),
        row("baseline", "subscription_discovery_clicked", 54, 45),
        row("baseline", "pricing_viewed", 20, 18),
        row("baseline", "plan_choice_attempted", 12, 10),
        row("baseline", "checkout_started", 7, 6),
        row("baseline", "checkout_failed", 3, 2),
        row("baseline", "subscription_activated", 4, 4),
      ],
      progressions: [
        progression("current", [40, 38, 18, 9, 6]),
        progression("baseline", [20, 18, 10, 6, 4]),
      ],
    });

    expect(report.stages.map((stage) => stage.event)).toEqual([
      "subscription_discovery_viewed",
      "subscription_discovery_clicked",
      "pricing_viewed",
      "plan_choice_attempted",
      "checkout_started",
      "subscription_activated",
    ]);
    expect(report.stages[1]).toMatchObject({
      current: { events: 85, learners: 70 },
      baseline: { events: 54, learners: 45 },
      currentDropOff: { learners: 40, ratePct: 50 },
      baselineDropOff: { learners: 30, ratePct: 60 },
    });
    expect(report.checkoutFailures).toEqual({
      current: { events: 6, learners: 4, outcomeRatePct: 33.3 },
      baseline: { events: 3, learners: 2, outcomeRatePct: 30 },
    });
  });

  it("keeps every stage segmentable and separates checkout failure categories", () => {
    const report = buildSubscriptionFunnelReport({
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
      isCached: true,
      rows: [
        row("current", "subscription_discovery_viewed", 10, 8, {
          dimension: "source_surface",
          value: "global_header",
        }),
        row("current", "subscription_discovery_clicked", 4, 3, {
          dimension: "source_surface",
          value: "global_header",
        }),
        row("baseline", "subscription_discovery_viewed", 6, 5, {
          dimension: "source_surface",
          value: "global_header",
        }),
        row("current", "subscription_discovery_viewed", 10, 8, {
          dimension: "authentication_state",
          value: "registered",
        }),
        row("current", "subscription_discovery_viewed", 10, 8, {
          dimension: "device_class",
          value: "desktop",
        }),
        row("current", "checkout_started", 4, 3, {
          dimension: "source_surface",
          value: "direct_pricing",
        }),
        row("current", "checkout_failed", 2, 2, {
          dimension: "source_surface",
          value: "direct_pricing",
        }),
        row("baseline", "checkout_failed", 1, 1, {
          dimension: "source_surface",
          value: "direct_pricing",
        }),
        row("current", "checkout_failed", 2, 2, {
          dimension: "failure_category",
          value: "network_error",
        }),
        row("baseline", "checkout_failed", 1, 1, {
          dimension: "failure_category",
          value: "network_error",
        }),
      ],
      progressions: [
        progression("current", [3], {
          dimension: "source_surface",
          value: "global_header",
        }),
      ],
    });

    const sourceSegment = report.segments.find(
      (segment) =>
        segment.dimension === "source_surface" &&
        segment.value === "global_header",
    );
    expect(sourceSegment?.stages[0]).toMatchObject({
      event: "subscription_discovery_viewed",
      current: { events: 10, learners: 8 },
      baseline: { events: 6, learners: 5 },
    });
    expect(sourceSegment?.stages[1]).toMatchObject({
      event: "subscription_discovery_clicked",
      current: { events: 4, learners: 3 },
      baseline: { events: 0, learners: 0 },
      currentDropOff: { learners: 5, ratePct: 62.5 },
      baselineDropOff: { learners: 5, ratePct: 100 },
    });
    expect(
      report.segments.some(
        (segment) =>
          segment.dimension === "authentication_state" &&
          segment.value === "registered",
      ),
    ).toBe(true);
    expect(
      report.segments.some(
        (segment) =>
          segment.dimension === "device_class" && segment.value === "desktop",
      ),
    ).toBe(true);
    expect(report.failureCategories).toEqual([
      {
        category: "network_error",
        current: { events: 2, learners: 2 },
        baseline: { events: 1, learners: 1 },
      },
    ]);
  });

  it("does not inflate overall Learners with per-dimension rows", () => {
    const report = buildSubscriptionFunnelReport({
      windowDays: 7,
      releaseAt: "2026-08-10T12:00:00.000Z",
      windows: {
        baseline: {
          start: "2026-08-03T12:00:00.000Z",
          end: "2026-08-10T12:00:00.000Z",
        },
        current: {
          start: "2026-08-10T12:00:00.000Z",
          end: "2026-08-17T12:00:00.000Z",
        },
        status: "complete",
      },
      isCached: false,
      rows: [
        row("current", "pricing_viewed", 5, 4),
        row("current", "pricing_viewed", 3, 3, {
          dimension: "device_class",
          value: "desktop",
        }),
        row("current", "pricing_viewed", 2, 2, {
          dimension: "device_class",
          value: "mobile",
        }),
        row("current", "pricing_viewed", 5, 4, {
          dimension: "authentication_state",
          value: "registered",
        }),
      ],
      progressions: [],
    });

    expect(report.stages[2].current).toEqual({ events: 5, learners: 4 });
    expect(
      report.segments
        .filter((segment) => segment.dimension === "device_class")
        .map((segment) => [segment.value, segment.stages[2].current]),
    ).toEqual([
      ["desktop", { events: 3, learners: 3 }],
      ["mobile", { events: 2, learners: 2 }],
    ]);
  });

  it("rejects impossible ordered progression instead of clamping it", () => {
    expect(() =>
      buildSubscriptionFunnelReport({
        windowDays: 7,
        releaseAt: "2026-08-10T12:00:00.000Z",
        windows: {
          baseline: {
            start: "2026-08-03T12:00:00.000Z",
            end: "2026-08-10T12:00:00.000Z",
          },
          current: {
            start: "2026-08-10T12:00:00.000Z",
            end: "2026-08-17T12:00:00.000Z",
          },
          status: "complete",
        },
        isCached: false,
        rows: [
          row("current", "subscription_discovery_viewed", 1, 1),
        ],
        progressions: [progression("current", [2])],
      }),
    ).toThrow(
      "Ordered Subscription funnel progression exceeds its prior-stage audience",
    );
  });
});

describe("loadSubscriptionFunnelReport", () => {
  it("loads the named PostHog query through the server report boundary", async () => {
    const executeQuery = vi
      .fn()
      .mockResolvedValueOnce({
        columns: [
          "period",
          "event",
          "segment_dimension",
          "segment_value",
          "event_count",
          "learner_count",
        ],
        results: [
          [
            "current",
            "pricing_viewed",
            "overall",
            "all",
            5,
            4,
          ],
        ],
        isCached: true,
      })
      .mockResolvedValueOnce({
        columns: [
          "period",
          "segment_dimension",
          "segment_value",
          "progressed_subscription_discovery_clicked",
          "progressed_pricing_viewed",
          "progressed_plan_choice_attempted",
          "progressed_checkout_started",
          "progressed_subscription_activated",
        ],
        results: [["current", "overall", "all", 0, 0, 0, 0, 0]],
        isCached: true,
      });

    const report = await loadSubscriptionFunnelReport(
      {
        windowDays: 7,
        releaseAt: new Date("2026-08-10T12:00:00.000Z"),
        now: new Date("2026-08-17T12:00:00.000Z"),
      },
      { executeQuery },
    );

    expect(executeQuery).toHaveBeenNthCalledWith(1, {
      hogql: expect.stringContaining("'pricing_viewed'"),
      name: "subscription_conversion_funnel_stage_counts_7_day",
    });
    expect(executeQuery).toHaveBeenNthCalledWith(2, {
      hogql: expect.stringContaining("windowFunnel(604800000000)"),
      name: "subscription_conversion_funnel_ordered_progression_7_day",
    });
    expect(executeQuery).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({
      windowDays: 7,
      releaseAt: "2026-08-10T12:00:00.000Z",
      isCached: true,
      windows: {
        baseline: {
          start: "2026-08-03T12:00:00.000Z",
          end: "2026-08-10T12:00:00.000Z",
        },
        current: {
          start: "2026-08-10T12:00:00.000Z",
          end: "2026-08-17T12:00:00.000Z",
        },
        status: "complete",
      },
    });
    expect(report.stages[2].current).toEqual({ events: 5, learners: 4 });
  });

  it("requires one exact UTC release boundary from server configuration", () => {
    expect(
      readSubscriptionFunnelReleaseAt("2026-08-10T12:00:00.000Z"),
    ).toEqual(new Date("2026-08-10T12:00:00.000Z"));
    expect(() => readSubscriptionFunnelReleaseAt(undefined)).toThrow(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT is not configured",
    );
    expect(() => readSubscriptionFunnelReleaseAt("not-a-date")).toThrow(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT must be an ISO 8601 UTC timestamp",
    );
    expect(() =>
      readSubscriptionFunnelReleaseAt("2026-02-30T12:00:00.000Z"),
    ).toThrow(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT must be an ISO 8601 UTC timestamp",
    );
    expect(() =>
      readSubscriptionFunnelReleaseAt("2026-08-10T12:00:00-07:00"),
    ).toThrow(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT must be an ISO 8601 UTC timestamp",
    );
  });
});
