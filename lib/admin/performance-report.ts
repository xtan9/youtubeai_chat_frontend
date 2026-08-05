import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { HISTORY_ROW_CAP, SUMMARIES_ROW_CAP } from "./admin-constants";
import { QueryError } from "./errors";
import {
  reportCompletenessWarning,
  REPORT_COMPLETENESS_WARNING_CODES,
  type ReportCompletenessWarning,
} from "./report-completeness";
import type {
  PerformanceReport,
  PerformanceReportInput,
} from "./report-types";
import {
  getExcludedBusinessActivityUserIds,
  listUserAccounts,
} from "./user-account-directory";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

type TimeWindow = {
  start: Date;
  end: Date;
};

interface SummaryRow {
  video_id: string;
  processing_time_seconds: number | null;
  transcribe_time_seconds: number | null;
  summarize_time_seconds: number | null;
  created_at: string;
}

interface ActivityRow {
  video_id: string;
  created_at: string;
}

interface SummaryRead {
  rows: SummaryRow[];
  truncated: boolean;
}

interface ActivityRead {
  rows: ActivityRow[];
  truncated: boolean;
  unavailable: boolean;
}

interface AdminFilter {
  excludeUserIds: string[];
  warnings: ReportCompletenessWarning[];
}

/**
 * Load the complete Performance report from one server-only boundary.
 * Authorization and privileged-client construction remain in the route.
 */
export async function loadPerformanceReport(
  client: SupabaseClient,
  input: PerformanceReportInput = {
    windowDays: DEFAULT_WINDOW_DAYS,
    includeAdministrators: false,
  },
): Promise<PerformanceReport> {
  const currentWindow = lastNDays(input.windowDays);
  const previousWindow = comparisonWindow(currentWindow);
  const adminFilter = await loadAdminFilter(
    client,
    input.includeAdministrators,
  );
  const wantFilter = adminFilter.excludeUserIds.length > 0;

  const [currentRead, previousRead, currentActivity, previousActivity] =
    await Promise.all([
      fetchSummariesIn(client, currentWindow),
      fetchSummariesIn(client, previousWindow),
      wantFilter
        ? fetchActivitySafely(client, currentWindow, adminFilter.excludeUserIds)
        : Promise.resolve(emptyActivityRead()),
      wantFilter
        ? fetchActivitySafely(client, previousWindow, adminFilter.excludeUserIds)
        : Promise.resolve(emptyActivityRead()),
    ]);

  const warnings = [...adminFilter.warnings];
  if (currentRead.truncated || previousRead.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.performanceSummariesTruncated,
      ),
    );
  }
  if (currentActivity.unavailable || previousActivity.unavailable) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.performanceActivityUnavailable,
      ),
    );
  }
  if (currentActivity.truncated || previousActivity.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.performanceActivityTruncated,
      ),
    );
  }

  const current = restrictSummariesToActivity(
    currentRead.rows,
    currentActivity,
    wantFilter,
  );
  const previous = restrictSummariesToActivity(
    previousRead.rows,
    previousActivity,
    wantFilter,
  );

  const byDay = new Map<string, number[]>();
  for (const summary of current) {
    if (!summary.created_at || summary.processing_time_seconds == null) continue;
    const day = isoDay(new Date(summary.created_at));
    const values = byDay.get(day) ?? [];
    values.push(summary.processing_time_seconds);
    byDay.set(day, values);
  }

  const latencyByBucket: { day: string; p95Seconds: number | null }[] = [];
  const cursor = new Date(currentWindow.start);
  while (cursor <= currentWindow.end) {
    const day = isoDay(cursor);
    latencyByBucket.push({
      day,
      p95Seconds: p95(byDay.get(day) ?? []),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    window: serializeWindow(currentWindow),
    p50Seconds: p50(current.map((summary) => summary.processing_time_seconds)),
    p95Seconds: p95(current.map((summary) => summary.processing_time_seconds)),
    transcribeP95Seconds: p95(
      current.map((summary) => summary.transcribe_time_seconds),
    ),
    summarizeP95Seconds: p95(
      current.map((summary) => summary.summarize_time_seconds),
    ),
    prev: {
      p50Seconds: p50(
        previous.map((summary) => summary.processing_time_seconds),
      ),
      p95Seconds: p95(
        previous.map((summary) => summary.processing_time_seconds),
      ),
      transcribeP95Seconds: p95(
        previous.map((summary) => summary.transcribe_time_seconds),
      ),
      summarizeP95Seconds: p95(
        previous.map((summary) => summary.summarize_time_seconds),
      ),
    },
    latencyByBucket,
    warnings,
  };
}

function normalizeWindowDays(windowDays: number): number {
  return Number.isFinite(windowDays) && windowDays > 0
    ? Math.max(1, Math.floor(windowDays))
    : DEFAULT_WINDOW_DAYS;
}

function lastNDays(windowDays: number): TimeWindow {
  const days = normalizeWindowDays(windowDays);
  const end = new Date();
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start, end };
}

function comparisonWindow(window: TimeWindow): TimeWindow {
  // Keep the existing Performance query's elapsed-window calculation so
  // current-versus-previous values retain their established behavior.
  const days = Math.round((window.end.getTime() - window.start.getTime()) / DAY_MS) + 1;
  return {
    start: new Date(window.start.getTime() - days * DAY_MS),
    end: new Date(window.start.getTime() - DAY_MS),
  };
}

function serializeWindow(window: TimeWindow): { start: string; end: string } {
  return { start: window.start.toISOString(), end: window.end.toISOString() };
}

async function loadAdminFilter(
  client: SupabaseClient,
  includeAdministrators: boolean,
): Promise<AdminFilter> {
  try {
    const directory = await listUserAccounts(client);
    return {
      excludeUserIds: getExcludedBusinessActivityUserIds(
        directory.users,
        includeAdministrators,
      ),
      warnings: directory.truncated
        ? [
            reportCompletenessWarning(
              REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryTruncated,
            ),
          ]
        : [],
    };
  } catch (error) {
    console.error("[performance-report] business-account audience enumeration unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      excludeUserIds: [],
      warnings: [
        reportCompletenessWarning(
          REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryUnavailable,
        ),
      ],
    };
  }
}

async function fetchSummariesIn(
  client: SupabaseClient,
  window: TimeWindow,
): Promise<SummaryRead> {
  const { data, error } = await client
    .from("summaries")
    .select(
      "id, video_id, transcript_source, processing_time_seconds, transcribe_time_seconds, summarize_time_seconds, created_at",
    )
    .gte("created_at", window.start.toISOString())
    .lte("created_at", window.end.toISOString())
    .limit(SUMMARIES_ROW_CAP);
  if (error) {
    throw new QueryError("loadPerformanceReport:summaries", error.message);
  }

  const truncated = Boolean(data && data.length === SUMMARIES_ROW_CAP);
  if (truncated) {
    console.warn("[performance-report] summaries cap hit", {
      cap: SUMMARIES_ROW_CAP,
      window: serializeWindow(window),
    });
  }
  return { rows: (data ?? []) as SummaryRow[], truncated };
}

async function fetchActivitySafely(
  client: SupabaseClient,
  window: TimeWindow,
  excludeUserIds: string[],
): Promise<ActivityRead> {
  try {
    return await fetchActivityIn(client, window, excludeUserIds);
  } catch (error) {
    console.error("[performance-report] administrator-exclusion activity unavailable", {
      message: error instanceof Error ? error.message : String(error),
      window: serializeWindow(window),
    });
    return { rows: [], truncated: false, unavailable: true };
  }
}

async function fetchActivityIn(
  client: SupabaseClient,
  window: TimeWindow,
  excludeUserIds: string[],
): Promise<ActivityRead> {
  const cleanedExcludes = excludeUserIds.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  let query = client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .gte("accessed_at", window.start.toISOString())
    .lte("accessed_at", window.end.toISOString());

  if (cleanedExcludes.length > 0) {
    query = query.not("user_id", "in", `(${cleanedExcludes.join(",")})`);
  }

  const { data, error } = await query.limit(HISTORY_ROW_CAP);
  if (error) {
    throw new QueryError("loadPerformanceReport:activity", error.message);
  }

  const truncated = Boolean(data && data.length === HISTORY_ROW_CAP);
  if (truncated) {
    console.warn("[performance-report] activity cap hit", {
      cap: HISTORY_ROW_CAP,
      window: serializeWindow(window),
    });
  }
  return {
    rows: (data ?? []) as ActivityRow[],
    truncated,
    unavailable: false,
  };
}

function emptyActivityRead(): ActivityRead {
  return { rows: [], truncated: false, unavailable: false };
}

function restrictSummariesToActivity(
  summaries: SummaryRow[],
  activity: ActivityRead,
  wantFilter: boolean,
): SummaryRow[] {
  // If the secondary activity read failed, preserve usable Performance data
  // and make the incomplete exclusion explicit through the warning.
  if (!wantFilter || activity.unavailable) return summaries;
  const allowedVideoIds = new Set(activity.rows.map((row) => row.video_id));
  return summaries.filter((summary) => allowedVideoIds.has(summary.video_id));
}

function addWarning(
  warnings: ReportCompletenessWarning[],
  warning: ReportCompletenessWarning,
): void {
  if (!warnings.some((existing) => existing.code === warning.code)) {
    warnings.push(warning);
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function percentile(sorted: number[], percentileValue: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}

function p95(values: (number | null | undefined)[]): number | null {
  const filtered = values
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value),
    )
    .sort((a, b) => a - b);
  return percentile(filtered, 0.95);
}

function p50(values: (number | null | undefined)[]): number | null {
  const filtered = values
    .filter((value): value is number =>
      typeof value === "number" && Number.isFinite(value),
    )
    .sort((a, b) => a - b);
  return percentile(filtered, 0.5);
}
