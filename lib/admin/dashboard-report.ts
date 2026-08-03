import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRANSCRIPT_SOURCES,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";
import { HISTORY_ROW_CAP, SUMMARIES_ROW_CAP } from "./admin-constants";
import { WHISPER_FLAG_THRESHOLD } from "./constants";
import { QueryError } from "./errors";
import {
  reportCompletenessWarning,
  REPORT_COMPLETENESS_WARNING_CODES,
  type ReportCompletenessWarning,
} from "./report-completeness";
import type {
  DashboardDailyPoint,
  DashboardReport,
  DashboardReportInput,
  DashboardReportWindow,
  DashboardTopUserStat,
} from "./report-types";
import { listUserAccounts } from "./user-account-directory";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const TOP_USER_LIMIT = 5;

type TimeWindow = {
  start: Date;
  end: Date;
};

interface SummaryRow {
  id: string;
  video_id: string;
  transcript_source: string;
  processing_time_seconds: number | null;
  transcribe_time_seconds: number | null;
  summarize_time_seconds: number | null;
  created_at: string;
}

interface HistoryRow {
  user_id: string;
  video_id: string;
  created_at: string;
  cacheHit?: boolean;
}

interface AdminFilter {
  excludeUserIds: string[];
  warnings: ReportCompletenessWarning[];
}

interface TopUserResult {
  rows: DashboardTopUserStat[];
  emailLookupFailed: boolean;
}

interface SummaryRead {
  rows: SummaryRow[];
  truncated: boolean;
}

interface HistoryRead {
  rows: HistoryRow[];
  truncated: boolean;
  cacheLookupFailed: boolean;
}

/**
 * Load the complete Dashboard report from one server-only boundary.
 * Authorization and privileged-client construction remain in the route.
 */
export async function loadDashboardReport(
  client: SupabaseClient,
  input: DashboardReportInput = {
    windowDays: DEFAULT_WINDOW_DAYS,
    includeAdministrators: false,
  },
): Promise<DashboardReport> {
  const currentWindow = lastNDays(input.windowDays);
  const previousWindow = comparisonWindow(currentWindow);
  const adminFilter: AdminFilter = input.includeAdministrators
    ? { excludeUserIds: [], warnings: [] }
    : await loadAdminFilter(client);
  const wantFilter = adminFilter.excludeUserIds.length > 0;

  const [currentRead, previousRead, historyRead, previousHistoryRead] =
    await Promise.all([
      fetchSummariesIn(client, currentWindow),
      fetchSummariesIn(client, previousWindow),
      fetchHistoryIn(client, currentWindow, adminFilter.excludeUserIds),
      fetchHistoryIn(client, previousWindow, adminFilter.excludeUserIds),
    ]);
  const current = currentRead.rows;
  const previous = previousRead.rows;
  const history = historyRead.rows;
  const previousHistory = previousHistoryRead.rows;
  const warnings = [...adminFilter.warnings];
  if (currentRead.truncated || previousRead.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.dashboardSummariesTruncated,
      ),
    );
  }
  if (historyRead.truncated || previousHistoryRead.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.dashboardActivityTruncated,
      ),
    );
  }
  if (historyRead.cacheLookupFailed || previousHistoryRead.cacheLookupFailed) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.dashboardCacheHitUnavailable,
      ),
    );
  }

  const filteredCurrent = restrictSummariesToHistory(
    current,
    history,
    wantFilter,
  );
  const filteredPrevious = restrictSummariesToHistory(
    previous,
    previousHistory,
    wantFilter,
  );

  const topUsers = await computeTopUsers(
    client,
    history,
    filteredCurrent,
    TOP_USER_LIMIT,
  );
  if (topUsers.emailLookupFailed) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.topUserAccountLookupUnavailable,
      ),
    );
  }

  const sourceCounts = new Map<TranscriptSource, number>();
  for (const summary of filteredCurrent) {
    const source = summary.transcript_source as TranscriptSource;
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  const whisperCurrent = filteredCurrent.filter(
    (summary) => summary.transcript_source === "whisper",
  ).length;
  const whisperPrevious = filteredPrevious.filter(
    (summary) => summary.transcript_source === "whisper",
  ).length;

  return {
    window: serializeWindow(currentWindow),
    summaries: {
      current: filteredCurrent.length,
      previous: filteredPrevious.length,
    },
    whisper: { current: whisperCurrent, previous: whisperPrevious },
    p95Seconds: {
      current: p95(filteredCurrent.map((summary) => summary.processing_time_seconds)),
      previous: p95(
        filteredPrevious.map((summary) => summary.processing_time_seconds),
      ),
    },
    transcribeP95Seconds: p95(
      filteredCurrent.map((summary) => summary.transcribe_time_seconds),
    ),
    summarizeP95Seconds: p95(
      filteredCurrent.map((summary) => summary.summarize_time_seconds),
    ),
    cacheHitRatePct: {
      current: computeCacheHitRate(history, !historyRead.cacheLookupFailed),
      previous: computeCacheHitRate(
        previousHistory,
        !previousHistoryRead.cacheLookupFailed,
      ),
    },
    summariesPerDay: bucketByDay(filteredCurrent, currentWindow),
    dauPerDay: bucketByDay(history, currentWindow, (rows) => {
      const distinct = new Set<string>();
      for (const row of rows) distinct.add(row.user_id);
      return distinct.size;
    }),
    cacheHitPerDay: bucketByDay(
      history,
      currentWindow,
      historyRead.cacheLookupFailed
        ? () => 0
        : (rows) => {
            if (rows.length === 0) return 0;
            const hits = rows.filter((row) => row.cacheHit === true).length;
            return Math.round((hits / rows.length) * 100);
          },
    ),
    sourceMix: TRANSCRIPT_SOURCES.map((source) => ({
      source,
      count: sourceCounts.get(source) ?? 0,
    })),
    topUsers: topUsers.rows,
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
  const days =
    Math.round((window.end.getTime() - window.start.getTime()) / DAY_MS) + 1;
  return {
    start: new Date(window.start.getTime() - days * DAY_MS),
    end: new Date(window.start.getTime() - DAY_MS),
  };
}

function serializeWindow(window: TimeWindow): DashboardReportWindow {
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
  };
}

function addWarning(
  warnings: ReportCompletenessWarning[],
  warning: ReportCompletenessWarning,
): void {
  if (!warnings.some((existing) => existing.code === warning.code)) {
    warnings.push(warning);
  }
}

async function loadAdminFilter(client: SupabaseClient): Promise<AdminFilter> {
  try {
    const directory = await listUserAccounts(client);
    return {
      excludeUserIds: directory.users
        .filter((user) => user.isAdministrator)
        .map((user) => user.id),
      warnings: directory.truncated
        ? [
            reportCompletenessWarning(
              REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryTruncated,
            ),
          ]
        : [],
    };
  } catch (error) {
    console.error("[dashboard-report] administrator enumeration unavailable", {
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
  if (error) throw new QueryError("loadDashboardReport:summaries", error.message);
  const truncated = Boolean(data && data.length === SUMMARIES_ROW_CAP);
  if (truncated) {
    console.warn("[dashboard-report] summaries cap hit — KPIs may understate", {
      cap: SUMMARIES_ROW_CAP,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      },
    });
  }
  return { rows: (data ?? []) as SummaryRow[], truncated };
}

async function fetchHistoryIn(
  client: SupabaseClient,
  window: TimeWindow,
  excludeUserIds: string[],
): Promise<HistoryRead> {
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

  const { data: history, error } = await query.limit(HISTORY_ROW_CAP);
  if (error) throw new QueryError("loadDashboardReport:history", error.message);
  const truncated = Boolean(history && history.length === HISTORY_ROW_CAP);
  if (truncated) {
    console.warn("[dashboard-report] history cap hit — DAU/cache-hit may understate", {
      cap: HISTORY_ROW_CAP,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      },
    });
  }
  if (!history || history.length === 0) {
    return { rows: [], truncated, cacheLookupFailed: false };
  }

  const videoIds = Array.from(new Set(history.map((row) => row.video_id as string)));
  if (videoIds.length === 0) {
    return {
      rows: history as HistoryRow[],
      truncated,
      cacheLookupFailed: false,
    };
  }
  const { data: summaries, error: summaryError } = await client
    .from("summaries")
    .select("video_id, created_at")
    .in("video_id", videoIds);
  if (summaryError) {
    console.error("[dashboard-report] cache-hit enrichment unavailable", {
      message: summaryError.message,
    });
    return {
      rows: history as HistoryRow[],
      truncated,
      cacheLookupFailed: true,
    };
  }

  const earliestByVideo = new Map<string, string>();
  for (const summary of summaries ?? []) {
    const videoId = summary.video_id as string;
    const createdAt = summary.created_at as string;
    const earliest = earliestByVideo.get(videoId);
    if (!earliest || createdAt < earliest) {
      earliestByVideo.set(videoId, createdAt);
    }
  }

  return {
    rows: (history as HistoryRow[]).map((row) => {
      const earliest = earliestByVideo.get(row.video_id);
      return {
        ...row,
        cacheHit: earliest ? earliest < row.created_at : false,
      };
    }),
    truncated,
    cacheLookupFailed: false,
  };
}

function restrictSummariesToHistory<T extends { video_id: string }>(
  summaries: T[],
  history: HistoryRow[],
  wantFilter: boolean,
): T[] {
  if (!wantFilter) return summaries;
  const allowedVideoIds = new Set(history.map((row) => row.video_id));
  return summaries.filter((summary) => allowedVideoIds.has(summary.video_id));
}

function computeCacheHitRate(
  history: HistoryRow[],
  cacheDataAvailable: boolean,
): number | null {
  if (!cacheDataAvailable || history.length === 0) return null;
  const hits = history.filter((row) => row.cacheHit === true).length;
  return Math.round((hits / history.length) * 100);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fillDailySeries(
  start: Date,
  end: Date,
  bucketed: Map<string, number>,
): DashboardDailyPoint[] {
  const output: DashboardDailyPoint[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = isoDay(cursor);
    output.push({ day, value: bucketed.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

function bucketByDay<T extends { created_at: string }>(
  rows: T[],
  window: TimeWindow,
  reducer: (rowsForDay: T[]) => number = (rowsForDay) => rowsForDay.length,
): DashboardDailyPoint[] {
  const byDay = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.created_at) continue;
    const day = isoDay(new Date(row.created_at));
    const dayRows = byDay.get(day) ?? [];
    dayRows.push(row);
    byDay.set(day, dayRows);
  }

  const reduced = new Map<string, number>();
  for (const [day, dayRows] of byDay) {
    reduced.set(day, reducer(dayRows));
  }
  return fillDailySeries(window.start, window.end, reduced);
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

async function computeTopUsers(
  client: SupabaseClient,
  history: HistoryRow[],
  summaries: SummaryRow[],
  limit: number,
): Promise<TopUserResult> {
  const summariesByVideo = new Map<string, SummaryRow>();
  for (const summary of summaries) {
    if (!summariesByVideo.has(summary.video_id)) {
      summariesByVideo.set(summary.video_id, summary);
    }
  }

  const tally = new Map<
    string,
    { total: number; whisper: number; latencies: number[]; lastSeen: string }
  >();
  for (const row of history) {
    const summary = summariesByVideo.get(row.video_id);
    const bucket = tally.get(row.user_id) ?? {
      total: 0,
      whisper: 0,
      latencies: [],
      lastSeen: row.created_at,
    };
    bucket.total += 1;
    if (summary?.transcript_source === "whisper") bucket.whisper += 1;
    if (summary?.processing_time_seconds != null) {
      bucket.latencies.push(summary.processing_time_seconds);
    }
    if (row.created_at > bucket.lastSeen) bucket.lastSeen = row.created_at;
    tally.set(row.user_id, bucket);
  }

  const sorted = Array.from(tally.entries())
    .map(([userId, bucket]) => ({
      userId,
      summaries: bucket.total,
      whisperPct:
        bucket.total > 0 ? Math.round((bucket.whisper / bucket.total) * 100) : 0,
      p95Seconds: p95(bucket.latencies),
      lastSeen: bucket.lastSeen,
    }))
    .sort((a, b) => b.summaries - a.summaries)
    .slice(0, limit);

  if (sorted.length === 0) {
    return { rows: [], emailLookupFailed: false };
  }

  const emailLookups = await Promise.all(
    sorted.map(async (top) => {
      try {
        const { data, error } = await client.auth.admin.getUserById(top.userId);
        if (error) {
          console.error("[dashboard-report] top User-Account lookup failed", {
            userId: top.userId,
            message: error.message,
          });
          return { userId: top.userId, email: null, ok: false };
        }
        return {
          userId: top.userId,
          email: data.user?.email ?? null,
          ok: true,
        };
      } catch (error) {
        console.error("[dashboard-report] top User-Account lookup threw", {
          userId: top.userId,
          message: error instanceof Error ? error.message : String(error),
        });
        return { userId: top.userId, email: null, ok: false };
      }
    }),
  );
  const lookups = new Map(emailLookups.map((lookup) => [lookup.userId, lookup]));

  return {
    emailLookupFailed: emailLookups.some((lookup) => !lookup.ok),
    rows: sorted.map((top) => {
      const lookup = lookups.get(top.userId);
      return {
        userId: top.userId,
        email: lookup?.email ?? null,
        emailLookupOk: lookup?.ok ?? false,
        summaries: top.summaries,
        whisperPct: top.whisperPct,
        p95Seconds: top.p95Seconds,
        lastSeen: top.lastSeen,
        flagged:
          top.summaries > 0 && top.whisperPct > WHISPER_FLAG_THRESHOLD,
      };
    }),
  };
}
