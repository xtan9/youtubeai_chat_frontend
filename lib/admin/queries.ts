import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranscriptSource } from "@/lib/admin/types";
import { AUDIT_ACTIONS } from "@/lib/admin/audit";
import type { AuditAction, AuditResourceType } from "@/lib/admin/audit";

export type { AuditAction, AuditResourceType } from "@/lib/admin/audit";

/** Canonical list of `transcript_source` values the rest of the admin
 * surface understands. Exported so `app/admin/videos/page.tsx` and the
 * server actions don't redefine the same literal array (drift would let
 * a new source silently sort/filter as `auto_captions`). Keep in sync
 * with `TranscriptSource` in `lib/admin/types.ts`. */
export const ALL_SOURCES: readonly TranscriptSource[] = [
  "manual_captions",
  "auto_captions",
  "whisper",
] as const;

import { WHISPER_FLAG_THRESHOLD } from "./constants";
export { WHISPER_FLAG_THRESHOLD } from "./constants";

// Caps live in `admin-constants.ts` so client components can import the
// runtime values without pulling the `import "server-only"` side-effect
// at the top of this file. Re-export the pair that callers historically
// imported from this module so existing import paths stay stable.
import {
  SUMMARIES_ROW_CAP,
  HISTORY_ROW_CAP,
  AUDIT_PAGE_SIZE_CAP,
  USERS_PAGE_SIZE_CAP,
  VIDEOS_ROW_CAP,
  VIDEO_USERS_DRILLDOWN_CAP,
  VIDEOS_PAGE_SIZE_CAP,
} from "./admin-constants";

export { VIDEO_USERS_DRILLDOWN_CAP, VIDEOS_PAGE_SIZE_CAP };

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

// `AUDIT_ACTIONS` is imported from `./audit` — the single source of
// truth for the audited-action vocabulary. A previous duplicate here
// invited drift between the runtime validator and the writer's type.

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
}

export interface VideoInsightsOptions {
  mode: VideoMode;
  window?: TimeWindow;
  excludeAdminUserIds?: string[];
}

export interface VideoUsersDrilldown {
  videoId: string;
  users: {
    userId: string;
    /** null when emailLookupOk=false or the user genuinely has no email. */
    email: string | null;
    emailLookupOk: boolean;
    /** Most recent access for this user. Each user appears once even if
     * they accessed the video N times — the audit row count must equal
     * the distinct revealed-user count, not the access count. */
    accessedAt: string;
    cacheHit: boolean;
  }[];
  /** True when the underlying `user_video_history` fetch hit
   * VIDEO_USERS_DRILLDOWN_CAP. Lets the UI surface a "+N more" banner
   * instead of silently dropping the tail. */
  truncated: boolean;
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

/** Internal worker — paginated `auth.admin.listUsers` aggregator.
 * Wrapped by the exported {@link listAllUsers} via React's `cache()` so
 * `/admin/videos` (which calls it from both the layout's
 * {@link fetchRegisteredUsersTotal} and the page's
 * {@link listAdminUserIds}) only does the pagination once per request. */
async function listAllUsersUncached(
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

/** Request-scoped memoized variant of {@link listAllUsersUncached}.
 * `cache()` keys on the argument identity tuple — `(client, opts)` — so
 * the layout and the page must reuse the same `client` instance and
 * default `opts` shape to share the cached pagination. */
export const listAllUsers = cache(
  (
    client: SupabaseClient,
    opts: ListAllUsersOptions = {},
  ): Promise<ListAllUsersResult> => listAllUsersUncached(client, opts),
);

/**
 * Sidebar badge count: signed-up users excluding the admin allowlist
 * and anonymous Supabase sessions. Pages through {@link listAllUsers}
 * because Supabase's `auth.admin.listUsers` exposes no server-side
 * filter for `is_anonymous = false`.
 *
 * Returns `null` on error so the badge degrades gracefully.
 */
export async function fetchRegisteredUsersTotal(
  client: SupabaseClient,
  allowlist: readonly string[],
): Promise<number | null> {
  try {
    const { users } = await listAllUsers(client);
    const adminSet = new Set(allowlist.map((e) => e.toLowerCase()));
    let count = 0;
    for (const u of users) {
      if (u.is_anonymous) continue;
      if (!u.email) continue;
      if (adminSet.has(u.email.toLowerCase())) continue;
      count++;
    }
    return count;
  } catch (err) {
    console.error("[admin-queries] fetchRegisteredUsersTotal failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Returns the auth user IDs of all users with
 * `app_metadata.is_admin === true`. Used to filter out admin activity
 * from KPIs.
 *
 * Pages through the full user list via `listAllUsers` (capped at 5000
 * by default with a warn on truncation). A previous single-page
 * implementation silently dropped admins past the first 200 rows.
 *
 * Fail-soft: returns [] on error so callers default to "include
 * admins" rather than failing the page.
 */
export async function listAdminUserIds(
  client: SupabaseClient,
): Promise<string[]> {
  try {
    const { users, truncated } = await listAllUsers(client);
    if (truncated) {
      console.warn(
        "[admin-queries] listAdminUserIds: user list truncated — admin set may be incomplete",
      );
    }
    return users
      .filter(
        (u) =>
          (u.app_metadata as Record<string, unknown> | undefined)
            ?.is_admin === true,
      )
      .map((u) => u.id);
  } catch (err) {
    console.error("[admin-queries] listAdminUserIds failed", {
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
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

export interface KpiOptions {
  /** When non-empty, history aggregations exclude rows where user_id is
   * in this list. Used to drop admin activity from KPIs. */
  excludeAdminUserIds?: string[];
}

export async function getDashboardKPIs(
  client: SupabaseClient,
  window: TimeWindow = lastNDays(30),
  opts: KpiOptions = {},
): Promise<DashboardKPIs> {
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
    fetchHistoryIn(client, window, exclude),
    fetchHistoryIn(client, prevWindow, exclude),
  ]);

  // When excluding admins, intersect summary KPIs with the admin-filtered
  // history so videos only admins watched contribute zero. If real-user
  // history is empty in window, KPIs honestly show zero — the toggle
  // promises filtering, not graceful fallback.
  const filteredCurrent = restrictSummariesToHistory(current, history, wantFilter);
  const filteredPrev = restrictSummariesToHistory(previous, prevHistory, wantFilter);

  const summariesPerDay = bucketByDay(filteredCurrent, "created_at", window);
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
  for (const s of filteredCurrent) {
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

  const topUsers = await computeTopUsers(client, history, filteredCurrent, 5);

  const whisperCount = filteredCurrent.filter(
    (s) => s.transcript_source === "whisper",
  ).length;
  const whisperPrev = filteredPrev.filter(
    (s) => s.transcript_source === "whisper",
  ).length;

  return {
    window,
    summaries: {
      current: filteredCurrent.length,
      previous: filteredPrev.length,
    },
    whisper: { current: whisperCount, previous: whisperPrev },
    p95Seconds: {
      current: p95(filteredCurrent.map((s) => s.processing_time_seconds)),
      previous: p95(filteredPrev.map((s) => s.processing_time_seconds)),
    },
    transcribeP95Seconds: p95(
      filteredCurrent.map((s) => s.transcribe_time_seconds),
    ),
    summarizeP95Seconds: p95(
      filteredCurrent.map((s) => s.summarize_time_seconds),
    ),
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
  /** Populated by fetchHistoryIn enrichment; consumed by computeCacheHitRate. */
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
  // First summary per video wins. Production has at most one summary
  // per video (per migration 20260423000000_drop_thinking_columns); the
  // dedup also collapsed historical duplicates. Iterating defensively
  // costs us nothing.
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

// ─── Videos page queries ─────────────────────────────────────────────────

const STALE_VIDEO_DAYS = 30;

export async function listVideosWithStats(
  client: SupabaseClient,
  opts: VideoListOptions,
): Promise<VideoListResult> {
  const pageSize = Math.min(Math.max(opts.pageSize, 1), VIDEOS_PAGE_SIZE_CAP);
  const page = Math.max(1, opts.page);
  const exclude = opts.excludeAdminUserIds ?? [];

  // 1. Fetch history rows (windowed in trending mode, all-time otherwise).
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
  const cleanedExcludes = exclude.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  if (cleanedExcludes.length > 0) {
    historyQuery = historyQuery.not(
      "user_id",
      "in",
      `(${cleanedExcludes.join(",")})`,
    );
  }
  const { data: history, error: hErr } = await historyQuery.limit(
    HISTORY_ROW_CAP,
  );
  if (hErr) throw new QueryError("listVideosWithStats:history", hErr.message);

  if (!history || history.length === 0) {
    return { rows: [], total: 0, truncated: false, page, pageCount: 1 };
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

  return { rows: slice, total, truncated, page, pageCount };
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

  let historyQuery = client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at");
  if (window) {
    historyQuery = historyQuery
      .gte("accessed_at", window.start.toISOString())
      .lte("accessed_at", window.end.toISOString());
  }
  const cleanedExcludes = exclude.filter(
    (id) => typeof id === "string" && id.length > 0,
  );
  if (cleanedExcludes.length > 0) {
    historyQuery = historyQuery.not(
      "user_id",
      "in",
      `(${cleanedExcludes.join(",")})`,
    );
  }
  const { data: history, error: hErr } = await historyQuery.limit(
    HISTORY_ROW_CAP,
  );
  if (hErr) throw new QueryError("getVideoInsights:history", hErr.message);

  if (!history || history.length === 0) {
    return {
      totalUniqueVideos: 0,
      totalSummaries: 0,
      whisperVideoSharePct: 0,
      topChannels: [],
      languageMix: [],
      sourceMix: ALL_SOURCES.map((s) => ({ source: s, count: 0 })),
      trendingPerDay: window
        ? fillDailySeries(window.start, window.end, new Map())
        : undefined,
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

  const sourceMix = ALL_SOURCES.map((source) => ({
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
  };
}

/**
 * Resolve the per-video drilldown of distinct users who accessed the video.
 *
 * Conservative truncation: when the over-fetch limit (CAP+1) is hit, we
 * set `truncated=true` because we cannot prove from a single peek row
 * that no distinct hidden users exist past the cap. The cap is on raw
 * access rows, not distinct users — a single peek at row #(CAP+1)
 * reveals nothing about rows #(CAP+2)..N. Banner/audit copy must
 * reflect that uncertainty rather than promise completeness.
 *
 * Trade-off: on videos where the tail is dominated by repeat viewers
 * (every hidden row is a duplicate of a kept user) we will over-warn.
 * That failure mode is recoverable — operators see the banner and
 * investigate. The alternative (under-warning by trusting a single
 * peek) silently degrades forensic awareness on exactly the
 * high-traffic videos where the drilldown matters most.
 */
export async function getVideoSummariesUsers(
  client: SupabaseClient,
  videoId: string,
): Promise<VideoUsersDrilldown> {
  // Fetch one extra row past the cap so we can detect cap-hit cheaply
  // without a separate count query. The +1 is sliced off before the
  // dedup pass below.
  const { data: history, error: hErr } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .eq("video_id", videoId)
    .order("accessed_at", { ascending: false })
    .limit(VIDEO_USERS_DRILLDOWN_CAP + 1);
  if (hErr) {
    throw new QueryError("getVideoSummariesUsers:history", hErr.message);
  }
  if (!history || history.length === 0) {
    return { videoId, users: [], truncated: false };
  }

  // Conservative rule: any cap-hit means we cannot prove completeness,
  // so report truncated=true. We deliberately do NOT inspect the peek
  // row's user_id — a single peek can't answer "are distinct users
  // hidden past the cap?" because we never see rows #(CAP+2)..N.
  const truncated = history.length > VIDEO_USERS_DRILLDOWN_CAP;
  const slicedHistory = truncated
    ? history.slice(0, VIDEO_USERS_DRILLDOWN_CAP)
    : history;

  // Earliest summary for the video — used to compute cacheHit. A history
  // row counts as a cache-hit when the canonical summary already existed
  // before the access.
  const { data: summaries, error: sErr } = await client
    .from("summaries")
    .select("video_id, created_at")
    .eq("video_id", videoId);
  if (sErr) {
    throw new QueryError("getVideoSummariesUsers:summaries", sErr.message);
  }

  let earliest: string | null = null;
  for (const s of (summaries ?? []) as Array<Record<string, unknown>>) {
    const ts = String(s.created_at);
    if (!earliest || ts < earliest) earliest = ts;
  }

  const typedHistory = slicedHistory as Array<{
    user_id: string;
    video_id: string;
    created_at: string;
  }>;
  // Aggregate per user — keep the most recent access. The drilldown
  // contract is "one row per revealed user", which is what feeds
  // `viewVideoUsersAction` writing one audit row per result. A previous
  // map-per-history version could write N audit rows for one user who
  // accessed the video N times, distorting forensics.
  const seen = new Map<
    string,
    { userId: string; accessedAt: string }
  >();
  for (const h of typedHistory) {
    const prev = seen.get(h.user_id);
    if (!prev || h.created_at > prev.accessedAt) {
      seen.set(h.user_id, {
        userId: h.user_id,
        accessedAt: h.created_at,
      });
    }
  }
  const distinctUsers = Array.from(seen.values());

  // Resolve emails in parallel (mirrors computeTopUsers pattern).
  const userIds = distinctUsers.map((u) => u.userId);
  const lookups = await Promise.all(
    userIds.map(async (id) => {
      try {
        const { data, error } = await client.auth.admin.getUserById(id);
        if (error) {
          console.error(
            "[admin-queries] getVideoSummariesUsers email lookup failed",
            { userId: id, message: error.message },
          );
          return { userId: id, email: null, ok: false };
        }
        return { userId: id, email: data.user?.email ?? null, ok: true };
      } catch (err) {
        console.error(
          "[admin-queries] getVideoSummariesUsers email lookup threw",
          { userId: id, err },
        );
        return { userId: id, email: null, ok: false };
      }
    }),
  );
  const lookupById = new Map(lookups.map((l) => [l.userId, l] as const));

  return {
    videoId,
    users: distinctUsers.map((u) => {
      const lookup = lookupById.get(u.userId);
      return {
        userId: u.userId,
        email: lookup?.email ?? null,
        emailLookupOk: lookup?.ok ?? false,
        accessedAt: u.accessedAt,
        cacheHit: earliest ? earliest < u.accessedAt : false,
      };
    }),
    truncated,
  };
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
