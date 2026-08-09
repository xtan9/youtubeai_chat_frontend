import "server-only";

import type {
  SubscriptionFunnelProgressionRow,
  SubscriptionFunnelProgressionStageEvent,
  SubscriptionFunnelQueryRow,
  SubscriptionFunnelSuccessStageEvent,
  SubscriptionFunnelWindowDays,
  SubscriptionFunnelQuery,
} from "@/lib/analytics/subscription-funnel-query";
import {
  buildSubscriptionFunnelQuery,
  parseSubscriptionFunnelProgressionResult,
  parseSubscriptionFunnelQueryResult,
  SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS,
} from "@/lib/analytics/subscription-funnel-query";
import {
  executePostHogHogQlQuery,
  type PostHogHogQlRequest,
  type PostHogHogQlResult,
} from "@/lib/analytics/posthog-query";
import type { SubscriptionDiscoveryEventName } from "@/lib/analytics/subscription-discovery";

const SEGMENT_DIMENSIONS = [
  "source_surface",
  "presentation_state",
  "authentication_state",
  "device_class",
  "plan",
  "billing_interval",
] as const satisfies readonly SubscriptionFunnelSegmentDimension[];

type FunnelPeriod = SubscriptionFunnelQueryRow["period"];
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
  event: SubscriptionFunnelSuccessStageEvent;
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
  progressions: SubscriptionFunnelProgressionRow[];
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
  const executeQuery = dependencies.executeQuery ?? executePostHogHogQlQuery;
  const [stageResult, progressionResult] = await Promise.all([
    executeQuery({
      hogql: query.hogql,
      name: `subscription_conversion_funnel_stage_counts_${input.windowDays}_day`,
    }),
    executeQuery({
      hogql: query.progressionHogql,
      name: `subscription_conversion_funnel_ordered_progression_${input.windowDays}_day`,
    }),
  ]);

  return buildSubscriptionFunnelReport({
    windowDays: input.windowDays,
    releaseAt: input.releaseAt.toISOString(),
    windows: query.windows,
    isCached: stageResult.isCached && progressionResult.isCached,
    rows: parseSubscriptionFunnelQueryResult(stageResult),
    progressions: parseSubscriptionFunnelProgressionResult(progressionResult),
  });
}

export function buildSubscriptionFunnelReport(
  input: BuildSubscriptionFunnelReportInput,
): SubscriptionFunnelReport {
  const totals = aggregateRows(
    input.rows.filter((row) => row.segmentDimension === "overall"),
  );
  const progressions = aggregateProgressions(
    input.progressions.filter(
      (progression) => progression.segmentDimension === "overall",
    ),
  );

  return {
    windowDays: input.windowDays,
    releaseAt: input.releaseAt,
    windows: input.windows,
    isCached: input.isCached,
    stages: buildStages(totals, progressions),
    checkoutFailures: {
      current: failureCount(totals, "current"),
      baseline: failureCount(totals, "baseline"),
    },
    segments: buildSegments(input.rows, input.progressions),
    failureCategories: buildFailureCategories(input.rows),
  };
}

function buildSegments(
  rows: SubscriptionFunnelQueryRow[],
  progressions: SubscriptionFunnelProgressionRow[],
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
      const progressionTotals = aggregateProgressions(
        progressions.filter(
          (progression) =>
            progression.segmentDimension === dimension &&
            progression.segmentValue === value,
        ),
      );
      return {
        dimension,
        value,
        stages: buildStages(totals, progressionTotals),
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

function aggregateProgressions(
  rows: SubscriptionFunnelProgressionRow[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [event, learnerCount] of Object.entries(
      row.progressedLearners,
    ) as [SubscriptionFunnelProgressionStageEvent, number][]) {
      const key = countKey(row.period, event);
      totals.set(key, (totals.get(key) ?? 0) + learnerCount);
    }
  }
  return totals;
}

function buildStages(
  totals: Map<string, FunnelCount>,
  progressions: Map<string, number>,
): SubscriptionFunnelStage[] {
  return SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.map((event, index) => {
    const previousEvent = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS[index - 1];
    const current = getCount(totals, "current", event);
    const baseline = getCount(totals, "baseline", event);
    return {
      event,
      current,
      baseline,
      currentDropOff: previousEvent
        ? dropOff(
            getCount(totals, "current", previousEvent),
            getProgressionCount(progressions, "current", event),
          )
        : null,
      baselineDropOff: previousEvent
        ? dropOff(
            getCount(totals, "baseline", previousEvent),
            getProgressionCount(progressions, "baseline", event),
          )
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

function dropOff(
  previous: FunnelCount,
  progressedLearners: number,
): FunnelDropOff {
  if (progressedLearners > previous.learners) {
    throw new Error(
      "Ordered Subscription funnel progression exceeds its prior-stage audience",
    );
  }
  const learners = previous.learners - progressedLearners;
  return {
    learners,
    ratePct: percentage(learners, previous.learners),
  };
}

function getProgressionCount(
  totals: Map<string, number>,
  period: FunnelPeriod,
  event: SubscriptionFunnelSuccessStageEvent,
): number {
  return totals.get(countKey(period, event)) ?? 0;
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
