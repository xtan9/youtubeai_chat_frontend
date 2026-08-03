import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRANSCRIPT_SOURCES,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";
import { QueryError } from "./errors";
import { listUserAccounts } from "./user-account-directory";

import { WHISPER_FLAG_THRESHOLD } from "./constants";
export { WHISPER_FLAG_THRESHOLD } from "./constants";

// Caps live in `admin-constants.ts` so client components can import the
// runtime values without pulling the `import "server-only"` side-effect
// at the top of this file. Re-export the pair that callers historically
// imported from this module so existing import paths stay stable.
import {
  HISTORY_ROW_CAP,
  VIDEOS_ROW_CAP,
  VIDEOS_PAGE_SIZE_CAP,
} from "./admin-constants";

export { VIDEOS_PAGE_SIZE_CAP };

type DailyPoint = { day: string; value: number };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

function fillDailySeries(
  start: Date,
  end: Date,
  bucketed: Map<string, number>,
): DailyPoint[] {
  const out: DailyPoint[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = isoDay(cursor);
    out.push({ day: key, value: bucketed.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[idx];
}

function p95(values: (number | null | undefined)[]): number | null {
  const filtered = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  return percentile(filtered, 0.95);
}

// Window descriptor used by all KPI queries. Keeping it explicit (vs.
// always defaulting to 30d) makes the intent obvious in callers and
// prevents accidental "compared to itself" deltas.
export interface TimeWindow {
  start: Date;
  end: Date;
}

export function lastNDays(n: number): TimeWindow {
  // end = now (not midnight UTC) so "today" is included up to the moment
  // of the request. daysAgo(n - 1) gives n full days inclusive.
  return { start: daysAgo(n - 1), end: new Date() };
}

// Shared query value types

export type SortDir = "asc" | "desc";

function compareNullable<T>(
  a: T | null,
  b: T | null,
  dir: SortDir,
  cmp: (left: T, right: T) => number,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? cmp(a, b) : -cmp(a, b);
}

const stringCmp = (a: string, b: string) => a.localeCompare(b);
const numCmp = (a: number, b: number) => a - b;

// ─── Videos page types ────────────────────────────────────────────────────

export interface AdminVideoRow {
  videoId: string;
  title: string | null;
  channelName: string | null;
  language: string | null;
  durationSeconds: number | null;
  /** Earliest summaries.created_at observed for this video. */
  firstSummarizedAt: string;
  /** Most recent user_video_history.accessed_at observed. */
  lastSummarizedAt: string;
  /** Distinct user_id in history (admin user_ids excluded by caller). */
  distinctUsers: number;
  /** Count of history rows ("views") for this video. */
  totalSummaries: number;
  sourceMix: { source: TranscriptSource; count: number }[];
  /** Always 0 or 100 today: the canonical summary is picked once per
   * video, so every view shares one source. Modeled as `number` to keep
   * the column sort and a future per-view refetch type-stable. */
  whisperPct: number;
  /** Distinct summaries.model values seen for this video. */
  modelsUsed: string[];
  p95ProcessingSeconds: number | null;
  /** Whether `whisperPct > WHISPER_FLAG_THRESHOLD`. */
  flagged: boolean;
  /** "stale" when no view in the last 30d, else "active". */
  status: "active" | "stale";
}

export interface VideoListResult {
  rows: AdminVideoRow[];
  total: number;
  truncated: boolean;
  page: number;
  pageCount: number;
  /** True when the admin-touched-video pre-fetch hit HISTORY_ROW_CAP and
   * the returned admin-video set is therefore incomplete. The page surfaces
   * this as a banner so an operator knows results may include admin/QA
   * traffic that wasn't filtered out. */
  adminFilterIncomplete: boolean;
}

export type VideoMode = "all_time" | "trending";

export type VideoSortKey =
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

export interface VideoListOptions {
  mode: VideoMode;
  /** Required when mode === "trending"; ignored when mode === "all_time". */
  window?: TimeWindow;
  sort: VideoSortKey;
  dir: SortDir;
  search: string | null;
  language: string | null;
  source: TranscriptSource | null;
  channel: string | null;
  model: string | null;
  flaggedOnly: boolean;
  /** ISO date or null. Compared lexicographically against firstSummarizedAt. */
  firstSummarizedFrom: string | null;
  firstSummarizedTo: string | null;
  page: number;
  pageSize: number;
  /** Drop every video that any of these user IDs has ever touched (all-time,
   * window-independent — a video the admin tested last year shouldn't
   * re-enter trending this month). Stricter than the user-id history filter
   * used by Performance: only administrator views are excluded there,
   * while mixed videos still appear. The videos page uses the
   * stricter video-level filter to keep admin/QA traffic from inflating
   * what otherwise looks like organic catalog growth. */
  excludeAdminUserIds?: string[];
}

export interface VideoInsights {
  totalUniqueVideos: number;
  /** Total views across every video in scope. */
  totalSummaries: number;
  /** Percentage of videos in the current scope whose canonical summary's
   * `transcript_source` is `whisper`. */
  whisperVideoSharePct: number;
  topChannels: { channelName: string; videoCount: number }[];
  languageMix: { language: string; videoCount: number }[];
  /** Source mix counted by view, not by video. */
  sourceMix: { source: TranscriptSource; count: number }[];
  /** Populated only when mode === "trending". */
  trendingPerDay?: DailyPoint[];
  /** See {@link VideoListResult.adminFilterIncomplete}. Same flag, same
   * cause — surfaced separately so callers fetching insights without the
   * full list still get the signal. */
  adminFilterIncomplete: boolean;
}

export interface VideoInsightsOptions {
  mode: VideoMode;
  window?: TimeWindow;
  /** See {@link VideoListOptions.excludeAdminUserIds} — same video-level
   * (not user-level) filter so the insights bar matches the table. */
  excludeAdminUserIds?: string[];
}

export interface AdminUserIdLookup {
  ids: string[];
  /** False when the lookup itself failed or the underlying user-list paginate
   * was truncated. Callers that promise the user "admin activity is filtered"
   * (e.g. /admin/videos) need this to surface a degraded-mode banner: a
   * silent `[]` would otherwise weaken filtering below the pre-PR baseline
   * with no operator signal. KPI pages may safely ignore it. */
  ok: boolean;
}

/**
 * Returns the auth user IDs of all users with
 * `app_metadata.is_admin === true`, plus an `ok` flag distinguishing
 * "no admins configured" from "lookup failed/truncated". Use this when
 * the page's contract depends on the filter actually being applied.
 *
 * Pages through the full User Account Directory (capped at 5000 by default
 * with a warn on truncation). A previous single-page implementation silently
 * dropped administrators past the first 200 rows.
 *
 * Fail-soft: returns ids=[] on error so callers default to "include
 * admins" rather than failing the page; `ok` is the caller's signal.
 */
export async function listAdminUserIdsWithStatus(
  client: SupabaseClient,
): Promise<AdminUserIdLookup> {
  try {
    const { users, truncated } = await listUserAccounts(client);
    if (truncated) {
      console.warn(
        "[admin-queries] listAdminUserIdsWithStatus: User Account Directory truncated — admin set may be incomplete",
      );
    }
    const ids = users.filter((u) => u.isAdministrator).map((u) => u.id);
    return { ids, ok: !truncated };
  } catch (err) {
    console.error("[admin-queries] listAdminUserIdsWithStatus failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { ids: [], ok: false };
  }
}

/**
 * Back-compat shim around {@link listAdminUserIdsWithStatus} for callers
 * that don't surface degraded mode (KPIs, performance stats — those pages
 * pre-date the strict-filter contract).
 */
export async function listAdminUserIds(
  client: SupabaseClient,
): Promise<string[]> {
  return (await listAdminUserIdsWithStatus(client)).ids;
}


// ─── Internals ────────────────────────────────────────────────────────────

// ─── Videos page queries ─────────────────────────────────────────────────

const STALE_VIDEO_DAYS = 30;

interface AdminTouchedVideoLookup {
  videoIds: Set<string>;
  /** True when the lookup hit HISTORY_ROW_CAP — the set is incomplete and
   * some admin-touched videos may slip through the filter downstream.
   * Surfaced to the caller via VideoListResult/VideoInsights so the page
   * can render a banner; logging alone is operator-invisible. */
  truncated: boolean;
}

/** Set of video_ids that any of the given user IDs has *ever* touched in
 * `user_video_history`. Always all-time — windowing this would let an
 * admin's stale test from outside the trending window re-enter the list.
 *
 * Throws on query error rather than fail-soft (unlike `listAdminUserIds`
 * elsewhere in this file): a silent fail
 * here would degrade the videos page to *less* filtering than pre-PR,
 * which is exactly the failure mode the strict-filter contract is meant
 * to prevent. The caller should let the page-level error boundary render.
 *
 * Returns an empty Set when no admin IDs are provided (or all are blank),
 * so callers can skip the round-trip. */
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
    throw new QueryError("listAdminTouchedVideoIds", error.message);
  }
  const truncated = !!data && data.length === HISTORY_ROW_CAP;
  if (truncated) {
    console.warn(
      "[admin-queries] listAdminTouchedVideoIds: cap hit — admin-touched video set is incomplete; some admin/QA traffic may render to the page",
      {
        cap: HISTORY_ROW_CAP,
        adminUserIds: cleaned,
        returnedRows: data?.length ?? 0,
      },
    );
  }
  const videoIds = new Set<string>();
  if (data && data.length > 0) {
    for (const row of data as Array<{ video_id: string }>) {
      videoIds.add(row.video_id);
    }
  }
  return { videoIds, truncated };
}

export async function listVideosWithStats(
  client: SupabaseClient,
  opts: VideoListOptions,
): Promise<VideoListResult> {
  const pageSize = Math.min(Math.max(opts.pageSize, 1), VIDEOS_PAGE_SIZE_CAP);
  const page = Math.max(1, opts.page);
  const exclude = opts.excludeAdminUserIds ?? [];

  // 1. Resolve admin-touched video set first — see
  //    VideoListOptions.excludeAdminUserIds for why video-level not user-level.
  const adminLookup = await listAdminTouchedVideoIds(client, exclude);

  // 2. Fetch history rows (windowed in trending mode, all-time otherwise).
  //    Order by accessed_at desc so cap-hit truncation deterministically
  //    drops the oldest tail (rather than a non-deterministic planner
  //    pick). No DB-side user_id filter — admin-touched video_id sets
  //    can run to thousands of UUIDs and would blow past PostgREST's URL
  //    length limit if expressed as `not.in()`; we drop them in JS instead.
  const window =
    opts.mode === "trending" ? (opts.window ?? lastNDays(30)) : null;
  let historyQuery = client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at");
  if (window) {
    historyQuery = historyQuery
      .gte("accessed_at", window.start.toISOString())
      .lte("accessed_at", window.end.toISOString());
  }
  const { data: rawHistory, error: hErr } = await historyQuery
    .order("accessed_at", { ascending: false })
    .limit(HISTORY_ROW_CAP);
  if (hErr) throw new QueryError("listVideosWithStats:history", hErr.message);

  const history =
    adminLookup.videoIds.size > 0
      ? (rawHistory ?? []).filter(
          (h) =>
            !adminLookup.videoIds.has(
              (h as { video_id: string }).video_id,
            ),
        )
      : (rawHistory ?? []);

  if (history.length === 0) {
    return {
      rows: [],
      total: 0,
      truncated: false,
      page,
      pageCount: 1,
      adminFilterIncomplete: adminLookup.truncated,
    };
  }

  // 2. Cap distinct video set + fetch metadata.
  const videoIds = Array.from(
    new Set(
      (history as Array<{ video_id: string }>).map((h) => h.video_id),
    ),
  );
  const truncated = videoIds.length >= VIDEOS_ROW_CAP;
  const cappedIds = truncated ? videoIds.slice(0, VIDEOS_ROW_CAP) : videoIds;
  if (truncated) {
    console.warn("[admin-queries] listVideosWithStats: video cap hit", {
      cap: VIDEOS_ROW_CAP,
    });
  }

  const [videosRes, summariesRes] = await Promise.all([
    client
      .from("videos")
      .select("id, title, channel_name, language, duration_seconds:duration")
      .in("id", cappedIds),
    client
      .from("summaries")
      .select(
        "video_id, transcript_source, model, processing_time_seconds, created_at",
      )
      .in("video_id", cappedIds),
  ]);
  if (videosRes.error) {
    throw new QueryError("listVideosWithStats:videos", videosRes.error.message);
  }
  if (summariesRes.error) {
    throw new QueryError(
      "listVideosWithStats:summaries",
      summariesRes.error.message,
    );
  }

  // 3. Aggregate per video.
  const cappedIdSet = new Set(cappedIds);
  const cappedHistory = (
    history as Array<{ user_id: string; video_id: string; created_at: string }>
  ).filter((h) => cappedIdSet.has(h.video_id));
  const rows = aggregateVideoRows(
    cappedHistory,
    (videosRes.data ?? []) as Array<Record<string, unknown>>,
    (summariesRes.data ?? []) as Array<Record<string, unknown>>,
  );

  // 4. Filter, sort, paginate.
  const filtered = filterVideoRows(rows, opts);
  const sorted = sortVideoRows(filtered, opts.sort, opts.dir);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);

  return {
    rows: slice,
    total,
    truncated,
    page,
    pageCount,
    adminFilterIncomplete: adminLookup.truncated,
  };
}

/**
 * Returns the single summary row for a video (or null when none).
 * Production has at most one summary per video — the `enable_thinking`
 * column and its UNIQUE constraint were dropped by migration
 * 20260423000000_drop_thinking_columns and dedup collapsed historical
 * duplicates. The function is kept (rather than inlined) so callers
 * read self-documentingly and so future work can re-introduce a
 * preference rule in one place if the schema ever grows variants again.
 */
function pickCanonicalSummary(
  summaries: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  return summaries[0] ?? null;
}

function aggregateVideoRows(
  history: Array<{ user_id: string; video_id: string; created_at: string }>,
  videos: Array<Record<string, unknown>>,
  summaries: Array<Record<string, unknown>>,
): AdminVideoRow[] {
  const videoById = new Map<string, Record<string, unknown>>();
  for (const v of videos) videoById.set(String(v.id), v);

  const summariesByVideo = new Map<string, Array<Record<string, unknown>>>();
  for (const s of summaries) {
    const vid = String(s.video_id);
    const arr = summariesByVideo.get(vid) ?? [];
    arr.push(s);
    summariesByVideo.set(vid, arr);
  }

  type Bucket = {
    users: Set<string>;
    views: number;
    lastSeen: string;
    sourceCounts: Map<TranscriptSource, number>;
    whisperViews: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const h of history) {
    const summariesForVideo = summariesByVideo.get(h.video_id) ?? [];
    const canonical = pickCanonicalSummary(summariesForVideo);
    const source = (canonical?.transcript_source ??
      "auto_captions") as TranscriptSource;
    const bucket = buckets.get(h.video_id) ?? {
      users: new Set<string>(),
      views: 0,
      lastSeen: h.created_at,
      sourceCounts: new Map<TranscriptSource, number>(),
      whisperViews: 0,
    };
    bucket.users.add(h.user_id);
    bucket.views += 1;
    bucket.sourceCounts.set(
      source,
      (bucket.sourceCounts.get(source) ?? 0) + 1,
    );
    if (source === "whisper") bucket.whisperViews += 1;
    if (h.created_at > bucket.lastSeen) bucket.lastSeen = h.created_at;
    buckets.set(h.video_id, bucket);
  }

  const now = Date.now();
  const staleCutoff = now - STALE_VIDEO_DAYS * 86_400_000;

  const out: AdminVideoRow[] = [];
  for (const [videoId, bucket] of buckets) {
    const video = videoById.get(videoId);
    const allSummaries = summariesByVideo.get(videoId) ?? [];
    const firstSummarizedAt =
      allSummaries
        .map((s) => String(s.created_at))
        .filter((s) => s.length > 0)
        .sort()[0] ?? bucket.lastSeen;
    const modelsUsed = Array.from(
      new Set(
        allSummaries
          .map((s) => (typeof s.model === "string" ? s.model : null))
          .filter((m): m is string => m !== null),
      ),
    );
    const sourceMix: { source: TranscriptSource; count: number }[] = [];
    for (const [source, count] of bucket.sourceCounts) {
      sourceMix.push({ source, count });
    }
    const whisperPct =
      bucket.views > 0
        ? Math.round((bucket.whisperViews / bucket.views) * 100)
        : 0;
    const latencies = allSummaries
      .map((s) =>
        typeof s.processing_time_seconds === "number"
          ? (s.processing_time_seconds as number)
          : null,
      )
      .filter((n): n is number => n !== null);
    const lastSeenMs = new Date(bucket.lastSeen).getTime();
    out.push({
      videoId,
      title: (video?.title as string | null) ?? null,
      channelName: (video?.channel_name as string | null) ?? null,
      language: (video?.language as string | null) ?? null,
      durationSeconds:
        typeof video?.duration_seconds === "number"
          ? (video.duration_seconds as number)
          : null,
      firstSummarizedAt,
      lastSummarizedAt: bucket.lastSeen,
      distinctUsers: bucket.users.size,
      totalSummaries: bucket.views,
      sourceMix,
      whisperPct,
      modelsUsed,
      p95ProcessingSeconds: p95(latencies),
      flagged: bucket.views > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
      status: lastSeenMs >= staleCutoff ? "active" : "stale",
    });
  }
  return out;
}

function filterVideoRows(
  rows: AdminVideoRow[],
  opts: VideoListOptions,
): AdminVideoRow[] {
  return rows.filter((r) => {
    if (opts.search) {
      const q = opts.search.toLowerCase();
      const inTitle = r.title?.toLowerCase().includes(q) ?? false;
      const inChannel = r.channelName?.toLowerCase().includes(q) ?? false;
      if (!inTitle && !inChannel) return false;
    }
    if (opts.language && r.language !== opts.language) return false;
    if (opts.source && !r.sourceMix.some((m) => m.source === opts.source)) {
      return false;
    }
    if (opts.channel && r.channelName !== opts.channel) return false;
    if (opts.model && !r.modelsUsed.includes(opts.model)) return false;
    if (opts.flaggedOnly && !r.flagged) return false;
    // `firstSummarizedAt` is a full ISO timestamp; `firstSummarizedFrom`
    // / `firstSummarizedTo` are date-only strings ("YYYY-MM-DD") from the
    // URL. Lex-comparing them directly silently filters out the entire
    // end day (e.g. "2026-04-30T08:..." > "2026-04-30"). Compare on the
    // day prefix to keep the inclusive-end-day contract.
    const firstSummarizedDay = r.firstSummarizedAt.slice(0, 10);
    if (
      opts.firstSummarizedFrom &&
      firstSummarizedDay < opts.firstSummarizedFrom
    ) {
      return false;
    }
    if (opts.firstSummarizedTo && firstSummarizedDay > opts.firstSummarizedTo) {
      return false;
    }
    return true;
  });
}

function sortVideoRows(
  rows: AdminVideoRow[],
  sort: VideoSortKey,
  dir: SortDir,
): AdminVideoRow[] {
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    const primary = primaryVideoCompare(a, b, sort, dir);
    if (primary !== 0) return primary;
    return a.videoId.localeCompare(b.videoId);
  });
  return sorted;
}

function primaryVideoCompare(
  a: AdminVideoRow,
  b: AdminVideoRow,
  sort: VideoSortKey,
  dir: SortDir,
): number {
  switch (sort) {
    case "distinctUsers":
      return compareNullable(a.distinctUsers, b.distinctUsers, dir, numCmp);
    case "totalSummaries":
      return compareNullable(a.totalSummaries, b.totalSummaries, dir, numCmp);
    case "title":
      return compareNullable(a.title, b.title, dir, stringCmp);
    case "channelName":
      return compareNullable(a.channelName, b.channelName, dir, stringCmp);
    case "language":
      return compareNullable(a.language, b.language, dir, stringCmp);
    case "firstSummarizedAt":
      return compareNullable(
        a.firstSummarizedAt,
        b.firstSummarizedAt,
        dir,
        stringCmp,
      );
    case "lastSummarizedAt":
      return compareNullable(
        a.lastSummarizedAt,
        b.lastSummarizedAt,
        dir,
        stringCmp,
      );
    case "whisperPct":
      return compareNullable(a.whisperPct, b.whisperPct, dir, numCmp);
    case "p95ProcessingSeconds":
      return compareNullable(
        a.p95ProcessingSeconds,
        b.p95ProcessingSeconds,
        dir,
        numCmp,
      );
    case "durationSeconds":
      return compareNullable(
        a.durationSeconds,
        b.durationSeconds,
        dir,
        numCmp,
      );
  }
}

export async function getVideoInsights(
  client: SupabaseClient,
  opts: VideoInsightsOptions,
): Promise<VideoInsights> {
  const window =
    opts.mode === "trending" ? (opts.window ?? lastNDays(30)) : null;
  const exclude = opts.excludeAdminUserIds ?? [];

  // Resolve the admin-touched video set first so the insights bar drops
  // the same videos that listVideosWithStats drops — keeps the page header
  // ("N videos summarized") consistent with the table below it.
  const adminLookup = await listAdminTouchedVideoIds(client, exclude);

  let historyQuery = client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at");
  if (window) {
    historyQuery = historyQuery
      .gte("accessed_at", window.start.toISOString())
      .lte("accessed_at", window.end.toISOString());
  }
  // Order desc so cap-hit truncation is reproducible (same rationale as
  // listVideosWithStats — avoids non-deterministic planner picks).
  const { data: rawHistory, error: hErr } = await historyQuery
    .order("accessed_at", { ascending: false })
    .limit(HISTORY_ROW_CAP);
  if (hErr) throw new QueryError("getVideoInsights:history", hErr.message);

  const history =
    adminLookup.videoIds.size > 0
      ? (rawHistory ?? []).filter(
          (h) =>
            !adminLookup.videoIds.has(
              (h as { video_id: string }).video_id,
            ),
        )
      : (rawHistory ?? []);

  if (history.length === 0) {
    return {
      totalUniqueVideos: 0,
      totalSummaries: 0,
      whisperVideoSharePct: 0,
      topChannels: [],
      languageMix: [],
      sourceMix: TRANSCRIPT_SOURCES.map((s) => ({ source: s, count: 0 })),
      trendingPerDay: window
        ? fillDailySeries(window.start, window.end, new Map())
        : undefined,
      adminFilterIncomplete: adminLookup.truncated,
    };
  }

  const typedHistory = history as Array<{
    user_id: string;
    video_id: string;
    created_at: string;
  }>;
  const videoIds = Array.from(new Set(typedHistory.map((h) => h.video_id)));
  const [videosRes, summariesRes] = await Promise.all([
    client
      .from("videos")
      .select("id, title, channel_name, language")
      .in("id", videoIds),
    client
      .from("summaries")
      .select("video_id, transcript_source")
      .in("video_id", videoIds),
  ]);
  if (videosRes.error) {
    throw new QueryError("getVideoInsights:videos", videosRes.error.message);
  }
  if (summariesRes.error) {
    throw new QueryError(
      "getVideoInsights:summaries",
      summariesRes.error.message,
    );
  }

  const videoById = new Map<string, Record<string, unknown>>();
  for (const v of (videosRes.data ?? []) as Array<Record<string, unknown>>) {
    videoById.set(String(v.id), v);
  }

  const summariesByVideo = new Map<string, Array<Record<string, unknown>>>();
  for (const s of (summariesRes.data ?? []) as Array<
    Record<string, unknown>
  >) {
    const vid = String(s.video_id);
    const arr = summariesByVideo.get(vid) ?? [];
    arr.push(s);
    summariesByVideo.set(vid, arr);
  }

  const channelCounts = new Map<string, Set<string>>(); // channel -> distinct video ids
  const langCounts = new Map<string, Set<string>>();
  const sourceCounts = new Map<TranscriptSource, number>();
  let whisperVideos = 0;
  for (const vid of videoIds) {
    const video = videoById.get(vid);
    const channel = (video?.channel_name as string | null) ?? "(unknown)";
    const language = (video?.language as string | null) ?? "(unknown)";
    const cset = channelCounts.get(channel) ?? new Set<string>();
    cset.add(vid);
    channelCounts.set(channel, cset);
    const lset = langCounts.get(language) ?? new Set<string>();
    lset.add(vid);
    langCounts.set(language, lset);
    const canonical = pickCanonicalSummary(summariesByVideo.get(vid) ?? []);
    const source = (canonical?.transcript_source ??
      "auto_captions") as TranscriptSource;
    if (source === "whisper") whisperVideos++;
  }
  // sourceCounts is by VIEW, not by video — count history rows.
  for (const h of typedHistory) {
    const canonical = pickCanonicalSummary(
      summariesByVideo.get(h.video_id) ?? [],
    );
    const source = (canonical?.transcript_source ??
      "auto_captions") as TranscriptSource;
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
  }

  const topChannels = Array.from(channelCounts.entries())
    .map(([channelName, ids]) => ({ channelName, videoCount: ids.size }))
    .sort((a, b) => {
      if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
      return a.channelName.localeCompare(b.channelName);
    })
    .slice(0, 5);

  const languageMix = Array.from(langCounts.entries())
    .map(([language, ids]) => ({ language, videoCount: ids.size }))
    .sort((a, b) => {
      if (b.videoCount !== a.videoCount) return b.videoCount - a.videoCount;
      return a.language.localeCompare(b.language);
    });

  const sourceMix = TRANSCRIPT_SOURCES.map((source) => ({
    source,
    count: sourceCounts.get(source) ?? 0,
  }));

  let trendingPerDay: DailyPoint[] | undefined;
  if (window) {
    const byDay = new Map<string, number>();
    for (const h of typedHistory) {
      if (!h.created_at) continue;
      const day = isoDay(new Date(h.created_at));
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    trendingPerDay = fillDailySeries(window.start, window.end, byDay);
  }

  return {
    totalUniqueVideos: videoIds.length,
    totalSummaries: typedHistory.length,
    whisperVideoSharePct:
      videoIds.length > 0
        ? Math.round((whisperVideos / videoIds.length) * 100)
        : 0,
    topChannels,
    languageMix,
    sourceMix,
    trendingPerDay,
    adminFilterIncomplete: adminLookup.truncated,
  };
}
