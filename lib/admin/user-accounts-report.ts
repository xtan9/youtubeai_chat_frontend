import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TRANSCRIPT_SOURCES,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";
import { HISTORY_ROW_CAP, USERS_PAGE_SIZE_CAP } from "./admin-constants";
import { WHISPER_FLAG_THRESHOLD } from "./constants";
import { mapAuditRow } from "./audit-row";
import { QueryError } from "./errors";
import {
  reportCompletenessWarning,
  REPORT_COMPLETENESS_WARNING_CODES,
  type ReportCompletenessWarning,
} from "./report-completeness";
import { listUserAccounts, type UserAccount } from "./user-account-directory";

const DEFAULT_ACTIVITY_WINDOW_DAYS = 30;
const DEFAULT_PAGE_SIZE = 25;
const SUMMARY_DRILLDOWN_LIMIT = 25;
const AUDIT_DRILLDOWN_LIMIT = 10;

const TABS = [
  "exclude_anon",
  "anon_only",
  "active",
  "flagged",
  "all",
] as const;
type UserAccountsTab = (typeof TABS)[number];

const SORT_KEYS = [
  "email",
  "providers",
  "status",
  "emailVerified",
  "createdAt",
  "lastSignIn",
  "lastActivity",
  "summaries",
  "whisperPct",
] as const;
type UserAccountsSort = (typeof SORT_KEYS)[number];
type UserAccountsDirection = "asc" | "desc";
type UserStatus =
  | "active"
  | "anonymous"
  | "banned"
  | "deleted"
  | "unverified";

interface UserAccountRow {
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

interface UserSummaryRow {
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

interface UserAuditRow {
  id: string;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
}

/** Intent supplied by the User Accounts route; report policy stays private here. */
export interface UserAccountsReportInput {
  search: string | null;
  tab: UserAccountsTab;
  sort: UserAccountsSort;
  direction: UserAccountsDirection;
  page: number;
  expandedAccountId: string | null;
}

/** Serializable data rendered by the User Accounts route and components. */
export interface UserAccountsReport {
  rows: UserAccountRow[];
  total: number;
  truncated: boolean;
  page: number;
  pageCount: number;
  activeOnPage: number;
  expanded: {
    accountId: string;
    summaries: UserSummaryRow[];
    audit: UserAuditRow[];
  } | null;
  warnings: ReportCompletenessWarning[];
}

const DEFAULT_INPUT: UserAccountsReportInput = {
  search: null,
  tab: "exclude_anon",
  sort: "createdAt",
  direction: "desc",
  page: 1,
  expandedAccountId: null,
};

interface UserActivity {
  summaries: number;
  whisper: number;
  lastSeen: string | null;
}

interface ActivityRead {
  activities: Map<string, UserActivity>;
  truncated: boolean;
  unavailable: boolean;
}

interface ActivityHistoryRow {
  user_id: string;
  video_id: string;
  created_at: string;
}

interface ActivitySummaryRow {
  video_id: string;
  transcript_source: string | null;
}

interface NormalizedIntent {
  search: string | null;
  tab: UserAccountsTab;
  sort: UserAccountsSort;
  direction: UserAccountsDirection;
  page: number;
  expandedAccountId: string | null;
}

/**
 * Load the complete User Accounts report from one server-only boundary.
 * Authorization and privileged-client construction remain in the route.
 */
export async function loadUserAccountsReport(
  client: SupabaseClient,
  input: UserAccountsReportInput = DEFAULT_INPUT,
): Promise<UserAccountsReport> {
  const intent = normalizeIntent(input);
  const pageSize = Math.min(DEFAULT_PAGE_SIZE, USERS_PAGE_SIZE_CAP);

  // Directory enumeration is the primary dataset. Its QueryError is allowed
  // to reach the admin error boundary; an empty account list would otherwise
  // look like a valid, empty report.
  const directory = await listUserAccounts(client);
  const warnings: ReportCompletenessWarning[] = [];
  if (directory.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.userAccountDirectoryTruncated,
      ),
    );
  }

  const baseRows = directory.users.map((user) => mapUserAccount(user));
  const requiresStatsFirst =
    intent.tab === "active" || intent.tab === "flagged";
  const preFiltered = requiresStatsFirst
    ? baseRows
    : filterRows(baseRows, intent.tab, intent.search);
  const targetIds = preFiltered.map((row) => row.userId);
  const activity = targetIds.length
    ? await loadActivitySafely(client, targetIds, lastNDays(DEFAULT_ACTIVITY_WINDOW_DAYS))
    : emptyActivityRead();

  if (activity.unavailable) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.userAccountActivityUnavailable,
      ),
    );
  }
  if (activity.truncated) {
    addWarning(
      warnings,
      reportCompletenessWarning(
        REPORT_COMPLETENESS_WARNING_CODES.userAccountActivityTruncated,
      ),
    );
  }

  const withStats = preFiltered.map((row) => {
    const stat = activity.activities.get(row.userId);
    if (!stat) return row;
    const whisperPct =
      stat.summaries > 0
        ? Math.round((stat.whisper / stat.summaries) * 100)
        : 0;
    return {
      ...row,
      summaries: stat.summaries,
      whisper: stat.whisper,
      whisperPct,
      lastActivity: stat.lastSeen ?? row.lastActivity,
      flagged:
        stat.summaries > 0 && whisperPct > WHISPER_FLAG_THRESHOLD,
    };
  });

  const fullyFiltered = requiresStatsFirst
    ? filterRows(withStats, intent.tab, intent.search)
    : intent.search
      ? filterRows(withStats, "all", intent.search)
      : withStats;
  const sorted = sortRows(fullyFiltered, intent.sort, intent.direction);
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = (intent.page - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize);
  const expandedAccountId =
    intent.expandedAccountId &&
    rows.some((row) => row.userId === intent.expandedAccountId)
      ? intent.expandedAccountId
      : null;

  const expanded = expandedAccountId
    ? await loadExpanded(client, expandedAccountId)
    : null;

  return {
    rows,
    total,
    truncated: directory.truncated,
    page: intent.page,
    pageCount,
    activeOnPage: rows.filter((row) => row.summaries > 0).length,
    expanded,
    warnings,
  };
}

function normalizeIntent(input: UserAccountsReportInput): NormalizedIntent {
  const search = input.search?.trim();
  return {
    search: search ? search : null,
    tab: isTab(input.tab) ? input.tab : "exclude_anon",
    sort: isSort(input.sort) ? input.sort : "createdAt",
    direction: input.direction === "asc" ? "asc" : "desc",
    page:
      Number.isFinite(input.page) && input.page >= 1
        ? Math.floor(input.page)
        : 1,
    expandedAccountId:
      typeof input.expandedAccountId === "string" && input.expandedAccountId
        ? input.expandedAccountId
        : null,
  };
}

function isTab(value: unknown): value is UserAccountsTab {
  return typeof value === "string" && TABS.includes(value as UserAccountsTab);
}

function isSort(value: unknown): value is UserAccountsSort {
  return (
    typeof value === "string" && SORT_KEYS.includes(value as UserAccountsSort)
  );
}

function mapUserAccount(user: UserAccount): UserAccountRow {
  const emailVerified = !!user.emailConfirmedAt;
  const isDeleted = !!user.deletedAt;
  let isBanned = false;
  if (user.bannedUntil) {
    const timestamp = new Date(user.bannedUntil).getTime();
    if (Number.isNaN(timestamp)) {
      console.error("[user-accounts-report] invalid banned_until value", {
        userId: user.id,
        bannedUntil: user.bannedUntil,
      });
    } else if (timestamp > Date.now()) {
      isBanned = true;
    }
  }

  const status: UserStatus = isDeleted
    ? "deleted"
    : isBanned
      ? "banned"
      : user.isAnonymous
        ? "anonymous"
        : emailVerified
          ? "active"
          : "unverified";

  return {
    userId: user.id,
    email: user.email,
    emailVerified,
    providers: user.providers,
    status,
    createdAt: user.createdAt,
    lastSignIn: user.lastSignInAt,
    lastActivity: null,
    summaries: 0,
    whisper: 0,
    whisperPct: 0,
    flagged: false,
    isAnonymous: user.isAnonymous,
    isSsoUser: user.isSsoUser,
    bannedUntil: user.bannedUntil,
    deletedAt: user.deletedAt,
    appMetadata: user.appMetadata,
    userMetadata: user.userMetadata,
  };
}

function filterRows(
  rows: UserAccountRow[],
  tab: UserAccountsTab,
  search: string | null,
): UserAccountRow[] {
  let output = rows;
  switch (tab) {
    case "exclude_anon":
      output = output.filter((row) => !row.isAnonymous);
      break;
    case "anon_only":
      output = output.filter((row) => row.isAnonymous);
      break;
    case "active":
      output = output.filter((row) => !row.isAnonymous && row.summaries > 0);
      break;
    case "flagged":
      output = output.filter((row) => !row.isAnonymous && row.flagged);
      break;
    case "all":
      break;
  }

  const query = search?.trim().toLowerCase();
  if (!query) return output;
  return output.filter(
    (row) =>
      (row.email?.toLowerCase().includes(query) ?? false) ||
      row.userId.toLowerCase().includes(query),
  );
}

function compareNullable<T>(
  a: T | null,
  b: T | null,
  direction: UserAccountsDirection,
  compare: (left: T, right: T) => number,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return direction === "asc" ? compare(a, b) : -compare(a, b);
}

const stringCompare = (a: string, b: string) => a.localeCompare(b);
const numberCompare = (a: number, b: number) => a - b;

function sortRows(
  rows: UserAccountRow[],
  sort: UserAccountsSort,
  direction: UserAccountsDirection,
): UserAccountRow[] {
  const sorted = rows.slice();
  sorted.sort((left, right) => {
    const primary = compareRows(left, right, sort, direction);
    return primary !== 0 ? primary : left.userId.localeCompare(right.userId);
  });
  return sorted;
}

function compareRows(
  left: UserAccountRow,
  right: UserAccountRow,
  sort: UserAccountsSort,
  direction: UserAccountsDirection,
): number {
  switch (sort) {
    case "email":
      return compareNullable(left.email, right.email, direction, stringCompare);
    case "providers": {
      const leftProviders = left.providers.join(",") || null;
      const rightProviders = right.providers.join(",") || null;
      return compareNullable(
        leftProviders,
        rightProviders,
        direction,
        stringCompare,
      );
    }
    case "status":
      return compareNullable(
        left.status,
        right.status,
        direction,
        stringCompare,
      );
    case "emailVerified":
      return compareNullable(
        left.emailVerified ? 1 : 0,
        right.emailVerified ? 1 : 0,
        direction,
        numberCompare,
      );
    case "createdAt":
      return compareNullable(
        left.createdAt,
        right.createdAt,
        direction,
        stringCompare,
      );
    case "lastSignIn":
      return compareNullable(
        left.lastSignIn,
        right.lastSignIn,
        direction,
        stringCompare,
      );
    case "lastActivity":
      return compareNullable(
        left.lastActivity,
        right.lastActivity,
        direction,
        stringCompare,
      );
    case "summaries":
      return compareNullable(
        left.summaries,
        right.summaries,
        direction,
        numberCompare,
      );
    case "whisperPct":
      return compareNullable(
        left.whisperPct,
        right.whisperPct,
        direction,
        numberCompare,
      );
  }
}

function lastNDays(days: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { start, end };
}

async function loadActivitySafely(
  client: SupabaseClient,
  userIds: string[],
  window: { start: Date; end: Date },
): Promise<ActivityRead> {
  try {
    return await aggregateUserActivity(client, userIds, window);
  } catch (error) {
    console.error("[user-accounts-report] activity lookup unavailable", {
      message: error instanceof Error ? error.message : String(error),
      userCount: userIds.length,
    });
    return { activities: new Map(), truncated: false, unavailable: true };
  }
}

async function aggregateUserActivity(
  client: SupabaseClient,
  userIds: string[],
  window: { start: Date; end: Date },
): Promise<ActivityRead> {
  const { data, error } = await client
    .from("user_video_history")
    .select("user_id, video_id, created_at:accessed_at")
    .in("user_id", userIds)
    .gte("accessed_at", window.start.toISOString())
    .lte("accessed_at", window.end.toISOString())
    .order("accessed_at", { ascending: false })
    .limit(HISTORY_ROW_CAP);
  if (error) {
    throw new QueryError("loadUserAccountsReport:activity", error.message);
  }

  const history = (data ?? []) as ActivityHistoryRow[];
  const truncated = history.length === HISTORY_ROW_CAP;
  if (truncated) {
    console.warn("[user-accounts-report] activity cap hit", {
      cap: HISTORY_ROW_CAP,
      userCount: userIds.length,
    });
  }
  if (history.length === 0) {
    return { activities: new Map(), truncated, unavailable: false };
  }

  const videoIds = Array.from(new Set(history.map((row) => row.video_id)));
  const { data: summaries, error: summaryError } = await client
    .from("summaries")
    .select("video_id, transcript_source")
    .in("video_id", videoIds);
  if (summaryError) {
    throw new QueryError(
      "loadUserAccountsReport:activity-summaries",
      summaryError.message,
    );
  }

  const summaryByVideo = new Map<string, string>();
  for (const summary of (summaries ?? []) as ActivitySummaryRow[]) {
    if (!summaryByVideo.has(summary.video_id)) {
      summaryByVideo.set(
        summary.video_id,
        String(summary.transcript_source),
      );
    }
  }

  const byUser = new Map<
    string,
    { summaries: number; whisper: number; lastSeen: string }
  >();
  for (const row of history) {
    const bucket = byUser.get(row.user_id) ?? {
      summaries: 0,
      whisper: 0,
      lastSeen: row.created_at,
    };
    bucket.summaries += 1;
    if (summaryByVideo.get(row.video_id) === "whisper") bucket.whisper += 1;
    if (row.created_at > bucket.lastSeen) bucket.lastSeen = row.created_at;
    byUser.set(row.user_id, bucket);
  }

  const activities = new Map<string, UserActivity>();
  for (const [userId, bucket] of byUser) {
    activities.set(userId, {
      summaries: bucket.summaries,
      whisper: bucket.whisper,
      lastSeen: bucket.lastSeen,
    });
  }
  return { activities, truncated, unavailable: false };
}

function emptyActivityRead(): ActivityRead {
  return { activities: new Map(), truncated: false, unavailable: false };
}

async function loadExpanded(
  client: SupabaseClient,
  accountId: string,
): Promise<NonNullable<UserAccountsReport["expanded"]>> {
  const [summaries, audit] = await Promise.all([
    loadUserSummaries(client, accountId, SUMMARY_DRILLDOWN_LIMIT),
    loadUserAuditEvents(client, accountId, AUDIT_DRILLDOWN_LIMIT),
  ]);
  return { accountId, summaries, audit };
}

async function loadUserSummaries(
  client: SupabaseClient,
  userId: string,
  limit: number,
): Promise<UserSummaryRow[]> {
  const { data: history, error: historyError } = await client
    .from("user_video_history")
    .select("video_id, created_at:accessed_at")
    .eq("user_id", userId)
    .order("accessed_at", { ascending: false })
    .limit(limit);
  if (historyError) {
    throw new QueryError(
      "loadUserAccountsReport:summaries-history",
      historyError.message,
    );
  }

  const historyRows = (history ?? []) as Array<{
    video_id: string;
    created_at: string;
  }>;
  const videoIds = Array.from(new Set(historyRows.map((row) => row.video_id)));
  if (videoIds.length === 0) return [];

  const [videosResult, summariesResult] = await Promise.all([
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
  if (videosResult.error) {
    throw new QueryError(
      "loadUserAccountsReport:summaries-videos",
      videosResult.error.message,
    );
  }
  if (summariesResult.error) {
    throw new QueryError(
      "loadUserAccountsReport:summaries-data",
      summariesResult.error.message,
    );
  }

  const videoById = new Map<string, Record<string, unknown>>();
  for (const video of (videosResult.data ?? []) as Array<
    Record<string, unknown>
  >) {
    videoById.set(String(video.id), video);
  }

  const summaryByVideo = new Map<string, Record<string, unknown>>();
  for (const summary of (summariesResult.data ?? []) as Array<
    Record<string, unknown>
  >) {
    const videoId = String(summary.video_id);
    if (!summaryByVideo.has(videoId)) summaryByVideo.set(videoId, summary);
  }

  const rows: UserSummaryRow[] = [];
  for (const historyRow of historyRows) {
    const video = videoById.get(historyRow.video_id);
    const summary = summaryByVideo.get(historyRow.video_id);
    const rawSource = (summary?.transcript_source ?? "auto_captions") as string;
    if (!TRANSCRIPT_SOURCES.includes(rawSource as TranscriptSource)) {
      console.warn("[user-accounts-report] unknown transcript_source dropped", {
        videoId: historyRow.video_id,
        rawSource,
      });
      continue;
    }
    rows.push({
      videoId: historyRow.video_id,
      videoTitle: (video?.title as string | null) ?? null,
      videoChannel: (video?.channel_name as string | null) ?? null,
      language: (video?.language as string | null) ?? null,
      source: rawSource as TranscriptSource,
      model: (summary?.model as string | null) ?? null,
      processingTimeSeconds:
        typeof summary?.processing_time_seconds === "number"
          ? summary.processing_time_seconds
          : null,
      pulledAt: historyRow.created_at,
      summaryId: summary ? String(summary.id) : "",
    });
  }
  return rows;
}

async function loadUserAuditEvents(
  client: SupabaseClient,
  userId: string,
  limit: number,
): Promise<UserAuditRow[]> {
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
    .limit(limit);
  if (error) {
    console.error("[user-accounts-report] audit history unavailable", {
      userId,
      message: error.message,
    });
    return [];
  }
  return (data ?? []).map((row) => mapAuditRow(row as Record<string, unknown>));
}

function addWarning(
  warnings: ReportCompletenessWarning[],
  warning: ReportCompletenessWarning,
): void {
  if (!warnings.some((existing) => existing.code === warning.code)) {
    warnings.push(warning);
  }
}
