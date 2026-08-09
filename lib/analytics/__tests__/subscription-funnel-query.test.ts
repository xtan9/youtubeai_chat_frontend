import { describe, expect, it } from "vitest";
import { BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER } from "../queries";
import { SUBSCRIPTION_DISCOVERY_EVENT_NAMES } from "../subscription-discovery";
import {
  buildSubscriptionFunnelQuery,
  parseSubscriptionFunnelProgressionResult,
  parseSubscriptionFunnelQueryResult,
  SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS,
} from "../subscription-funnel-query";

describe("buildSubscriptionFunnelQuery", () => {
  it("builds equal adjacent seven-day windows with half-open UTC boundaries", () => {
    const result = buildSubscriptionFunnelQuery({
      windowDays: 7,
      releaseAt: new Date("2026-08-10T12:00:00.000Z"),
      now: new Date("2026-08-20T12:00:00.000Z"),
    });

    expect(result.windows).toEqual({
      baseline: {
        start: "2026-08-03T12:00:00.000Z",
        end: "2026-08-10T12:00:00.000Z",
      },
      current: {
        start: "2026-08-10T12:00:00.000Z",
        end: "2026-08-17T12:00:00.000Z",
      },
      status: "complete",
    });
    expect(result.hogql).toContain(
      "timestamp >= toDateTime64('2026-08-03T12:00:00.000Z', 3, 'UTC')",
    );
    expect(result.hogql).toContain(
      "timestamp < toDateTime64('2026-08-17T12:00:00.000Z', 3, 'UTC')",
    );
    expect(result.hogql).not.toContain("timestamp <=");
    expect(result.progressionHogql).toContain(
      "timestamp >= toDateTime64('2026-08-03T12:00:00.000Z', 3, 'UTC')",
    );
    expect(result.progressionHogql).toContain(
      "timestamp < toDateTime64('2026-08-17T12:00:00.000Z', 3, 'UTC')",
    );
    expect(result.progressionHogql).not.toContain("timestamp <=");
  });

  it("compares an in-progress release window with an equal elapsed baseline", () => {
    const result = buildSubscriptionFunnelQuery({
      windowDays: 14,
      releaseAt: new Date("2026-08-10T12:00:00.000Z"),
      now: new Date("2026-08-13T18:00:00.000Z"),
    });

    expect(result.windows).toEqual({
      baseline: {
        start: "2026-08-07T06:00:00.000Z",
        end: "2026-08-10T12:00:00.000Z",
      },
      current: {
        start: "2026-08-10T12:00:00.000Z",
        end: "2026-08-13T18:00:00.000Z",
      },
      status: "in_progress",
    });
  });

  it("builds an exact fourteen-day window and rejects a pre-release clock", () => {
    const result = buildSubscriptionFunnelQuery({
      windowDays: 14,
      releaseAt: new Date("2026-08-10T12:00:00.000Z"),
      now: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(result.windows).toEqual({
      baseline: {
        start: "2026-07-27T12:00:00.000Z",
        end: "2026-08-10T12:00:00.000Z",
      },
      current: {
        start: "2026-08-10T12:00:00.000Z",
        end: "2026-08-24T12:00:00.000Z",
      },
      status: "complete",
    });
    expect(() =>
      buildSubscriptionFunnelQuery({
        windowDays: 7,
        releaseAt: new Date("2026-08-10T12:00:00.000Z"),
        now: new Date("2026-08-10T11:59:59.999Z"),
      }),
    ).toThrow("Subscription funnel reporting has not started");
  });

  it("selects the complete governed funnel in one Smoke-safe segmented scan", () => {
    const { hogql, progressionHogql } = buildSubscriptionFunnelQuery({
      windowDays: 7,
      releaseAt: new Date("2026-08-10T12:00:00.000Z"),
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    for (const eventName of SUBSCRIPTION_DISCOVERY_EVENT_NAMES) {
      expect(hogql).toContain(`'${eventName}'`);
    }
    expect(hogql).toContain(BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER);
    expect(hogql.match(/FROM events/g)).toHaveLength(1);
    expect(hogql).toContain("arrayJoin(arrayZip(");
    expect(hogql).toContain("count() AS event_count");
    expect(hogql).toContain(
      "count(DISTINCT person_id) AS learner_count",
    );
    for (const dimension of [
      "source_surface",
      "presentation_state",
      "authentication_state",
      "device_class",
      "plan",
      "billing_interval",
      "failure_category",
    ]) {
      expect(hogql).toContain(
        `coalesce(nullIf(properties['${dimension}'], ''), 'unattributed')`,
      );
    }
    expect(hogql).not.toMatch(/experiment|feature_flag/i);
    expect(progressionHogql).toContain(
      BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER,
    );
    expect(progressionHogql).not.toMatch(/experiment|feature_flag/i);
  });

  it("counts ordered learner progression for every adjacent stage", () => {
    const { progressionHogql } = buildSubscriptionFunnelQuery({
      windowDays: 7,
      releaseAt: new Date("2026-08-10T12:00:00.000Z"),
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    expect(progressionHogql).toContain("windowFunnel(604800)(");
    expect(progressionHogql).toContain("toDateTime(timestamp)");
    expect(progressionHogql.match(/windowFunnel\(604800\)/g)).toHaveLength(
      SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.length - 1,
    );
    for (
      let index = 1;
      index < SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.length;
      index += 1
    ) {
      const previousEvent =
        SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS[index - 1];
      const event = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS[index];
      expect(progressionHogql).toContain(
        `event = '${previousEvent}',\n      event = '${event}'`,
      );
      expect(progressionHogql).toContain(
        `countIf(progressed_${event} >= 2) AS progressed_${event}`,
      );
    }
    expect(progressionHogql).toContain(
      "GROUP BY period, segment_dimension, segment_value, person_id",
    );
  });
});

describe("parseSubscriptionFunnelQueryResult", () => {
  it("keeps compatible historical source values and marks unavailable dimensions", () => {
    const rows = parseSubscriptionFunnelQueryResult({
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
          "checkout_started",
          "source_surface",
          "pricing",
          3,
          2,
        ],
        [
          "baseline",
          "subscription_activated",
          "source_surface",
          "stripe_webhook",
          1,
          1,
        ],
      ],
    });

    expect(rows).toEqual([
      {
        period: "current",
        event: "checkout_started",
        segmentDimension: "source_surface",
        segmentValue: "pricing",
        eventCount: 3,
        learnerCount: 2,
      },
      {
        period: "baseline",
        event: "subscription_activated",
        segmentDimension: "source_surface",
        segmentValue: "stripe_webhook",
        eventCount: 1,
        learnerCount: 1,
      },
    ]);
  });

  it("rejects unknown segment dimensions instead of misreporting them", () => {
    expect(() =>
      parseSubscriptionFunnelQueryResult({
        columns: [
          "period",
          "event",
          "segment_dimension",
          "segment_value",
          "event_count",
          "learner_count",
        ],
        results: [
          ["current", "pricing_viewed", "campaign", "summer", 1, 1],
        ],
      }),
    ).toThrow("Invalid Subscription funnel segment_dimension at row 0");
  });
});

describe("parseSubscriptionFunnelProgressionResult", () => {
  const columns = [
    "period",
    "segment_dimension",
    "segment_value",
    "progressed_subscription_discovery_clicked",
    "progressed_pricing_viewed",
    "progressed_plan_choice_attempted",
    "progressed_checkout_started",
    "progressed_subscription_activated",
  ];

  it("parses ordered adjacent-stage learner intersections", () => {
    expect(
      parseSubscriptionFunnelProgressionResult({
        columns,
        results: [
          ["current", "overall", "all", 40, 31, 18, 9, 6],
          ["baseline", "source_surface", "global_header", 20, 14, 8, 4, 3],
        ],
      }),
    ).toEqual([
      {
        period: "current",
        segmentDimension: "overall",
        segmentValue: "all",
        progressedLearners: {
          subscription_discovery_clicked: 40,
          pricing_viewed: 31,
          plan_choice_attempted: 18,
          checkout_started: 9,
          subscription_activated: 6,
        },
      },
      {
        period: "baseline",
        segmentDimension: "source_surface",
        segmentValue: "global_header",
        progressedLearners: {
          subscription_discovery_clicked: 20,
          pricing_viewed: 14,
          plan_choice_attempted: 8,
          checkout_started: 4,
          subscription_activated: 3,
        },
      },
    ]);
  });

  it("rejects malformed progression counts", () => {
    expect(() =>
      parseSubscriptionFunnelProgressionResult({
        columns,
        results: [["current", "overall", "all", 1.5, 1, 1, 1, 1]],
      }),
    ).toThrow(
      "Invalid Subscription funnel progressed_subscription_discovery_clicked at row 0",
    );
  });
});
