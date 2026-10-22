import { measurementPercentile } from "./report-statistics";
import {
  DEFAULT_REPORT_WINDOW_DAYS as DEFAULT_WINDOW_DAYS,
  type TimeWindow,
  lastNDays,
  comparisonWindow,
  serializeWindow,
  isoDay,
} from "./report-window";
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { HISTORY_ROW_CAP, SUMMARIES_ROW_CAP } from "./admin-constants";
import { QueryError } from "./errors";
import {
  addWarning,
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
      p95Seconds: measurementPercentile(byDay.get(day) ?? [], 0.95),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    window: serializeWindow(currentWindow),
    p50Seconds: measurementPercentile(current.map((summary) => summary.processing_time_seconds), 0.5),
    p95Seconds: measurementPercentile(current.map((summary) => summary.processing_time_seconds), 0.95),
    transcribeP95Seconds: measurementPercentile(current.map((summary) => summary.transcribe_time_seconds), 0.95),
    summarizeP95Seconds: measurementPercentile(current.map((summary) => summary.summarize_time_seconds), 0.95),
    prev: {
      p50Seconds: measurementPercentile(previous.map((summary) => summary.processing_time_seconds), 0.5),
      p95Seconds: measurementPercentile(previous.map((summary) => summary.processing_time_seconds), 0.95),
      transcribeP95Seconds: measurementPercentile(previous.map((summary) => summary.transcribe_time_seconds), 0.95),
      summarizeP95Seconds: measurementPercentile(previous.map((summary) => summary.summarize_time_seconds), 0.95),
    },
    latencyByBucket,
    warnings,
  };
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
