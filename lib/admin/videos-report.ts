import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRANSCRIPT_SOURCES,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";
import {
  HISTORY_ROW_CAP,
  VIDEOS_PAGE_SIZE_CAP,
  VIDEOS_ROW_CAP,
} from "./admin-constants";
import { WHISPER_FLAG_THRESHOLD } from "./constants";
import { QueryError } from "./errors";
import {
  reportCompletenessWarning,
  REPORT_COMPLETENESS_WARNING_CODES,
  type ReportCompletenessWarning,
} from "./report-completeness";
import { listUserAccounts } from "./user-account-directory";

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_PAGE_SIZE = 25;
const STALE_VIDEO_DAYS = 30;

export type VideoReportMode = "all_time" | "trending";

export type VideoReportSortKey =
  | "distinctUsers"
  | "totalSummaries"
  | "title"
  | "channelName"
  | "language"
  | "firstSummarizedAt"
  | "lastSummarizedAt"
  | "whisperPct"
  | "p95ProcessingSeconds"
  | "durationSeconds";

export type VideoReportSortDirection = "asc" | "desc";

/** Filter intent for the Videos route; policy and query mechanics stay private. */
export interface VideoReportFilters {
  language: string | null;
  source: TranscriptSource | null;
  channel: string | null;
  model: string | null;
}

export interface VideoReportDateBounds {
  from: string | null;
  to: string | null;
}

export interface VideoReportPagination {
  page: number;
  pageSize: number;
}

/** Serializable route intent accepted by the single Videos report boundary. */
export interface VideosReportInput {
  mode: VideoReportMode;
  windowDays: number;
  search: string | null;
  filters: VideoReportFilters;
  dateBounds: VideoReportDateBounds;
  sort: VideoReportSortKey;
  direction: VideoReportSortDirection;
  pagination: VideoReportPagination;
  flaggedOnly: boolean;
  expandedVideoId: string | null;
}

export interface VideoReportRow {
  videoId: string;
  title: string | null;
  channelName: string | null;
  language: string | null;
  durationSeconds: number | null;
  /** Earliest summaries.created_at observed for this Video. */
  firstSummarizedAt: string;
  /** Most recent user_video_history.accessed_at observed. */
  lastSummarizedAt: string;
  distinctUsers: number;
  totalSummaries: number;
  sourceMix: { source: TranscriptSource; count: number }[];
  whisperPct: number;
  modelsUsed: string[];
  p95ProcessingSeconds: number | null;
  flagged: boolean;
  status: "active" | "stale";
}

export interface VideoReportList {
  rows: VideoReportRow[];
  total: number;
  truncated: boolean;
  page: number;
  pageCount: number;
  /** Compatibility signal for callers that need the old boolean alongside warnings. */
  adminFilterIncomplete: boolean;
}

export interface VideoReportInsights {
  totalUniqueVideos: number;
  totalSummaries: number;
  whisperVideoSharePct: number;
  topChannels: { channelName: string; videoCount: number }[];
  languageMix: { language: string; videoCount: number }[];
  sourceMix: { source: TranscriptSource; count: number }[];
  trendingPerDay?: { day: string; value: number }[];
  /** Compatibility signal for callers that need the old boolean alongside warnings. */
  adminFilterIncomplete: boolean;
}

/** Complete serializable Videos data owned by the single report loader. */
export interface VideosReport {
  list: VideoReportList;
  insights: VideoReportInsights;
  expandedVideoId: string | null;
  warnings: ReportCompletenessWarning[];
}

interface TimeWindow {
  start: Date;
  end: Date;
}

interface HistoryRow {
  user_id: string;
  video_id: string;
  created_at: string;
}

interface AdminFilter {
  userIds: string[];
  warnings: ReportCompletenessWarning[];
}

interface AdminTouchedVideoLookup {
  videoIds: Set<string>;
  truncated: boolean;
}

interface VideoDataset {
  videos: Array<Record<string, unknown>>;
  summaries: Array<Record<string, unknown>>;
}

interface VideoScope {
  history: HistoryRow[];
  videos: Array<Record<string, unknown>>;
  summaries: Array<Record<string, unknown>>;
  videoIds: string[];
  truncated: boolean;
}

interface NormalizedIntent {
  mode: VideoReportMode;
  windowDays: number;
  search: string | null;
  filters: VideoReportFilters;
  dateBounds: VideoReportDateBounds;
  sort: VideoReportSortKey;
  direction: VideoReportSortDirection;
  page: number;
  pageSize: number;
  flaggedOnly: boolean;
  expandedVideoId: string | null;
}

/**
 * Load Videos rows and insights from one shared scope and one administrator
 * filtering policy. Authorization and privileged-client creation remain in
 * the route; all report policy is private to this server-only boundary.
 */
export async function loadVideosReport(
  client: SupabaseClient,
  input: VideosReportInput,
): Promise<VideosReport> {
  const intent = normalizeIntent(input);
  const window =
    intent.mode === "trending" ? lastNDays(intent.windowDays) : null;
  const adminFilter = await loadAdminFilter(client);
  const adminTouched = await listAdminTouchedVideoIds(
    client,
    adminFilter.userIds,
  );
  const warnings = [...adminFilter.warnings];
  if (adminTouched.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.administratorTouchedVideosTruncated,
      ),
    );
  }

  const rawHistory = await fetchHistory(client, window);
  const history = adminTouched.videoIds.size
    ? rawHistory.filter((row) => !adminTouched.videoIds.has(row.video_id))
    : rawHistory;
  const scope = await loadVideoScope(client, history);
  const rows = aggregateVideoRows(
    scope.history,
    scope.videos,
    scope.summaries,
  );
  const filteredRows = filterVideoRows(rows, intent);
  const sortedRows = sortVideoRows(
    filteredRows,
    intent.sort,
    intent.direction,
  );
  const pageCount = Math.max(
    1,
    Math.ceil(sortedRows.length / intent.pageSize),
  );
  const pageStart = (intent.page - 1) * intent.pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + intent.pageSize);
  const adminFilterIncomplete = adminTouched.truncated;

  return {
    list: {
      rows: pageRows,
      total: sortedRows.length,
      truncated: scope.truncated,
      page: intent.page,
      pageCount,
      adminFilterIncomplete,
    },
    insights: computeInsights(
      scope,
      window,
      adminFilterIncomplete,
    ),
    expandedVideoId:
      intent.expandedVideoId &&
      pageRows.some((row) => row.videoId === intent.expandedVideoId)
        ? intent.expandedVideoId
        : null,
    warnings,
  };
}

function normalizeIntent(input: VideosReportInput): NormalizedIntent {
  const mode: VideoReportMode =
    input.mode === "trending" ? "trending" : "all_time";
  const windowDays = normalizeWindowDays(input.windowDays);
  const pageSize = normalizePageSize(input.pagination?.pageSize);
  const page = normalizePage(input.pagination?.page);
  return {
    mode,
    windowDays,
    search: normalizeText(input.search),
    filters: {
      language: normalizeText(input.filters?.language),
      source: input.filters?.source ?? null,
      channel: normalizeText(input.filters?.channel),
      model: normalizeText(input.filters?.model),
    },
    dateBounds: {
      from: normalizeText(input.dateBounds?.from),
      to: normalizeText(input.dateBounds?.to),
    },
    sort: isVideoSortKey(input.sort) ? input.sort : "distinctUsers",
    direction: input.direction === "asc" ? "asc" : "desc",
    page,
    pageSize,
    flaggedOnly: input.flaggedOnly === true,
    expandedVideoId: normalizeText(input.expandedVideoId),
  };
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeWindowDays(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(1, Math.floor(value)));
}

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) < 1) return 1;
  return Math.floor(value as number);
}

function normalizePageSize(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(VIDEOS_PAGE_SIZE_CAP, Math.floor(value as number));
}

function isVideoSortKey(value: unknown): value is VideoReportSortKey {
  return (
    value === "distinctUsers" ||
    value === "totalSummaries" ||
    value === "title" ||
    value === "channelName" ||
    value === "language" ||
    value === "firstSummarizedAt" ||
    value === "lastSummarizedAt" ||
    value === "whisperPct" ||
    value === "p95ProcessingSeconds" ||
    value === "durationSeconds"
  );
}

function lastNDays(windowDays: number): TimeWindow {
  const end = new Date();
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  return { start, end };
}

async function loadAdminFilter(client: SupabaseClient): Promise<AdminFilter> {
  try {
    const directory = await listUserAccounts(client);
    return {
      userIds: directory.users
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
    console.error("[videos-report] administrator enumeration unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      userIds: [],
      warnings: [
        reportCompletenessWarning(
          REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryUnavailable,
        ),
      ],
    };
  }
}

async function listAdminTouchedVideoIds(
  client: SupabaseClient,
  adminUserIds: string[],
): Promise<AdminTouchedVideoLookup> {
  const cleaned = adminUserIds.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  if (cleaned.length === 0) {
    return { videoIds: new Set(), truncated: false };
  }

  const { data, error } = await client
    .from("user_video_history")
    .select("video_id")
    .in("user_id", cleaned)
    .limit(HISTORY_ROW_CAP);
  if (error) {
    throw new QueryError(
      "loadVideosReport:administrator-touched-videos",
      error.message,
    );
  }

  const truncated = Boolean(data && data.length === HISTORY_ROW_CAP);
  if (truncated) {
    console.warn("[videos-report] administrator-touched Video cap reached", {
      cap: HISTORY_ROW_CAP,
      adminUserIds: cleaned,
      returnedRows: data?.length ?? 0,
    });
  }

  const videoIds = new Set<string>();
  for (const row of (data ?? []) as Array<{ video_id: string }>) {
    if (typeof row.video_id === "string" && row.video_id.length > 0) {
      videoIds.add(row.video_id);
    }
  }
  return { videoIds, truncated };
}

async function fetchHistory(
  client: SupabaseClient,
  window: TimeWindow | null,
): Promise<HistoryRow[]> {
  let query = client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at");
  if (window) {
    query = query
      .gte("accessed_at", window.start.toISOString())
      .lte("accessed_at", window.end.toISOString());
  }

  const { data, error } = await query
    .order("accessed_at", { ascending: false })
    .limit(HISTORY_ROW_CAP);
  if (error) throw new QueryError("loadVideosReport:history", error.message);
  return (data ?? []) as HistoryRow[];
}

async function loadVideoScope(
  client: SupabaseClient,
  history: HistoryRow[],
): Promise<VideoScope> {
  const videoIds = Array.from(new Set(history.map((row) => row.video_id)));
  const truncated = videoIds.length >= VIDEOS_ROW_CAP;
  const cappedIds = truncated ? videoIds.slice(0, VIDEOS_ROW_CAP) : videoIds;
  if (truncated) {
    console.warn("[videos-report] Video row cap reached", {
      cap: VIDEOS_ROW_CAP,
    });
  }

  if (cappedIds.length === 0) {
    return {
      history: [],
      videos: [],
      summaries: [],
      videoIds: [],
      truncated: false,
    };
  }

  const dataset = await fetchVideoDataset(client, cappedIds);
  const cappedIdSet = new Set(cappedIds);
  const cappedHistory = history.filter((row) => cappedIdSet.has(row.video_id));
  return {
    history: cappedHistory,
    videos: dataset.videos,
    summaries: dataset.summaries,
    videoIds: cappedIds,
    truncated,
  };
}

async function fetchVideoDataset(
  client: SupabaseClient,
  videoIds: string[],
): Promise<VideoDataset> {
  const [videosRes, summariesRes] = await Promise.all([
    client
      .from("videos")
      .select("id, title, channel_name, language, duration_seconds:duration")
      .in("id", videoIds),
    client
      .from("summaries")
      .select(
        "video_id, transcript_source, model, processing_time_seconds, created_at",
      )
      .in("video_id", videoIds),
  ]);
  if (videosRes.error) {
    throw new QueryError("loadVideosReport:videos", videosRes.error.message);
  }
  if (summariesRes.error) {
    throw new QueryError(
      "loadVideosReport:summaries",
      summariesRes.error.message,
    );
  }
  return {
    videos: (videosRes.data ?? []) as Array<Record<string, unknown>>,
    summaries: (summariesRes.data ?? []) as Array<Record<string, unknown>>,
  };
}

function buildVideoMap(
  videos: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const videoById = new Map<string, Record<string, unknown>>();
  for (const video of videos) videoById.set(String(video.id), video);
  return videoById;
}

function buildSummaryMap(
  summaries: Array<Record<string, unknown>>,
): Map<string, Array<Record<string, unknown>>> {
  const summariesByVideo = new Map<string, Array<Record<string, unknown>>>();
  for (const summary of summaries) {
    const videoId = String(summary.video_id);
    const rows = summariesByVideo.get(videoId) ?? [];
    rows.push(summary);
    summariesByVideo.set(videoId, rows);
  }
  return summariesByVideo;
}

function canonicalSummary(
  summariesByVideo: Map<string, Array<Record<string, unknown>>>,
  videoId: string,
): Record<string, unknown> | null {
  return summariesByVideo.get(videoId)?.[0] ?? null;
}

function aggregateVideoRows(
  history: HistoryRow[],
  videos: Array<Record<string, unknown>>,
  summaries: Array<Record<string, unknown>>,
): VideoReportRow[] {
  const videoById = buildVideoMap(videos);
  const summariesByVideo = buildSummaryMap(summaries);
  type Bucket = {
    users: Set<string>;
    views: number;
    lastSeen: string;
    sourceCounts: Map<TranscriptSource, number>;
    whisperViews: number;
  };

  const buckets = new Map<string, Bucket>();
  for (const row of history) {
    const canonical = canonicalSummary(summariesByVideo, row.video_id);
    const source = (canonical?.transcript_source ??
      "auto_captions") as TranscriptSource;
    const bucket = buckets.get(row.video_id) ?? {
      users: new Set<string>(),
      views: 0,
      lastSeen: row.created_at,
      sourceCounts: new Map<TranscriptSource, number>(),
      whisperViews: 0,
    };
    bucket.users.add(row.user_id);
    bucket.views += 1;
    bucket.sourceCounts.set(
      source,
      (bucket.sourceCounts.get(source) ?? 0) + 1,
    );
    if (source === "whisper") bucket.whisperViews += 1;
    if (row.created_at > bucket.lastSeen) bucket.lastSeen = row.created_at;
    buckets.set(row.video_id, bucket);
  }

  const staleCutoff = Date.now() - STALE_VIDEO_DAYS * DAY_MS;
  const rows: VideoReportRow[] = [];
  for (const [videoId, bucket] of buckets) {
    const video = videoById.get(videoId);
    const summariesForVideo = summariesByVideo.get(videoId) ?? [];
    const firstSummarizedAt =
      summariesForVideo
        .map((summary) => String(summary.created_at))
        .filter((createdAt) => createdAt.length > 0)
        .sort()[0] ?? bucket.lastSeen;
    const modelsUsed = Array.from(
      new Set(
        summariesForVideo
          .map((summary) =>
            typeof summary.model === "string" ? summary.model : null,
          )
          .filter((model): model is string => model !== null),
      ),
    );
    const sourceMix = Array.from(bucket.sourceCounts.entries()).map(
      ([source, count]) => ({ source, count }),
    );
    const whisperPct =
      bucket.views > 0
        ? Math.round((bucket.whisperViews / bucket.views) * 100)
        : 0;
    const processingTimes = summariesForVideo
      .map((summary) =>
        typeof summary.processing_time_seconds === "number"
          ? summary.processing_time_seconds
          : null,
      )
      .filter(
        (value): value is number => value !== null && Number.isFinite(value),
      );

    rows.push({
      videoId,
      title: (video?.title as string | null) ?? null,
      channelName: (video?.channel_name as string | null) ?? null,
      language: (video?.language as string | null) ?? null,
      durationSeconds:
        typeof video?.duration_seconds === "number"
          ? video.duration_seconds
          : null,
      firstSummarizedAt,
      lastSummarizedAt: bucket.lastSeen,
      distinctUsers: bucket.users.size,
      totalSummaries: bucket.views,
      sourceMix,
      whisperPct,
      modelsUsed,
      p95ProcessingSeconds: percentile(processingTimes, 0.95),
      flagged: bucket.views > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
      status:
        new Date(bucket.lastSeen).getTime() >= staleCutoff ? "active" : "stale",
    });
  }
  return rows;
}

function filterVideoRows(
  rows: VideoReportRow[],
  intent: NormalizedIntent,
): VideoReportRow[] {
  return rows.filter((row) => {
    if (intent.search) {
      const query = intent.search.toLowerCase();
      const titleMatches = row.title?.toLowerCase().includes(query) ?? false;
      const channelMatches =
        row.channelName?.toLowerCase().includes(query) ?? false;
      if (!titleMatches && !channelMatches) return false;
    }
    if (intent.filters.language && row.language !== intent.filters.language) {
      return false;
    }
    if (
      intent.filters.source &&
      !row.sourceMix.some(({ source }) => source === intent.filters.source)
    ) {
      return false;
    }
    if (intent.filters.channel && row.channelName !== intent.filters.channel) {
      return false;
    }
    if (
      intent.filters.model &&
      !row.modelsUsed.includes(intent.filters.model)
    ) {
      return false;
    }
    if (intent.flaggedOnly && !row.flagged) return false;

    const firstSummarizedDay = row.firstSummarizedAt.slice(0, 10);
    if (
      intent.dateBounds.from &&
      firstSummarizedDay < intent.dateBounds.from
    ) {
      return false;
    }
    if (intent.dateBounds.to && firstSummarizedDay > intent.dateBounds.to) {
      return false;
    }
    return true;
  });
}

function sortVideoRows(
  rows: VideoReportRow[],
  sort: VideoReportSortKey,
  direction: VideoReportSortDirection,
): VideoReportRow[] {
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    const primary = compareVideoRows(a, b, sort, direction);
    return primary !== 0 ? primary : a.videoId.localeCompare(b.videoId);
  });
  return sorted;
}

function compareVideoRows(
  a: VideoReportRow,
  b: VideoReportRow,
  sort: VideoReportSortKey,
  direction: VideoReportSortDirection,
): number {
  switch (sort) {
    case "distinctUsers":
      return compareNullable(a.distinctUsers, b.distinctUsers, direction, numberCompare);
    case "totalSummaries":
      return compareNullable(a.totalSummaries, b.totalSummaries, direction, numberCompare);
    case "title":
      return compareNullable(a.title, b.title, direction, stringCompare);
    case "channelName":
      return compareNullable(a.channelName, b.channelName, direction, stringCompare);
    case "language":
      return compareNullable(a.language, b.language, direction, stringCompare);
    case "firstSummarizedAt":
      return compareNullable(a.firstSummarizedAt, b.firstSummarizedAt, direction, stringCompare);
    case "lastSummarizedAt":
      return compareNullable(a.lastSummarizedAt, b.lastSummarizedAt, direction, stringCompare);
    case "whisperPct":
      return compareNullable(a.whisperPct, b.whisperPct, direction, numberCompare);
    case "p95ProcessingSeconds":
      return compareNullable(a.p95ProcessingSeconds, b.p95ProcessingSeconds, direction, numberCompare);
    case "durationSeconds":
      return compareNullable(a.durationSeconds, b.durationSeconds, direction, numberCompare);
  }
}

function compareNullable<T>(
  a: T | null,
  b: T | null,
  direction: VideoReportSortDirection,
  compare: (left: T, right: T) => number,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? compare(a, b) : -compare(a, b);
}

const stringCompare = (a: string, b: string) => a.localeCompare(b);
const numberCompare = (a: number, b: number) => a - b;

function computeInsights(
  scope: VideoScope,
  window: TimeWindow | null,
  adminFilterIncomplete: boolean,
): VideoReportInsights {
  if (scope.history.length === 0) {
    return {
      totalUniqueVideos: 0,
      totalSummaries: 0,
      whisperVideoSharePct: 0,
      topChannels: [],
      languageMix: [],
      sourceMix: emptySourceMix(),
      trendingPerDay: window
        ? fillDailySeries(window.start, window.end, new Map())
        : undefined,
      adminFilterIncomplete,
    };
  }

  const videoById = buildVideoMap(scope.videos);
  const summariesByVideo = buildSummaryMap(scope.summaries);
  const channelCounts = new Map<string, Set<string>>();
  const languageCounts = new Map<string, Set<string>>();
  const sourceCounts = new Map<TranscriptSource, number>();
  let whisperVideos = 0;

  for (const videoId of scope.videoIds) {
    const video = videoById.get(videoId);
    const channel = (video?.channel_name as string | null) ?? "(unknown)";
    const language = (video?.language as string | null) ?? "(unknown)";
    const channelVideos = channelCounts.get(channel) ?? new Set<string>();
    channelVideos.add(videoId);
    channelCounts.set(channel, channelVideos);
    const languageVideos = languageCounts.get(language) ?? new Set<string>();
    languageVideos.add(videoId);
    languageCounts.set(language, languageVideos);

    const source = transcriptSourceFor(
      canonicalSummary(summariesByVideo, videoId),
    );
    if (source === "whisper") whisperVideos += 1;
  }

  for (const row of scope.history) {
    const source = transcriptSourceFor(
      canonicalSummary(summariesByVideo, row.video_id),
    );
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  const topChannels = Array.from(channelCounts.entries())
    .map(([channelName, ids]) => ({ channelName, videoCount: ids.size }))
    .sort((a, b) => {
      if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
      return a.channelName.localeCompare(b.channelName);
    })
    .slice(0, 5);
  const languageMix = Array.from(languageCounts.entries())
    .map(([language, ids]) => ({ language, videoCount: ids.size }))
    .sort((a, b) => {
      if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
      return a.language.localeCompare(b.language);
    });

  let trendingPerDay: { day: string; value: number }[] | undefined;
  if (window) {
    const byDay = new Map<string, number>();
    for (const row of scope.history) {
      if (!row.created_at) continue;
      const day = isoDay(new Date(row.created_at));
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    trendingPerDay = fillDailySeries(window.start, window.end, byDay);
  }

  return {
    totalUniqueVideos: scope.videoIds.length,
    totalSummaries: scope.history.length,
    whisperVideoSharePct:
      scope.videoIds.length > 0
        ? Math.round((whisperVideos / scope.videoIds.length) * 100)
        : 0,
    topChannels,
    languageMix,
    sourceMix: TRANSCRIPT_SOURCES.map((source) => ({
      source,
      count: sourceCounts.get(source) ?? 0,
    })),
    trendingPerDay,
    adminFilterIncomplete,
  };
}

function transcriptSourceFor(
  summary: Record<string, unknown> | null,
): TranscriptSource {
  return (summary?.transcript_source ?? "auto_captions") as TranscriptSource;
}

function emptySourceMix(): { source: TranscriptSource; count: number }[] {
  return TRANSCRIPT_SOURCES.map((source) => ({ source, count: 0 }));
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * percentileValue) - 1),
  );
  return sorted[index];
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fillDailySeries(
  start: Date,
  end: Date,
  bucketed: Map<string, number>,
): { day: string; value: number }[] {
  const points: { day: string; value: number }[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = isoDay(cursor);
    points.push({ day, value: bucketed.get(day) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

function addWarning(
  warnings: ReportCompletenessWarning[],
  warning: ReportCompletenessWarning,
): void {
  if (!warnings.some((existing) => existing.code === warning.code)) {
    warnings.push(warning);
  }
}
