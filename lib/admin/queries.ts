import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRANSCRIPT_SOURCES,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";
import { mapAuditRow, type AuditRow } from "./audit-row";
import { QueryError } from "./errors";
import { listUserAccounts, type UserAccount } from "./user-account-directory";

import { WHISPER_FLAG_THRESHOLD } from "./constants";
export { WHISPER_FLAG_THRESHOLD } from "./constants";

// Caps live in `admin-constants.ts` so client components can import the
// runtime values without pulling the `import "server-only"` side-effect
// at the top of this file.
import {
  SUMMARIES_ROW_CAP,
  HISTORY_ROW_CAP,
  USERS_PAGE_SIZE_CAP,
} from "./admin-constants";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
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

function p50(values: (number | null | undefined)[]): number | null {
  const filtered = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  return percentile(filtered, 0.5);
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

// ─── Audit log ────────────────────────────────────────────────────────────

// Per-user audit history remains a legacy query consumed by the User Accounts
// surface; the page-facing Audit Report lives in `audit-report.ts`.

const PER_USER_AUDIT_DEFAULT_LIMIT = 10;
const PER_USER_AUDIT_LIMIT_CAP = 50;

export async function getUserAuditEvents(
  client: SupabaseClient,
  userId: string,
  limit: number = PER_USER_AUDIT_DEFAULT_LIMIT,
): Promise<AuditRow[]> {
  const cap = Math.min(Math.max(limit, 1), PER_USER_AUDIT_LIMIT_CAP);
  // admin_audit_log uses two row shapes for "events about a user":
  //   1. view_transcript (and similar content-revealing actions): the row's
  //      resource_type is "summary" and resource_id is the summary UUID; the
  //      user being viewed is in metadata.viewed_user_id.
  //   2. user-targeted actions (suspend_user / restore_user, etc.): the row's
  //      resource_type is "user" and resource_id is the user UUID directly.
  // Match both shapes so the per-user drilldown surfaces all events that
  // reference the user, regardless of which schema the action used.
  const { data, error } = await client
    .from("admin_audit_log")
    .select(
      "id, created_at, admin_id, admin_email, action, resource_type, resource_id, metadata",
    )
    .or(
      `and(resource_type.eq.user,resource_id.eq.${userId}),metadata->>viewed_user_id.eq.${userId}`,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(cap);
  if (error) {
    console.error("[admin-queries] getUserAuditEvents failed", {
      userId,
      message: error.message,
    });
    return [];
  }
  return (data ?? []).map(mapAuditRow);
}

// ─── Users + per-user stats ───────────────────────────────────────────────

export type UserStatus =
  | "active"
  | "anonymous"
  | "banned"
  | "deleted"
  | "unverified";

export type SortKey =
  | "email"
  | "providers"
  | "status"
  | "emailVerified"
  | "createdAt"
  | "lastSignIn"
  | "lastActivity"
  | "summaries"
  | "whisperPct";

export type SortDir = "asc" | "desc";

export type UsersTab =
  | "exclude_anon"
  | "anon_only"
  | "active"
  | "flagged"
  | "all";

export interface AdminUserRow {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  providers: string[];
  status: UserStatus;
  createdAt: string;
  lastSignIn: string | null;
  lastActivity: string | null;
  summaries: number;
  whisper: number;
  whisperPct: number;
  flagged: boolean;
  isAnonymous: boolean;
  isSsoUser: boolean;
  bannedUntil: string | null;
  deletedAt: string | null;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
}

export function filterUsers(
  rows: AdminUserRow[],
  tab: UsersTab,
  search: string | null,
): AdminUserRow[] {
  let out = rows;
  switch (tab) {
    case "exclude_anon":
      out = out.filter((r) => !r.isAnonymous);
      break;
    case "anon_only":
      out = out.filter((r) => r.isAnonymous);
      break;
    case "active":
      out = out.filter((r) => !r.isAnonymous && r.summaries > 0);
      break;
    case "flagged":
      out = out.filter((r) => !r.isAnonymous && r.flagged);
      break;
    case "all":
      break;
  }
  const q = search?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) =>
        (r.email?.toLowerCase().includes(q) ?? false) ||
        r.userId.toLowerCase().includes(q),
    );
  }
  return out;
}

function compareNullable<T>(
  a: T | null,
  b: T | null,
  dir: SortDir,
  cmp: (a: T, b: T) => number,
): number {
  // Null-last regardless of direction.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? cmp(a, b) : -cmp(a, b);
}

const stringCmp = (a: string, b: string) => a.localeCompare(b);
const numCmp = (a: number, b: number) => a - b;

export function sortUsers(
  rows: AdminUserRow[],
  sort: SortKey,
  dir: SortDir,
): AdminUserRow[] {
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    const primary = primaryCompare(a, b, sort, dir);
    if (primary !== 0) return primary;
    // Stable secondary tie-break: ascending userId, regardless of dir.
    return a.userId.localeCompare(b.userId);
  });
  return sorted;
}

function primaryCompare(
  a: AdminUserRow,
  b: AdminUserRow,
  sort: SortKey,
  dir: SortDir,
): number {
  switch (sort) {
    case "email":
      return compareNullable(a.email, b.email, dir, stringCmp);
    case "providers": {
      const av = a.providers.join(",") || null;
      const bv = b.providers.join(",") || null;
      return compareNullable(av, bv, dir, stringCmp);
    }
    case "status":
      return compareNullable(a.status, b.status, dir, stringCmp);
    case "emailVerified":
      return compareNullable(
        a.emailVerified ? 1 : 0,
        b.emailVerified ? 1 : 0,
        dir,
        numCmp,
      );
    case "createdAt":
      return compareNullable(a.createdAt, b.createdAt, dir, stringCmp);
    case "lastSignIn":
      return compareNullable(a.lastSignIn, b.lastSignIn, dir, stringCmp);
    case "lastActivity":
      return compareNullable(a.lastActivity, b.lastActivity, dir, stringCmp);
    case "summaries":
      return compareNullable(a.summaries, b.summaries, dir, numCmp);
    case "whisperPct":
      return compareNullable(a.whisperPct, b.whisperPct, dir, numCmp);
  }
}

export interface UserListSortFilterOptions {
  sort: SortKey;
  dir: SortDir;
  tab: UsersTab;
  search: string | null;
  page: number;
  pageSize: number;
  /** Aggregate window for the per-row stats. Defaults to last 30 days. */
  window?: TimeWindow;
  /** Cap on raw users pulled from auth.admin.listUsers. */
  rowCap?: number;
}

export interface UserListResult {
  rows: AdminUserRow[];
  total: number;
  truncated: boolean;
  page: number;
  pageCount: number;
}

export async function listUsersWithStatsAndSort(
  client: SupabaseClient,
  opts: UserListSortFilterOptions,
): Promise<UserListResult> {
  const pageSize = Math.min(Math.max(opts.pageSize, 1), USERS_PAGE_SIZE_CAP);
  const page = Math.max(1, opts.page);
  const window = opts.window ?? lastNDays(30);

  const { users: raw, truncated } = await listUserAccounts(client, {
    rowCap: opts.rowCap,
  });

  // Pre-filter on stats-independent fields (cheap path) so we only
  // aggregate history for the rows we actually need stats on.
  const noStatsRows: AdminUserRow[] = raw.map((u) =>
    toAdminUserRow(u, undefined),
  );

  // For tabs whose predicate uses stat-derived fields (active / flagged),
  // we need stats before filtering. For the other tabs (exclude_anon /
  // anon_only / all), we can filter first and aggregate only that subset.
  const requiresStatsFirst =
    opts.tab === "active" || opts.tab === "flagged";

  const preFiltered = requiresStatsFirst
    ? noStatsRows
    : filterUsers(noStatsRows, opts.tab, opts.search);

  const targetIds = preFiltered.map((r) => r.userId);
  let stats: Map<string, UserActivity>;
  try {
    stats = targetIds.length
      ? await aggregateUserActivity(client, targetIds, window)
      : new Map<string, UserActivity>();
  } catch (err) {
    console.error(
      "[admin-queries] aggregateUserActivity failed; rendering users without stats",
      {
        message: err instanceof Error ? err.message : String(err),
        userCount: targetIds.length,
      },
    );
    stats = new Map<string, UserActivity>();
  }

  const withStats: AdminUserRow[] = preFiltered.map((r) => {
    const stat = stats.get(r.userId);
    if (!stat) return r;
    const summaries = stat.summaries;
    const whisper = stat.whisper;
    const whisperPct =
      summaries > 0 ? Math.round((whisper / summaries) * 100) : 0;
    return {
      ...r,
      summaries,
      whisper,
      whisperPct,
      lastActivity: stat.lastSeen ?? r.lastActivity,
      flagged: summaries > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
    };
  });

  // For active/flagged tabs the filter still needs to run AFTER stats,
  // including any search term.
  const fullyFiltered = requiresStatsFirst
    ? filterUsers(withStats, opts.tab, opts.search)
    : opts.search
      ? filterUsers(withStats, "all", opts.search)
      : withStats;

  const sorted = sortUsers(fullyFiltered, opts.sort, opts.dir);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);

  return { rows: slice, total, truncated, page, pageCount };
}

function toAdminUserRow(
  u: UserAccount,
  stat: UserActivity | undefined,
): AdminUserRow {
  const summaries = stat?.summaries ?? 0;
  const whisper = stat?.whisper ?? 0;
  const whisperPct =
    summaries > 0 ? Math.round((whisper / summaries) * 100) : 0;
  let isBanned = false;
  if (u.bannedUntil) {
    const t = new Date(u.bannedUntil).getTime();
    if (Number.isNaN(t)) {
      console.error("[admin-queries] toAdminUserRow: invalid banned_until value", {
        userId: u.id,
        bannedUntil: u.bannedUntil,
      });
    } else if (t > Date.now()) {
      isBanned = true;
    }
  }
  const isDeleted = !!u.deletedAt;
  const emailVerified = !!u.emailConfirmedAt;
  const status: UserStatus = isDeleted
    ? "deleted"
    : isBanned
      ? "banned"
      : u.isAnonymous
        ? "anonymous"
        : emailVerified
          ? "active"
          : "unverified";

  return {
    userId: u.id,
    email: u.email ?? null,
    emailVerified,
    providers: u.providers,
    status,
    createdAt: u.createdAt,
    lastSignIn: u.lastSignInAt,
    lastActivity: stat?.lastSeen ?? null,
    summaries,
    whisper,
    whisperPct,
    flagged: summaries > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
    isAnonymous: u.isAnonymous,
    isSsoUser: u.isSsoUser,
    bannedUntil: u.bannedUntil,
    deletedAt: u.deletedAt,
    appMetadata: u.appMetadata,
    userMetadata: u.userMetadata,
  };
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


interface UserActivity {
  summaries: number;
  whisper: number;
  p95Seconds: number | null;
  lastSeen: string | null;
}

async function aggregateUserActivity(
  client: SupabaseClient,
  userIds: string[],
  window: TimeWindow,
): Promise<Map<string, UserActivity>> {
  // Pull every history row for these users in window, then join the
  // referenced summaries to compute whisper share + p95 latency.
  // user_video_history's timestamp column is `accessed_at` in production
  // (the cache_schema migration's CREATE TABLE was skipped by IF NOT EXISTS
  // — see lib/services/user-history.ts comment). PostgREST `created_at:
  // accessed_at` aliases it on read so downstream code keeps using the
  // same field name across tables.
  const { data: history, error: hErr } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .in("user_id", userIds)
    .gte("accessed_at", window.start.toISOString())
    .lte("accessed_at", window.end.toISOString());
  if (hErr) throw new QueryError("aggregateUserActivity:history", hErr.message);

  const result = new Map<string, UserActivity>();
  if (!history || history.length === 0) return result;

  const videoIds = Array.from(new Set(history.map((h) => h.video_id as string)));
  const { data: summaries, error: sErr } = await client
    .from("summaries")
    .select("video_id, transcript_source, processing_time_seconds")
    .in("video_id", videoIds);
  if (sErr) throw new QueryError("aggregateUserActivity:summaries", sErr.message);

  const summaryByVideo = new Map<
    string,
    { source: string; processing: number | null }
  >();
  for (const s of summaries ?? []) {
    if (!summaryByVideo.has(s.video_id as string)) {
      summaryByVideo.set(s.video_id as string, {
        source: String(s.transcript_source),
        processing:
          typeof s.processing_time_seconds === "number"
            ? s.processing_time_seconds
            : null,
      });
    }
  }

  const perUser = new Map<
    string,
    { whisper: number; total: number; latencies: number[]; lastSeen: string }
  >();
  for (const h of history) {
    const userId = h.user_id as string;
    const videoId = h.video_id as string;
    const createdAt = h.created_at as string;
    const summary = summaryByVideo.get(videoId);
    const bucket = perUser.get(userId) ?? {
      whisper: 0,
      total: 0,
      latencies: [],
      lastSeen: createdAt,
    };
    bucket.total += 1;
    if (summary?.source === "whisper") bucket.whisper += 1;
    if (summary?.processing != null) bucket.latencies.push(summary.processing);
    if (createdAt > bucket.lastSeen) bucket.lastSeen = createdAt;
    perUser.set(userId, bucket);
  }

  for (const [userId, bucket] of perUser) {
    result.set(userId, {
      summaries: bucket.total,
      whisper: bucket.whisper,
      p95Seconds: p95(bucket.latencies),
      lastSeen: bucket.lastSeen,
    });
  }

  return result;
}

// ─── Per-user recent summaries (drill-down) ───────────────────────────────

export interface UserSummaryRow {
  videoId: string;
  videoTitle: string | null;
  videoChannel: string | null;
  language: string | null;
  source: TranscriptSource;
  model: string | null;
  processingTimeSeconds: number | null;
  pulledAt: string;
  summaryId: string;
}

export async function getUserSummaries(
  client: SupabaseClient,
  userId: string,
  limit = 10,
): Promise<UserSummaryRow[]> {
  const cap = Math.min(Math.max(limit, 1), 100);
  // Two-query approach instead of a nested PostgREST select. The earlier
  // single-call form aliased the `videos` relationship twice (once for
  // metadata, once as a parent for `summaries`) which PostgREST rejects.
  // Splitting into history → videos+summaries is also clearer and lets us
  // pick the canonical summary deterministically.
  // user_video_history's timestamp column is `accessed_at` on prod
  // (cache_schema migration was a no-op due to IF NOT EXISTS — same
  // drift pattern as videos.youtube_url). Alias on read so the rest of
  // this function keeps the canonical `created_at` shape.
  const { data: history, error: histErr } = await client
    .from("user_video_history")
    .select("video_id, created_at:accessed_at")
    .eq("user_id", userId)
    .order("accessed_at", { ascending: false })
    .limit(cap);
  if (histErr) throw new QueryError("getUserSummaries:history", histErr.message);

  const videoIds = Array.from(
    new Set(((history ?? []) as { video_id: string }[]).map((h) => h.video_id)),
  );
  if (videoIds.length === 0) return [];

  const [videosRes, summariesRes] = await Promise.all([
    client
      .from("videos")
      .select("id, title, channel_name, language")
      .in("id", videoIds),
    client
      .from("summaries")
      .select(
        "id, video_id, transcript_source, model, processing_time_seconds",
      )
      .in("video_id", videoIds),
  ]);
  if (videosRes.error) {
    throw new QueryError("getUserSummaries:videos", videosRes.error.message);
  }
  if (summariesRes.error) {
    throw new QueryError("getUserSummaries:summaries", summariesRes.error.message);
  }

  const videoById = new Map<string, Record<string, unknown>>();
  for (const v of (videosRes.data ?? []) as Record<string, unknown>[]) {
    videoById.set(String(v.id), v);
  }

  // Production schema (per migration 20260423000000_drop_thinking_columns)
  // has at most one summary row per video — the enable_thinking column was
  // dropped along with its UNIQUE constraint, and dedup collapsed duplicate
  // rows. First-seen wins.
  const summaryByVideo = new Map<string, Record<string, unknown>>();
  for (const s of (summariesRes.data ?? []) as Record<string, unknown>[]) {
    const vid = String(s.video_id);
    if (!summaryByVideo.has(vid)) summaryByVideo.set(vid, s);
  }

  const rows: UserSummaryRow[] = [];
  for (const h of (history ?? []) as {
    video_id: string;
    created_at: string;
  }[]) {
    const video = videoById.get(h.video_id);
    const summary = summaryByVideo.get(h.video_id);
    const rawSource = (summary?.transcript_source ?? "auto_captions") as string;
    if (!TRANSCRIPT_SOURCES.includes(rawSource as TranscriptSource)) {
      console.warn("[admin-queries] unknown transcript_source dropped", {
        videoId: h.video_id,
        rawSource,
      });
      continue;
    }
    const source = rawSource as TranscriptSource;
    rows.push({
      videoId: h.video_id,
      videoTitle: (video?.title as string | null) ?? null,
      videoChannel: (video?.channel_name as string | null) ?? null,
      language: (video?.language as string | null) ?? null,
      source,
      model: (summary?.model as string | null) ?? null,
      processingTimeSeconds:
        typeof summary?.processing_time_seconds === "number"
          ? (summary.processing_time_seconds as number)
          : null,
      pulledAt: h.created_at,
      summaryId: summary ? String(summary.id) : "",
    });
  }
  return rows;
}

// ─── Shared KPI options ──────────────────────────────────────────────────

export interface KpiOptions {
  /** When non-empty, history aggregations exclude rows where user_id is
   * in this list. Used to drop admin activity from KPIs. */
  excludeAdminUserIds?: string[];
}

// ─── Performance stats ────────────────────────────────────────────────────

export interface PerformanceStats {
  window: TimeWindow;
  p50Seconds: number | null;
  p95Seconds: number | null;
  transcribeP95Seconds: number | null;
  summarizeP95Seconds: number | null;
  prev: {
    p50Seconds: number | null;
    p95Seconds: number | null;
    transcribeP95Seconds: number | null;
    summarizeP95Seconds: number | null;
  };
  /** Daily buckets keyed by UTC day (YYYY-MM-DD). */
  latencyByBucket: { day: string; p95Seconds: number | null }[];
}

export async function getPerformanceStats(
  client: SupabaseClient,
  window: TimeWindow = lastNDays(30),
  opts: KpiOptions = {},
): Promise<PerformanceStats> {
  const exclude = opts.excludeAdminUserIds ?? [];
  const days =
    Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000) + 1;
  const prevWindow: TimeWindow = {
    start: new Date(window.start.getTime() - days * 86_400_000),
    end: new Date(window.start.getTime() - 86_400_000),
  };

  const wantFilter = exclude.length > 0;
  const [current, previous, history, prevHistory] = await Promise.all([
    fetchSummariesIn(client, window),
    fetchSummariesIn(client, prevWindow),
    wantFilter
      ? fetchHistoryForExclusion(client, window, exclude)
      : Promise.resolve([] as HistoryRow[]),
    wantFilter
      ? fetchHistoryForExclusion(client, prevWindow, exclude)
      : Promise.resolve([] as HistoryRow[]),
  ]);

  // When excluding admins, intersect latency samples with admin-filtered
  // history. Empty real-user history means null percentiles — the toggle
  // promises filtering, not fallback to all-activity numbers.
  const filteredCurrent = restrictSummariesToHistory(current, history, wantFilter);
  const filteredPrev = restrictSummariesToHistory(previous, prevHistory, wantFilter);

  const byDay = new Map<string, number[]>();
  for (const s of filteredCurrent) {
    if (!s.created_at || s.processing_time_seconds == null) continue;
    const day = isoDay(new Date(s.created_at));
    const arr = byDay.get(day) ?? [];
    arr.push(s.processing_time_seconds);
    byDay.set(day, arr);
  }
  const latencyByBucket: { day: string; p95Seconds: number | null }[] = [];
  const cursor = new Date(window.start);
  while (cursor <= window.end) {
    const key = isoDay(cursor);
    latencyByBucket.push({
      day: key,
      p95Seconds: p95(byDay.get(key) ?? []),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    window,
    p50Seconds: p50(filteredCurrent.map((s) => s.processing_time_seconds)),
    p95Seconds: p95(filteredCurrent.map((s) => s.processing_time_seconds)),
    transcribeP95Seconds: p95(filteredCurrent.map((s) => s.transcribe_time_seconds)),
    summarizeP95Seconds: p95(filteredCurrent.map((s) => s.summarize_time_seconds)),
    prev: {
      p50Seconds: p50(filteredPrev.map((s) => s.processing_time_seconds)),
      p95Seconds: p95(filteredPrev.map((s) => s.processing_time_seconds)),
      transcribeP95Seconds: p95(filteredPrev.map((s) => s.transcribe_time_seconds)),
      summarizeP95Seconds: p95(filteredPrev.map((s) => s.summarize_time_seconds)),
    },
    latencyByBucket,
  };
}

// ─── Internals ────────────────────────────────────────────────────────────

interface SummaryRow {
  id: string;
  video_id: string;
  transcript_source: string;
  processing_time_seconds: number | null;
  transcribe_time_seconds: number | null;
  summarize_time_seconds: number | null;
  created_at: string;
}

async function fetchSummariesIn(
  client: SupabaseClient,
  window: TimeWindow,
): Promise<SummaryRow[]> {
  const { data, error } = await client
    .from("summaries")
    .select(
      "id, video_id, transcript_source, processing_time_seconds, transcribe_time_seconds, summarize_time_seconds, created_at",
    )
    .gte("created_at", window.start.toISOString())
    .lte("created_at", window.end.toISOString())
    .limit(SUMMARIES_ROW_CAP);
  if (error) throw new QueryError("fetchSummariesIn", error.message);
  if (data && data.length === SUMMARIES_ROW_CAP) {
    console.warn("[admin-queries] summaries cap hit — KPIs may understate", {
      cap: SUMMARIES_ROW_CAP,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
    });
  }
  return (data ?? []) as SummaryRow[];
}

interface HistoryRow {
  user_id: string;
  video_id: string;
  created_at: string;
  /** Populated by fetchHistoryIn enrichment for shared history consumers. */
  cacheHit?: boolean;
}

/** Used by getPerformanceStats: a history-fetch error logs and returns []
 * so the perf page renders instead of 500-ing. With honest filtering, []
 * now zeroes the filtered metrics — that's preferable to crashing the
 * page on a transient read failure. */
async function fetchHistoryForExclusion(
  client: SupabaseClient,
  window: TimeWindow,
  exclude: string[],
): Promise<HistoryRow[]> {
  try {
    return await fetchHistoryIn(client, window, exclude);
  } catch (err) {
    console.error(
      "[admin-queries] getPerformanceStats: history fetch failed; filtered metrics will be empty",
      {
        message: err instanceof Error ? err.message : String(err),
        window: {
          start: window.start.toISOString(),
          end: window.end.toISOString(),
        },
      },
    );
    return [];
  }
}

function restrictSummariesToHistory<T extends { video_id: string }>(
  summaries: T[],
  history: HistoryRow[],
  wantFilter: boolean,
): T[] {
  if (!wantFilter) return summaries;
  const allowed = new Set(history.map((h) => h.video_id));
  return summaries.filter((s) => allowed.has(s.video_id));
}

async function fetchHistoryIn(
  client: SupabaseClient,
  window: TimeWindow,
  excludeUserIds: string[] = [],
): Promise<HistoryRow[]> {
  // Defensive filter: drop empty/falsy IDs so a future caller passing a
  // partially-populated array can't break the PostgREST in.() literal
  // (e.g. `()` or `(,uuid)` would 400 or silently mis-filter).
  const cleanedExcludes = excludeUserIds.filter(
    (id) => typeof id === "string" && id.length > 0,
  );

  // user_video_history's timestamp is `accessed_at` in production (see
  // aggregateUserActivity comment). Alias on read so HistoryRow's
  // `created_at` is consistent with how the field is named on every
  // other admin table.
  let query = client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .gte("accessed_at", window.start.toISOString())
    .lte("accessed_at", window.end.toISOString());

  if (cleanedExcludes.length > 0) {
    query = query.not("user_id", "in", `(${cleanedExcludes.join(",")})`);
  }

  const { data: history, error } = await query.limit(HISTORY_ROW_CAP);
  if (error) throw new QueryError("fetchHistoryIn:history", error.message);
  if (history && history.length === HISTORY_ROW_CAP) {
    console.warn("[admin-queries] history cap hit — DAU/cache-hit may understate", {
      cap: HISTORY_ROW_CAP,
      window: { start: window.start.toISOString(), end: window.end.toISOString() },
    });
  }
  if (!history || history.length === 0) return [];

  // Cache hit = an earlier summary for this video already existed before
  // the user's history entry was recorded (so we served from cache instead
  // of generating a new one). Compare history.created_at against the
  // earliest known summary for the same video.
  const videoIds = Array.from(new Set(history.map((h) => h.video_id as string)));
  if (videoIds.length === 0) return history as HistoryRow[];

  const { data: summaries, error: sErr } = await client
    .from("summaries")
    .select("video_id, created_at")
    .in("video_id", videoIds);
  if (sErr) throw new QueryError("fetchHistoryIn:summaries", sErr.message);

  const earliestByVideo = new Map<string, string>();
  for (const s of summaries ?? []) {
    const vid = s.video_id as string;
    const ts = s.created_at as string;
    const existing = earliestByVideo.get(vid);
    if (!existing || ts < existing) earliestByVideo.set(vid, ts);
  }

  return (history as HistoryRow[]).map((h) => {
    const earliest = earliestByVideo.get(h.video_id);
    return {
      ...h,
      cacheHit: earliest ? earliest < h.created_at : false,
    };
  });
}
