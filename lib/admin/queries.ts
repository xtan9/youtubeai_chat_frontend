import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptSource } from "@/lib/admin/types";

const ALL_SOURCES: readonly TranscriptSource[] = [
  "manual_captions",
  "auto_captions",
  "whisper",
] as const;

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
  return { start: daysAgo(n - 1), end: daysAgo(0) };
}

// ─── Audit log ────────────────────────────────────────────────────────────

export type AuditAction =
  | "view_transcript"
  | "view_summary_text"
  | "view_user_email_list"
  | "reset_rate_limit"
  | "suspend_user"
  | "restore_user";

export type AuditResourceType = "summary" | "user" | "video" | "rate_limit";

export interface AuditRow {
  id: string;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  action: string;
  resourceType: string;
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
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
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
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    adminId: String(row.admin_id),
    adminEmail: String(row.admin_email),
    action: String(row.action),
    resourceType: String(row.resource_type),
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
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const window = opts.window ?? lastNDays(30);

  // Cursor encodes the auth.admin.listUsers `page` index — `auth.admin`
  // doesn't expose keyset pagination yet, so we honor its model rather
  // than reinvent it.
  const page = decodePageCursor(opts.cursor);
  const {
    data: usersData,
    error: usersErr,
  } = await client.auth.admin.listUsers({ page, perPage: pageSize });
  if (usersErr) throw new QueryError("listUsersWithStats:auth", usersErr.message);

  const raw = (usersData?.users ?? []) as AuthUserRecord[];
  let users = raw.filter((u): u is AuthUserRecord & { email: string } =>
    Boolean(u.email),
  );

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
      flagged: summaries > 0 && whisperPct > 30,
    };
  });

  // Cursor: if we got a full page, there may be more.
  const nextCursor =
    raw.length === pageSize ? encodePageCursor(page + 1) : null;

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
  const { data: history, error: hErr } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at")
    .in("user_id", userIds)
    .gte("created_at", window.start.toISOString())
    .lte("created_at", window.end.toISOString());
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
  const { data, error } = await client
    .from("user_video_history")
    .select(
      "video_id, created_at, videos(title, channel_name, language), summaries:videos(summaries(id, transcript_source, model, processing_time_seconds, enable_thinking))",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(cap);

  if (error) throw new QueryError("getUserSummaries", error.message);

  // Supabase's nested select returns shapes that depend on relationship
  // cardinality. Normalize into the flat row shape.
  const rows: UserSummaryRow[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const video = readObject(r.videos);
    const summaryGroup = readObject(r.summaries);
    const summariesArr = readArray(summaryGroup?.summaries) ?? readArray(r.summaries);
    const summary = summariesArr?.find(
      (s) => readObject(s)?.enable_thinking === false,
    ) ?? summariesArr?.[0];
    const sObj = readObject(summary);
    const source = (sObj?.transcript_source ?? "auto_captions") as TranscriptSource;
    if (!ALL_SOURCES.includes(source)) continue;
    rows.push({
      videoId: String(r.video_id),
      videoTitle: (video?.title as string | null) ?? null,
      videoChannel: (video?.channel_name as string | null) ?? null,
      language: (video?.language as string | null) ?? null,
      source,
      model: (sObj?.model as string | null) ?? null,
      processingTimeSeconds:
        typeof sObj?.processing_time_seconds === "number"
          ? (sObj?.processing_time_seconds as number)
          : null,
      pulledAt: String(r.created_at),
      summaryId: String(sObj?.id ?? ""),
    });
  }
  return rows;
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

// ─── Dashboard KPIs ───────────────────────────────────────────────────────

export interface KpiDelta {
  current: number;
  previous: number;
}

export interface TopUserStat {
  userId: string;
  email: string | null;
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

  const [current, previous] = await Promise.all([
    fetchSummariesIn(client, window),
    fetchSummariesIn(client, prevWindow),
  ]);
  const history = await fetchHistoryIn(client, window);

  // Per-day buckets
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

  // Source mix
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

  // Cache hit rate (overall) — proportion of history rows where the linked
  // summary was created earlier than the history entry.
  const cacheHitCurrent = computeCacheHitRate(history);
  const prevHistory = await fetchHistoryIn(client, prevWindow);
  const cacheHitPrevious = computeCacheHitRate(prevHistory);

  // Top users by activity in window
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
  /** Hourly buckets aligned to UTC hour. */
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

  // Daily buckets of p95 — the chart on /admin/performance is daily.
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
    .limit(50_000);
  if (error) throw new QueryError("fetchSummariesIn", error.message);
  return (data ?? []) as SummaryRow[];
}

interface HistoryRow {
  user_id: string;
  video_id: string;
  created_at: string;
  /** Filled in by computeCacheHitRate / fetchHistoryIn enrichment. */
  cacheHit?: boolean;
}

async function fetchHistoryIn(
  client: SupabaseClient,
  window: TimeWindow,
): Promise<HistoryRow[]> {
  const { data: history, error } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at")
    .gte("created_at", window.start.toISOString())
    .lte("created_at", window.end.toISOString())
    .limit(100_000);
  if (error) throw new QueryError("fetchHistoryIn:history", error.message);
  if (!history || history.length === 0) return [];

  // Enrich with cache-hit info: for each history row, compare against the
  // earliest summary timestamp for that video.
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

  const emails = new Map<string, string | null>();
  for (const top of sorted) {
    try {
      const { data, error } = await client.auth.admin.getUserById(top.userId);
      if (error) {
        emails.set(top.userId, null);
        continue;
      }
      emails.set(top.userId, data.user?.email ?? null);
    } catch {
      emails.set(top.userId, null);
    }
  }

  return sorted.map((t) => ({
    userId: t.userId,
    email: emails.get(t.userId) ?? null,
    summaries: t.summaries,
    whisperPct: t.whisperPct,
    p95Seconds: t.p95Seconds,
    lastSeen: t.lastSeen,
    flagged: t.summaries > 0 && t.whisperPct > 30,
  }));
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
  } catch {
    // fall through
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
  } catch {
    // fall through
  }
  return 1;
}

export class QueryError extends Error {
  constructor(scope: string, detail: string) {
    super(`[admin-queries:${scope}] ${detail}`);
    this.name = "QueryError";
  }
}
