import { BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER } from "./queries";
import {
  isSubscriptionDiscoveryEventName,
  SUBSCRIPTION_DISCOVERY_EVENT_NAMES,
  type SubscriptionDiscoveryEventName,
} from "./subscription-discovery";

const DAY_MS = 86_400_000;

export const SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS = [
  "subscription_discovery_viewed",
  "subscription_discovery_clicked",
  "pricing_viewed",
  "plan_choice_attempted",
  "checkout_started",
  "subscription_activated",
] as const satisfies readonly SubscriptionDiscoveryEventName[];

export type SubscriptionFunnelSuccessStageEvent =
  (typeof SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS)[number];
export type SubscriptionFunnelProgressionStageEvent = Exclude<
  SubscriptionFunnelSuccessStageEvent,
  "subscription_discovery_viewed"
>;

export const SUBSCRIPTION_FUNNEL_SEGMENT_DIMENSIONS = [
  "source_surface",
  "presentation_state",
  "authentication_state",
  "device_class",
  "plan",
  "billing_interval",
  "failure_category",
] as const;

export type SubscriptionFunnelQueryDimension =
  | "overall"
  | (typeof SUBSCRIPTION_FUNNEL_SEGMENT_DIMENSIONS)[number];

export type SubscriptionFunnelWindowDays = 7 | 14;

interface SubscriptionFunnelQueryInput {
  windowDays: SubscriptionFunnelWindowDays;
  releaseAt: Date;
  now: Date;
}

interface SerializedWindow {
  start: string;
  end: string;
}

export interface SubscriptionFunnelQuery {
  hogql: string;
  progressionHogql: string;
  windows: {
    baseline: SerializedWindow;
    current: SerializedWindow;
    status: "in_progress" | "complete";
  };
}

export interface SubscriptionFunnelQueryResult {
  columns: string[];
  results: unknown[][];
}

export interface SubscriptionFunnelQueryRow {
  period: "baseline" | "current";
  event: SubscriptionDiscoveryEventName;
  segmentDimension: SubscriptionFunnelQueryDimension;
  segmentValue: string;
  eventCount: number;
  learnerCount: number;
}

export interface SubscriptionFunnelProgressionRow {
  period: "baseline" | "current";
  segmentDimension: SubscriptionFunnelQueryDimension;
  segmentValue: string;
  progressedLearners: Record<SubscriptionFunnelProgressionStageEvent, number>;
}

export function buildSubscriptionFunnelQuery(
  input: SubscriptionFunnelQueryInput,
): SubscriptionFunnelQuery {
  if (
    Number.isNaN(input.releaseAt.getTime()) ||
    Number.isNaN(input.now.getTime())
  ) {
    throw new Error("Subscription funnel reporting requires valid dates");
  }
  if (input.now < input.releaseAt) {
    throw new Error("Subscription funnel reporting has not started");
  }
  const durationMs = input.windowDays * DAY_MS;
  const plannedEnd = new Date(input.releaseAt.getTime() + durationMs);
  const currentEnd = input.now < plannedEnd ? input.now : plannedEnd;
  const observedDurationMs = currentEnd.getTime() - input.releaseAt.getTime();
  const baselineStart = new Date(
    input.releaseAt.getTime() - observedDurationMs,
  );

  const baseline = {
    start: baselineStart.toISOString(),
    end: input.releaseAt.toISOString(),
  };
  const current = {
    start: input.releaseAt.toISOString(),
    end: currentEnd.toISOString(),
  };
  const progressionWindowSeconds = Math.max(
    1,
    Math.ceil(observedDurationMs / 1_000),
  );

  return {
    windows: {
      baseline,
      current,
      status: input.now < plannedEnd ? "in_progress" : "complete",
    },
    hogql: [
      "SELECT",
      `  if(timestamp >= ${hogqlDateTime(current.start)}, 'current', 'baseline') AS period,`,
      "  event,",
      ...segmentSelection("  "),
      "  count() AS event_count,",
      "  count(DISTINCT person_id) AS learner_count",
      "FROM events",
      `WHERE timestamp >= ${hogqlDateTime(baseline.start)}`,
      `  AND timestamp < ${hogqlDateTime(current.end)}`,
      `  AND event IN (${SUBSCRIPTION_DISCOVERY_EVENT_NAMES.map(quoteHogqlString).join(", ")})`,
      `  AND ${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
      "GROUP BY period, event, segment_dimension, segment_value",
      "ORDER BY period, event, segment_dimension, segment_value",
    ].join("\n"),
    progressionHogql: buildProgressionHogql({
      baseline,
      current,
      progressionWindowSeconds,
    }),
  };
}

function buildProgressionHogql(input: {
  baseline: SerializedWindow;
  current: SerializedWindow;
  progressionWindowSeconds: number;
}): string {
  const progressionStages = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.slice(
    1,
  ) as readonly SubscriptionFunnelProgressionStageEvent[];

  return [
    "WITH per_person AS (",
    "  SELECT",
    `    if(timestamp >= ${hogqlDateTime(input.current.start)}, 'current', 'baseline') AS period,`,
    ...segmentSelection("    "),
    "    person_id,",
    ...progressionStages.map((event, index) => {
      const previousEvent = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS[index];
      return [
        `    windowFunnel(${input.progressionWindowSeconds})(`,
        "      toDateTime(timestamp),",
        `      event = ${quoteHogqlString(previousEvent)},`,
        `      event = ${quoteHogqlString(event)}`,
        `    ) AS progressed_${event}${index === progressionStages.length - 1 ? "" : ","}`,
      ].join("\n");
    }),
    "  FROM events",
    `  WHERE timestamp >= ${hogqlDateTime(input.baseline.start)}`,
    `    AND timestamp < ${hogqlDateTime(input.current.end)}`,
    `    AND event IN (${SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.map(quoteHogqlString).join(", ")})`,
    `    AND ${BUSINESS_ANALYTICS_SMOKE_EXCLUSION_FILTER}`,
    "  GROUP BY period, segment_dimension, segment_value, person_id",
    ")",
    "SELECT",
    "  period,",
    "  segment_dimension,",
    "  segment_value,",
    ...progressionStages.map(
      (event, index) =>
        `  countIf(progressed_${event} >= 2) AS progressed_${event}${index === progressionStages.length - 1 ? "" : ","}`,
    ),
    "FROM per_person",
    "GROUP BY period, segment_dimension, segment_value",
    "ORDER BY period, segment_dimension, segment_value",
  ].join("\n");
}

function segmentSelection(indent: string): string[] {
  return [
    `${indent}(arrayJoin(arrayZip(`,
    `${indent}  ['overall', ${SUBSCRIPTION_FUNNEL_SEGMENT_DIMENSIONS.map(quoteHogqlString).join(", ")}],`,
    `${indent}  ['all', ${SUBSCRIPTION_FUNNEL_SEGMENT_DIMENSIONS.map(attributionValue).join(", ")}]`,
    `${indent})) AS segment).1 AS segment_dimension,`,
    `${indent}segment.2 AS segment_value,`,
  ];
}

function hogqlDateTime(iso: string): string {
  return `toDateTime64('${iso}', 3, 'UTC')`;
}

function attributionValue(
  dimension: (typeof SUBSCRIPTION_FUNNEL_SEGMENT_DIMENSIONS)[number],
): string {
  return `coalesce(nullIf(properties['${dimension}'], ''), 'unattributed')`;
}

function quoteHogqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function parseSubscriptionFunnelQueryResult(
  result: SubscriptionFunnelQueryResult,
): SubscriptionFunnelQueryRow[] {
  const columnIndex = new Map(
    result.columns.map((column, index) => [column, index]),
  );

  return result.results.map((row, rowIndex) => {
    const period = readPeriod(row, columnIndex, rowIndex);
    const event = readString(row, columnIndex, "event", rowIndex);
    if (!isSubscriptionDiscoveryEventName(event)) {
      throw new Error(`Invalid Subscription funnel event at row ${rowIndex}`);
    }

    return {
      period,
      event,
      segmentDimension: readSegmentDimension(
        row,
        columnIndex,
        rowIndex,
      ),
      segmentValue: readString(
        row,
        columnIndex,
        "segment_value",
        rowIndex,
      ),
      eventCount: readCount(row, columnIndex, "event_count", rowIndex),
      learnerCount: readCount(row, columnIndex, "learner_count", rowIndex),
    };
  });
}

export function parseSubscriptionFunnelProgressionResult(
  result: SubscriptionFunnelQueryResult,
): SubscriptionFunnelProgressionRow[] {
  const columnIndex = new Map(
    result.columns.map((column, index) => [column, index]),
  );
  const progressionStages = SUBSCRIPTION_FUNNEL_SUCCESS_STAGE_EVENTS.slice(
    1,
  ) as readonly SubscriptionFunnelProgressionStageEvent[];

  return result.results.map((row, rowIndex) => ({
    period: readPeriod(row, columnIndex, rowIndex),
    segmentDimension: readSegmentDimension(row, columnIndex, rowIndex),
    segmentValue: readString(
      row,
      columnIndex,
      "segment_value",
      rowIndex,
    ),
    progressedLearners: Object.fromEntries(
      progressionStages.map((event) => [
        event,
        readCount(
          row,
          columnIndex,
          `progressed_${event}`,
          rowIndex,
        ),
      ]),
    ) as Record<SubscriptionFunnelProgressionStageEvent, number>,
  }));
}

function readPeriod(
  row: unknown[],
  columnIndex: Map<string, number>,
  rowIndex: number,
): SubscriptionFunnelQueryRow["period"] {
  const period = readString(row, columnIndex, "period", rowIndex);
  if (period !== "baseline" && period !== "current") {
    throw new Error(`Invalid Subscription funnel period at row ${rowIndex}`);
  }
  return period;
}

function readSegmentDimension(
  row: unknown[],
  columnIndex: Map<string, number>,
  rowIndex: number,
): SubscriptionFunnelQueryDimension {
  const value = readString(row, columnIndex, "segment_dimension", rowIndex);
  if (
    value !== "overall" &&
    !(SUBSCRIPTION_FUNNEL_SEGMENT_DIMENSIONS as readonly string[]).includes(
      value,
    )
  ) {
    throw new Error(
      `Invalid Subscription funnel segment_dimension at row ${rowIndex}`,
    );
  }
  return value as SubscriptionFunnelQueryDimension;
}

function readString(
  row: unknown[],
  columnIndex: Map<string, number>,
  column: string,
  rowIndex: number,
): string {
  const index = columnIndex.get(column);
  const value = index === undefined ? undefined : row[index];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Invalid Subscription funnel ${column} at row ${rowIndex}`,
    );
  }
  return value;
}

function readCount(
  row: unknown[],
  columnIndex: Map<string, number>,
  column: string,
  rowIndex: number,
): number {
  const index = columnIndex.get(column);
  const raw = index === undefined ? undefined : row[index];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Invalid Subscription funnel ${column} at row ${rowIndex}`,
    );
  }
  return value;
}
