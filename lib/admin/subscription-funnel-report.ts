import "server-only";

import type {
  SubscriptionFunnelQueryRow,
  SubscriptionFunnelWindowDays,
  SubscriptionFunnelQuery,
} from "@/lib/analytics/subscription-funnel-query";
import {
  buildSubscriptionFunnelQuery,
  parseSubscriptionFunnelQueryResult,
} from "@/lib/analytics/subscription-funnel-query";
import {
  executePostHogHogQlQuery,
  type PostHogHogQlRequest,
  type PostHogHogQlResult,
} from "@/lib/analytics/posthog-query";
import type { SubscriptionDiscoveryEventName } from "@/lib/analytics/subscription-discovery";

const SUCCESS_STAGE_EVENTS = [
  "subscription_discovery_viewed",
  "subscription_discovery_clicked",
  "pricing_viewed",
  "plan_choice_attempted",
  "checkout_started",
  "subscription_activated",
] as const satisfies readonly SubscriptionDiscoveryEventName[];

const SEGMENT_DIMENSIONS = [
  "source_surface",
  "presentation_state",
  "authentication_state",
  "device_class",
  "plan",
  "billing_interval",
] as const satisfies readonly SubscriptionFunnelSegmentDimension[];

type FunnelPeriod = SubscriptionFunnelQueryRow["period"];
type SuccessStageEvent = (typeof SUCCESS_STAGE_EVENTS)[number];
export type SubscriptionFunnelSegmentDimension =
  | "source_surface"
  | "presentation_state"
  | "authentication_state"
  | "device_class"
  | "plan"
  | "billing_interval";

interface FunnelCount {
  events: number;
  learners: number;
}

interface FunnelDropOff {
  learners: number;
  ratePct: number;
}

export interface SubscriptionFunnelStage {
  event: SuccessStageEvent;
  current: FunnelCount;
  baseline: FunnelCount;
  currentDropOff: FunnelDropOff | null;
  baselineDropOff: FunnelDropOff | null;
}

export interface SubscriptionFunnelFailureCount extends FunnelCount {
  outcomeRatePct: number;
}

export interface SubscriptionFunnelSegment {
  dimension: SubscriptionFunnelSegmentDimension;
  value: string;
  stages: SubscriptionFunnelStage[];
  checkoutFailures: {
    current: SubscriptionFunnelFailureCount;
    baseline: SubscriptionFunnelFailureCount;
  };
}

export interface SubscriptionFunnelFailureCategory {
  category: string;
  current: FunnelCount;
  baseline: FunnelCount;
}

export interface SubscriptionFunnelReport {
  windowDays: SubscriptionFunnelWindowDays;
  releaseAt: string;
  windows: SubscriptionFunnelQuery["windows"];
  isCached: boolean;
  stages: SubscriptionFunnelStage[];
  checkoutFailures: {
    current: SubscriptionFunnelFailureCount;
    baseline: SubscriptionFunnelFailureCount;
  };
  segments: SubscriptionFunnelSegment[];
  failureCategories: SubscriptionFunnelFailureCategory[];
}

interface BuildSubscriptionFunnelReportInput {
  windowDays: SubscriptionFunnelWindowDays;
  releaseAt: string;
  windows: SubscriptionFunnelQuery["windows"];
  isCached: boolean;
  rows: SubscriptionFunnelQueryRow[];
}

interface LoadSubscriptionFunnelReportInput {
  windowDays: SubscriptionFunnelWindowDays;
  releaseAt: Date;
  now: Date;
}

interface SubscriptionFunnelReportDependencies {
  executeQuery?: (
    request: PostHogHogQlRequest,
  ) => Promise<PostHogHogQlResult>;
}

export class SubscriptionFunnelReportConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionFunnelReportConfigurationError";
  }
}

export function readSubscriptionFunnelReleaseAt(
  raw: string | undefined = process.env.SUBSCRIPTION_FUNNEL_RELEASE_AT,
): Date {
  const value = raw?.trim();
  if (!value) {
    throw new SubscriptionFunnelReportConfigurationError(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT is not configured",
    );
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    throw new SubscriptionFunnelReportConfigurationError(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT must be an ISO 8601 UTC timestamp",
    );
  }
  const releaseAt = new Date(value);
  const canonicalValue = value.includes(".")
    ? value
    : value.replace(/Z$/, ".000Z");
  if (
    Number.isNaN(releaseAt.getTime()) ||
    releaseAt.toISOString() !== canonicalValue
  ) {
    throw new SubscriptionFunnelReportConfigurationError(
      "SUBSCRIPTION_FUNNEL_RELEASE_AT must be an ISO 8601 UTC timestamp",
    );
  }
  return releaseAt;
}

export async function loadSubscriptionFunnelReport(
  input: LoadSubscriptionFunnelReportInput,
  dependencies: SubscriptionFunnelReportDependencies = {},
): Promise<SubscriptionFunnelReport> {
  const query = buildSubscriptionFunnelQuery(input);
  const result = await (
    dependencies.executeQuery ?? executePostHogHogQlQuery
  )({
    hogql: query.hogql,
    name: `subscription_conversion_funnel_${input.windowDays}_day`,
  });

  return buildSubscriptionFunnelReport({
    windowDays: input.windowDays,
    releaseAt: input.releaseAt.toISOString(),
    windows: query.windows,
    isCached: result.isCached,
    rows: parseSubscriptionFunnelQueryResult(result),
  });
}

export function buildSubscriptionFunnelReport(
  input: BuildSubscriptionFunnelReportInput,
): SubscriptionFunnelReport {
  const totals = aggregateRows(
    input.rows.filter((row) => row.segmentDimension === "overall"),
  );

  return {
    windowDays: input.windowDays,
    releaseAt: input.releaseAt,
    windows: input.windows,
    isCached: input.isCached,
    stages: buildStages(totals),
    checkoutFailures: {
      current: failureCount(totals, "current"),
      baseline: failureCount(totals, "baseline"),
    },
    segments: buildSegments(input.rows),
    failureCategories: buildFailureCategories(input.rows),
  };
}

function buildSegments(
  rows: SubscriptionFunnelQueryRow[],
): SubscriptionFunnelSegment[] {
  return SEGMENT_DIMENSIONS.flatMap((dimension) => {
    const dimensionRows = rows.filter(
      (row) => row.segmentDimension === dimension,
    );
    const values = Array.from(
      new Set(dimensionRows.map((row) => row.segmentValue)),
    ).sort();
    return values.map((value) => {
      const totals = aggregateRows(
        dimensionRows.filter((row) => row.segmentValue === value),
      );
      return {
        dimension,
        value,
        stages: buildStages(totals),
        checkoutFailures: {
          current: failureCount(totals, "current"),
          baseline: failureCount(totals, "baseline"),
        },
      };
    });
  });
}

function buildFailureCategories(
  rows: SubscriptionFunnelQueryRow[],
): SubscriptionFunnelFailureCategory[] {
  const failures = rows.filter(
    (row) =>
      row.event === "checkout_failed" &&
      row.segmentDimension === "failure_category",
  );
  const categories = Array.from(
    new Set(failures.map((row) => row.segmentValue)),
  ).sort();
  return categories.map((category) => {
    const totals = aggregateRows(
      failures.filter((row) => row.segmentValue === category),
    );
    return {
      category,
      current: getCount(totals, "current", "checkout_failed"),
      baseline: getCount(totals, "baseline", "checkout_failed"),
    };
  });
}

function aggregateRows(
  rows: SubscriptionFunnelQueryRow[],
): Map<string, FunnelCount> {
  const totals = new Map<string, FunnelCount>();
  for (const row of rows) {
    const key = countKey(row.period, row.event);
    const total = totals.get(key) ?? emptyCount();
    total.events += row.eventCount;
    total.learners += row.learnerCount;
    totals.set(key, total);
  }
  return totals;
}

function buildStages(
  totals: Map<string, FunnelCount>,
): SubscriptionFunnelStage[] {
  return SUCCESS_STAGE_EVENTS.map((event, index) => {
    const previousEvent = SUCCESS_STAGE_EVENTS[index - 1];
    const current = getCount(totals, "current", event);
    const baseline = getCount(totals, "baseline", event);
    return {
      event,
      current,
      baseline,
      currentDropOff: previousEvent
        ? dropOff(getCount(totals, "current", previousEvent), current)
        : null,
      baselineDropOff: previousEvent
        ? dropOff(getCount(totals, "baseline", previousEvent), baseline)
        : null,
    };
  });
}

function failureCount(
  totals: Map<string, FunnelCount>,
  period: FunnelPeriod,
): SubscriptionFunnelFailureCount {
  const failures = getCount(totals, period, "checkout_failed");
  const starts = getCount(totals, period, "checkout_started");
  const outcomes = failures.events + starts.events;
  return {
    ...failures,
    outcomeRatePct: percentage(failures.events, outcomes),
  };
}

function dropOff(previous: FunnelCount, current: FunnelCount): FunnelDropOff {
  const learners = Math.max(0, previous.learners - current.learners);
  return {
    learners,
    ratePct: percentage(learners, previous.learners),
  };
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1_000) / 10;
}

function getCount(
  totals: Map<string, FunnelCount>,
  period: FunnelPeriod,
  event: SubscriptionDiscoveryEventName,
): FunnelCount {
  return totals.get(countKey(period, event)) ?? emptyCount();
}

function countKey(
  period: FunnelPeriod,
  event: SubscriptionDiscoveryEventName,
): string {
  return `${period}:${event}`;
}

function emptyCount(): FunnelCount {
  return { events: 0, learners: 0 };
}
