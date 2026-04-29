import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptSource } from "@/lib/admin/types";
import type { AuditAction, AuditResourceType } from "@/lib/admin/audit";

export type { AuditAction, AuditResourceType } from "@/lib/admin/audit";

const ALL_SOURCES: readonly TranscriptSource[] = [
  "manual_captions",
  "auto_captions",
  "whisper",
] as const;

/** Whisper share above this percent flips a user/account to "flagged". The
 * threshold is an organizational policy lever (whisper is the cost lever),
 * not a domain truth — single source so /admin and the users table never
 * drift. */
export const WHISPER_FLAG_THRESHOLD = 30;

/** Hard caps on rows pulled into Node memory for in-process aggregation.
 * In the current scale (low-thousands of summaries / month), these are
 * far above the realistic window size; if a 90-day window starts hitting
 * either cap the percentile/cache-hit math will silently understate, so
 * raise both before that happens. Listed here so future growth flips one
 * knob, not a scattered set. */
const SUMMARIES_ROW_CAP = 50_000;
const HISTORY_ROW_CAP = 100_000;
/** Cap on per-page row count returned by listAuditLog. Bounds a single
 * service-role table scan in the worst-case bad-cursor path. */
const AUDIT_PAGE_SIZE_CAP = 200;
/** Cap on per-page row count returned by listUsersWithStats. */
const USERS_PAGE_SIZE_CAP = 100;

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

const AUDIT_ACTIONS: readonly AuditAction[] = [
  "view_transcript",
  "view_summary_text",
  "view_user_email_list",
  "reset_rate_limit",
  "suspend_user",
  "restore_user",
] as const;

const AUDIT_RESOURCE_TYPES: readonly AuditResourceType[] = [
  "summary",
  "user",
  "video",
  "rate_limit",
] as const;

function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isAuditResourceType(value: string): value is AuditResourceType {
  return (AUDIT_RESOURCE_TYPES as readonly string[]).includes(value);
}

export interface AuditRow {
  id: string;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  /** Validated against the AuditAction union at read time; rows with an
   * unknown value (e.g. after a future expansion lands in the DB before
   * this code is redeployed) are surfaced as a string so the operator
   * still sees them. */
  action: AuditAction | string;
  resourceType: AuditResourceType | string;
  resourceId: string;
  metadata: Record<string, unknown>;
}

export interface AuditListResult {
  rows: AuditRow[];
  nextCursor: string | null;
}

export interface ListAuditLogOptions {
  pageSize?: number;
  cursor?: string | null;
}

export async function listAuditLog(
  client: SupabaseClient,
  opts: ListAuditLogOptions = {},
): Promise<AuditListResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), AUDIT_PAGE_SIZE_CAP);
  let query = client
    .from("admin_audit_log")
    .select(
      "id, created_at, admin_id, admin_email, action, resource_type, resource_id, metadata",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  const decoded = decodeCursor(opts.cursor);
  if (decoded) {
    // Keyset pagination: rows with same created_at use id as the tiebreaker.
    query = query.or(
      `created_at.lt.${decoded.created_at},and(created_at.eq.${decoded.created_at},id.lt.${decoded.id})`,
    );
  }

  const { data, error } = await query;
  if (error) throw new QueryError("listAuditLog", error.message);

  const rows = (data ?? []).slice(0, pageSize).map(toAuditRow);
  const nextCursor =
    (data?.length ?? 0) > pageSize
      ? encodeCursor({
          created_at: rows[rows.length - 1].createdAt,
          id: rows[rows.length - 1].id,
        })
      : null;

  return { rows, nextCursor };
}

function toAuditRow(row: Record<string, unknown>): AuditRow {
  const action = String(row.action);
  const resourceType = String(row.resource_type);
  if (!isAuditAction(action)) {
    console.error("[admin-queries] unknown audit action persisted", { action });
  }
  if (!isAuditResourceType(resourceType)) {
    console.error("[admin-queries] unknown audit resource_type persisted", {
      resourceType,
    });
  }
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    adminId: String(row.admin_id),
    adminEmail: String(row.admin_email),
    action,
    resourceType,
    resourceId: String(row.resource_id),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

// ─── Users + per-user stats ───────────────────────────────────────────────

export interface AdminUserRow {
  userId: string;
  email: string;
  createdAt: string;
  lastSeen: string | null;
  summaries: number;
  whisper: number;
  whisperPct: number;
  p95Seconds: number | null;
  flagged: boolean;
}

export interface UserListOptions {
  pageSize?: number;
  cursor?: string | null;
  search?: string | null;
  /** Aggregate window for the per-row stats. Defaults to last 30 days. */
  window?: TimeWindow;
}

export interface UserListResult {
  rows: AdminUserRow[];
  nextCursor: string | null;
  totalApprox: number;
}

interface AuthUserRecord {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string | null;
}

export async function listUsersWithStats(
  client: SupabaseClient,
  opts: UserListOptions = {},
): Promise<UserListResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), USERS_PAGE_SIZE_CAP);
  const window = opts.window ?? lastNDays(30);

  // auth.admin.listUsers paginates by page index, not keyset. We honor that
  // rather than reinvent it. To detect "is there a next page" without a
  // separate count round-trip, we ask for one extra row and emit a cursor
  // only if the API actually returned that extra — same pattern as
  // listAuditLog. This avoids the off-by-one where an exactly-full last
  // page would otherwise emit a Next button that dead-ends.
  const page = decodePageCursor(opts.cursor);
  const {
    data: usersData,
    error: usersErr,
  } = await client.auth.admin.listUsers({ page, perPage: pageSize + 1 });
  if (usersErr) throw new QueryError("listUsersWithStats:auth", usersErr.message);

  const raw = (usersData?.users ?? []) as AuthUserRecord[];
  const hasMore = raw.length > pageSize;
  const trimmed = raw.slice(0, pageSize);
  let users = trimmed.filter((u): u is AuthUserRecord & { email: string } =>
    Boolean(u.email),
  );
  const droppedNoEmail = trimmed.length - users.length;
  if (droppedNoEmail > 0) {
    console.warn("[admin-queries] users without email omitted", {
      droppedNoEmail,
      page,
    });
  }

  const search = opts.search?.trim().toLowerCase();
  if (search) {
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(search) ||
        u.id.toLowerCase().includes(search),
    );
  }

  const userIds = users.map((u) => u.id);
  const stats = userIds.length
    ? await aggregateUserActivity(client, userIds, window)
    : new Map<string, UserActivity>();

  const rows: AdminUserRow[] = users.map((u) => {
    const stat = stats.get(u.id);
    const summaries = stat?.summaries ?? 0;
    const whisper = stat?.whisper ?? 0;
    const whisperPct = summaries > 0 ? Math.round((whisper / summaries) * 100) : 0;
    return {
      userId: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSeen: stat?.lastSeen ?? u.last_sign_in_at ?? null,
      summaries,
      whisper,
      whisperPct,
      p95Seconds: stat?.p95Seconds ?? null,
      flagged: summaries > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
    };
  });

  const nextCursor = hasMore ? encodePageCursor(page + 1) : null;

  return {
    rows,
    nextCursor,
    totalApprox: usersData?.total ?? rows.length,
  };
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
        "id, video_id, transcript_source, model, processing_time_seconds, enable_thinking",
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

  // Pick canonical summary per video: prefer enable_thinking=false (the
  // default user-visible variant); fall back to whichever exists. If a
  // future write path produces both per video, the false-variant is the
  // one mirrored on /summary.
  const summaryByVideo = new Map<string, Record<string, unknown>>();
  for (const s of (summariesRes.data ?? []) as Record<string, unknown>[]) {
    const vid = String(s.video_id);
    const existing = summaryByVideo.get(vid);
    if (!existing) {
      summaryByVideo.set(vid, s);
      continue;
    }
    const newIsCanonical = s.enable_thinking === false;
    const existingIsCanonical = existing.enable_thinking === false;
    if (newIsCanonical && !existingIsCanonical) {
      summaryByVideo.set(vid, s);
    }
  }

  const rows: UserSummaryRow[] = [];
  for (const h of (history ?? []) as {
    video_id: string;
    created_at: string;
  }[]) {
    const video = videoById.get(h.video_id);
    const summary = summaryByVideo.get(h.video_id);
    const rawSource = (summary?.transcript_source ?? "auto_captions") as string;
    if (!ALL_SOURCES.includes(rawSource as TranscriptSource)) {
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

// ─── Dashboard KPIs ───────────────────────────────────────────────────────

export interface KpiDelta {
  current: number;
  previous: number;
}

export interface TopUserStat {
  userId: string;
  email: string | null;
  /** False when the auth lookup for this user failed (network/permission)
   * — UI can render "—" for missing email but distinguish a degraded
   * lookup from a user genuinely missing an email. */
  emailLookupOk: boolean;
  summaries: number;
  whisperPct: number;
  p95Seconds: number | null;
  lastSeen: string | null;
  flagged: boolean;
}

export interface DashboardKPIs {
  window: TimeWindow;
  summaries: KpiDelta;
  whisper: KpiDelta;
  p95Seconds: { current: number | null; previous: number | null };
  transcribeP95Seconds: number | null;
  summarizeP95Seconds: number | null;
  cacheHitRatePct: { current: number | null; previous: number | null };
  summariesPerDay: DailyPoint[];
  dauPerDay: DailyPoint[];
  cacheHitPerDay: DailyPoint[];
  sourceMix: { source: TranscriptSource; count: number }[];
  topUsers: TopUserStat[];
}

export async function getDashboardKPIs(
  client: SupabaseClient,
  window: TimeWindow = lastNDays(30),
): Promise<DashboardKPIs> {
  const days =
    Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000) + 1;
  const prevWindow: TimeWindow = {
    start: new Date(window.start.getTime() - days * 86_400_000),
    end: new Date(window.start.getTime() - 86_400_000),
  };

  const [current, previous, history, prevHistory] = await Promise.all([
    fetchSummariesIn(client, window),
    fetchSummariesIn(client, prevWindow),
    fetchHistoryIn(client, window),
    fetchHistoryIn(client, prevWindow),
  ]);

  const summariesPerDay = bucketByDay(current, "created_at", window);
  const dauPerDay = bucketByDay(history, "created_at", window, (rows) => {
    const distinct = new Set<string>();
    for (const r of rows) distinct.add(r.user_id);
    return distinct.size;
  });
  const cacheHitPerDay = bucketByDay(history, "created_at", window, (rows) => {
    if (rows.length === 0) return 0;
    const hits = rows.filter((r) => r.cacheHit === true).length;
    return Math.round((hits / rows.length) * 100);
  });

  const sourceCounts = new Map<TranscriptSource, number>();
  for (const s of current) {
    sourceCounts.set(
      s.transcript_source as TranscriptSource,
      (sourceCounts.get(s.transcript_source as TranscriptSource) ?? 0) + 1,
    );
  }
  const sourceMix = ALL_SOURCES.map((source) => ({
    source,
    count: sourceCounts.get(source) ?? 0,
  }));

  const cacheHitCurrent = computeCacheHitRate(history);
  const cacheHitPrevious = computeCacheHitRate(prevHistory);

  const topUsers = await computeTopUsers(client, history, current, 5);

  const whisperCount = current.filter((s) => s.transcript_source === "whisper")
    .length;
  const whisperPrev = previous.filter((s) => s.transcript_source === "whisper")
    .length;

  return {
    window,
    summaries: { current: current.length, previous: previous.length },
    whisper: { current: whisperCount, previous: whisperPrev },
    p95Seconds: {
      current: p95(current.map((s) => s.processing_time_seconds)),
      previous: p95(previous.map((s) => s.processing_time_seconds)),
    },
    transcribeP95Seconds: p95(current.map((s) => s.transcribe_time_seconds)),
    summarizeP95Seconds: p95(current.map((s) => s.summarize_time_seconds)),
    cacheHitRatePct: { current: cacheHitCurrent, previous: cacheHitPrevious },
    summariesPerDay,
    dauPerDay,
    cacheHitPerDay,
    sourceMix,
    topUsers,
  };
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
): Promise<PerformanceStats> {
  const days =
    Math.round((window.end.getTime() - window.start.getTime()) / 86_400_000) + 1;
  const prevWindow: TimeWindow = {
    start: new Date(window.start.getTime() - days * 86_400_000),
    end: new Date(window.start.getTime() - 86_400_000),
  };

  const [current, previous] = await Promise.all([
    fetchSummariesIn(client, window),
    fetchSummariesIn(client, prevWindow),
  ]);

  const byDay = new Map<string, number[]>();
  for (const s of current) {
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
    p50Seconds: p50(current.map((s) => s.processing_time_seconds)),
    p95Seconds: p95(current.map((s) => s.processing_time_seconds)),
    transcribeP95Seconds: p95(current.map((s) => s.transcribe_time_seconds)),
    summarizeP95Seconds: p95(current.map((s) => s.summarize_time_seconds)),
    prev: {
      p50Seconds: p50(previous.map((s) => s.processing_time_seconds)),
      p95Seconds: p95(previous.map((s) => s.processing_time_seconds)),
      transcribeP95Seconds: p95(previous.map((s) => s.transcribe_time_seconds)),
      summarizeP95Seconds: p95(previous.map((s) => s.summarize_time_seconds)),
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
  /** Populated by fetchHistoryIn enrichment; consumed by computeCacheHitRate. */
  cacheHit?: boolean;
}

async function fetchHistoryIn(
  client: SupabaseClient,
  window: TimeWindow,
): Promise<HistoryRow[]> {
  // user_video_history's timestamp is `accessed_at` in production (see
  // aggregateUserActivity comment). Alias on read so HistoryRow's
  // `created_at` is consistent with how the field is named on every
  // other admin table.
  const { data: history, error } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .gte("accessed_at", window.start.toISOString())
    .lte("accessed_at", window.end.toISOString())
    .limit(HISTORY_ROW_CAP);
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

function computeCacheHitRate(history: HistoryRow[]): number | null {
  if (history.length === 0) return null;
  const hits = history.filter((h) => h.cacheHit === true).length;
  return Math.round((hits / history.length) * 100);
}

function bucketByDay<T extends { created_at: string }>(
  rows: T[],
  _field: "created_at",
  window: TimeWindow,
  reducer: (rowsForDay: T[]) => number = (r) => r.length,
): DailyPoint[] {
  const byDay = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.created_at) continue;
    const day = isoDay(new Date(r.created_at));
    const arr = byDay.get(day) ?? [];
    arr.push(r);
    byDay.set(day, arr);
  }
  const reduced = new Map<string, number>();
  for (const [day, arr] of byDay) reduced.set(day, reducer(arr));
  return fillDailySeries(window.start, window.end, reduced);
}

async function computeTopUsers(
  client: SupabaseClient,
  history: HistoryRow[],
  summaries: SummaryRow[],
  limit: number,
): Promise<TopUserStat[]> {
  // First summary per video wins. There can be both an enable_thinking=true
  // and enable_thinking=false summary for the same video; for whisper-share
  // and latency aggregation we treat them as one usage event — the first
  // one returned is good enough since both share the same transcript_source.
  const summariesByVideo = new Map<string, SummaryRow>();
  for (const s of summaries) {
    if (!summariesByVideo.has(s.video_id)) summariesByVideo.set(s.video_id, s);
  }

  const tally = new Map<
    string,
    { total: number; whisper: number; latencies: number[]; lastSeen: string }
  >();
  for (const h of history) {
    const summary = summariesByVideo.get(h.video_id);
    const bucket = tally.get(h.user_id) ?? {
      total: 0,
      whisper: 0,
      latencies: [],
      lastSeen: h.created_at,
    };
    bucket.total += 1;
    if (summary?.transcript_source === "whisper") bucket.whisper += 1;
    if (summary?.processing_time_seconds != null) {
      bucket.latencies.push(summary.processing_time_seconds);
    }
    if (h.created_at > bucket.lastSeen) bucket.lastSeen = h.created_at;
    tally.set(h.user_id, bucket);
  }

  const sorted = Array.from(tally.entries())
    .map(([userId, b]) => ({
      userId,
      summaries: b.total,
      whisper: b.whisper,
      whisperPct: b.total > 0 ? Math.round((b.whisper / b.total) * 100) : 0,
      p95Seconds: p95(b.latencies),
      lastSeen: b.lastSeen,
    }))
    .sort((a, b) => b.summaries - a.summaries)
    .slice(0, limit);

  if (sorted.length === 0) return [];

  // Resolve emails in parallel. Each lookup is independent — sequential
  // awaits added 5x latency to every dashboard cold path. Failures are
  // logged (not silently swallowed) and `emailLookupOk: false` lets the
  // UI distinguish "auth lookup degraded" from "user genuinely has no
  // email on record".
  const emailLookups = await Promise.all(
    sorted.map(async (top) => {
      try {
        const { data, error } = await client.auth.admin.getUserById(top.userId);
        if (error) {
          console.error("[admin-queries] auth.admin.getUserById error", {
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
      } catch (err) {
        console.error("[admin-queries] auth.admin.getUserById threw", {
          userId: top.userId,
          err,
        });
        return { userId: top.userId, email: null, ok: false };
      }
    }),
  );
  const lookups = new Map(emailLookups.map((r) => [r.userId, r] as const));

  return sorted.map((t) => {
    const lookup = lookups.get(t.userId);
    return {
      userId: t.userId,
      email: lookup?.email ?? null,
      emailLookupOk: lookup?.ok ?? false,
      summaries: t.summaries,
      whisperPct: t.whisperPct,
      p95Seconds: t.p95Seconds,
      lastSeen: t.lastSeen,
      flagged: t.summaries > 0 && t.whisperPct > WHISPER_FLAG_THRESHOLD,
    };
  });
}

// ─── Cursors ──────────────────────────────────────────────────────────────

interface KeysetCursor {
  created_at: string;
  id: string;
}

function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string | null | undefined): KeysetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.created_at === "string" &&
      typeof parsed.id === "string"
    ) {
      return parsed;
    }
    console.warn("[admin-queries] invalid cursor shape — falling back to first page", {
      cursorPrefix: raw.slice(0, 16),
    });
  } catch (err) {
    console.warn("[admin-queries] cursor base64/json decode failed — falling back to first page", {
      cursorPrefix: raw.slice(0, 16),
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

function encodePageCursor(page: number): string {
  return Buffer.from(`p:${page}`).toString("base64url");
}

function decodePageCursor(raw: string | null | undefined): number {
  if (!raw) return 1;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    if (decoded.startsWith("p:")) {
      const n = Number.parseInt(decoded.slice(2), 10);
      if (Number.isFinite(n) && n >= 1) return n;
    }
    console.warn("[admin-queries] invalid page cursor — falling back to page 1", {
      cursorPrefix: raw.slice(0, 16),
    });
  } catch (err) {
    console.warn("[admin-queries] page cursor decode failed — falling back to page 1", {
      cursorPrefix: raw.slice(0, 16),
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return 1;
}

export class QueryError extends Error {
  constructor(scope: string, detail: string) {
    super(`[admin-queries:${scope}] ${detail}`);
    this.name = "QueryError";
  }
}
