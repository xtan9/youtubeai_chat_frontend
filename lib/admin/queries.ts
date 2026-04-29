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

import { WHISPER_FLAG_THRESHOLD } from "./constants";
export { WHISPER_FLAG_THRESHOLD } from "./constants";

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
/** Cap on per-page row count returned by listUsersWithStatsAndSort. */
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
  return (data ?? []).map(toAuditRow);
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

  const { users: raw, truncated } = await listAllUsers(client, {
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
  u: AuthUserRecord,
  stat: UserActivity | undefined,
): AdminUserRow {
  const summaries = stat?.summaries ?? 0;
  const whisper = stat?.whisper ?? 0;
  const whisperPct =
    summaries > 0 ? Math.round((whisper / summaries) * 100) : 0;
  const providers = Array.from(
    new Set(
      (u.identities ?? [])
        .map((i) => i.provider)
        .filter((p): p is string => Boolean(p)),
    ),
  );
  let isBanned = false;
  if (u.banned_until) {
    const t = new Date(u.banned_until).getTime();
    if (Number.isNaN(t)) {
      console.error("[admin-queries] toAdminUserRow: invalid banned_until value", {
        userId: u.id,
        bannedUntil: u.banned_until,
      });
    } else if (t > Date.now()) {
      isBanned = true;
    }
  }
  const isDeleted = !!u.deleted_at;
  const emailVerified = !!u.email_confirmed_at;
  const status: UserStatus = isDeleted
    ? "deleted"
    : isBanned
      ? "banned"
      : u.is_anonymous
        ? "anonymous"
        : emailVerified
          ? "active"
          : "unverified";

  return {
    userId: u.id,
    email: u.email ?? null,
    emailVerified,
    providers,
    status,
    createdAt: u.created_at,
    lastSignIn: u.last_sign_in_at ?? null,
    lastActivity: stat?.lastSeen ?? null,
    summaries,
    whisper,
    whisperPct,
    flagged: summaries > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
    isAnonymous: !!u.is_anonymous,
    isSsoUser: !!u.is_sso_user,
    bannedUntil: u.banned_until ?? null,
    deletedAt: u.deleted_at ?? null,
    appMetadata: u.app_metadata ?? {},
    userMetadata: u.user_metadata ?? {},
  };
}

interface AuthUserRecord {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  deleted_at: string | null;
  is_anonymous?: boolean;
  is_sso_user?: boolean;
  identities?: Array<{ provider?: string }>;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

const ALL_USERS_ROW_CAP_DEFAULT = 5_000;
const ALL_USERS_PER_PAGE = 200;

export interface ListAllUsersResult {
  users: AuthUserRecord[];
  /** Count reported by the auth service on the first page; may exceed `users.length` when `truncated` is true. */
  total: number;
  truncated: boolean;
}

export interface ListAllUsersOptions {
  rowCap?: number;
}

export async function listAllUsers(
  client: SupabaseClient,
  opts: ListAllUsersOptions = {},
): Promise<ListAllUsersResult> {
  const cap = Math.max(1, opts.rowCap ?? ALL_USERS_ROW_CAP_DEFAULT);
  const collected: AuthUserRecord[] = [];
  let total = 0;
  let truncated = false;

  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: ALL_USERS_PER_PAGE,
    });
    if (error) throw new QueryError("listAllUsers", error.message);
    const users = (data?.users ?? []) as AuthUserRecord[];
    if (page === 1) total = data?.total ?? users.length;

    for (const u of users) {
      if (collected.length >= cap) {
        truncated = true;
        break;
      }
      collected.push(u);
    }
    if (truncated) break;
    if (users.length < ALL_USERS_PER_PAGE) break;
  }

  if (truncated) {
    console.warn("[admin-queries] listAllUsers cap hit", {
      cap,
      total,
    });
  }
  return { users: collected, total, truncated };
}

/** Cheap one-shot total user count for sidebar badge. Returns null on
 * error so the badge can render gracefully. */
export async function fetchUsersTotal(
  client: SupabaseClient,
): Promise<number | null> {
  const { data, error } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    console.error("[admin-queries] fetchUsersTotal failed", {
      message: error.message,
    });
    return null;
  }
  return data?.total ?? null;
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

export class QueryError extends Error {
  constructor(scope: string, detail: string) {
    super(`[admin-queries:${scope}] ${detail}`);
    this.name = "QueryError";
  }
}
