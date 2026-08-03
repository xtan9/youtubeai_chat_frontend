import type { TranscriptSource } from "@/lib/domain/transcript-source";
import type { ReportCompletenessWarning } from "./report-completeness";

/** Serializable intent and output contracts shared by Admin routes/components. */

export interface AdminShellInput {
  allowlist: readonly string[];
}

export interface AdminShellResult {
  /** Null means the registered-account count could not be read. */
  usersTotal: number | null;
  warnings: ReportCompletenessWarning[];
}

export interface DashboardReportInput {
  windowDays: number;
  includeAdministrators: boolean;
}

export interface DashboardReportWindow {
  start: string;
  end: string;
}

export interface DashboardDailyPoint {
  day: string;
  value: number;
}

export interface DashboardTopUserStat {
  userId: string;
  email: string | null;
  emailLookupOk: boolean;
  summaries: number;
  whisperPct: number;
  p95Seconds: number | null;
  lastSeen: string | null;
  flagged: boolean;
}

export interface DashboardKpiDelta {
  current: number;
  previous: number;
}

export interface DashboardReport {
  window: DashboardReportWindow;
  summaries: DashboardKpiDelta;
  whisper: DashboardKpiDelta;
  p95Seconds: { current: number | null; previous: number | null };
  transcribeP95Seconds: number | null;
  summarizeP95Seconds: number | null;
  cacheHitRatePct: { current: number | null; previous: number | null };
  summariesPerDay: DashboardDailyPoint[];
  dauPerDay: DashboardDailyPoint[];
  cacheHitPerDay: DashboardDailyPoint[];
  sourceMix: { source: TranscriptSource; count: number }[];
  topUsers: DashboardTopUserStat[];
  warnings: ReportCompletenessWarning[];
}

export interface PerformanceReportInput {
  windowDays: number;
  includeAdministrators: boolean;
}

export interface PerformanceReport {
  window: { start: string; end: string };
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
  latencyByBucket: { day: string; p95Seconds: number | null }[];
  warnings: ReportCompletenessWarning[];
}

export type UserAccountsTab =
  | "exclude_anon"
  | "anon_only"
  | "active"
  | "flagged"
  | "all";
export type UserAccountsSort =
  | "email"
  | "providers"
  | "status"
  | "emailVerified"
  | "createdAt"
  | "lastSignIn"
  | "lastActivity"
  | "summaries"
  | "whisperPct";
export type UserAccountsDirection = "asc" | "desc";
export type UserStatus =
  | "active"
  | "anonymous"
  | "banned"
  | "deleted"
  | "unverified";

export interface UserAccountReportRow {
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

export interface UserSummaryReportRow {
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

export interface UserAuditReportRow {
  id: string;
  createdAt: string;
  adminId: string;
  adminEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
}

export interface UserAccountsReportInput {
  search: string | null;
  tab: UserAccountsTab;
  sort: UserAccountsSort;
  direction: UserAccountsDirection;
  page: number;
  expandedAccountId: string | null;
}

export interface UserAccountsReport {
  rows: UserAccountReportRow[];
  total: number;
  truncated: boolean;
  page: number;
  pageCount: number;
  activeOnPage: number;
  expanded: {
    accountId: string;
    summaries: UserSummaryReportRow[];
    audit: UserAuditReportRow[];
  } | null;
  warnings: ReportCompletenessWarning[];
}

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
  firstSummarizedAt: string;
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
  adminFilterIncomplete: boolean;
}

export interface VideosReport {
  list: VideoReportList;
  insights: VideoReportInsights;
  expandedVideoId: string | null;
  warnings: ReportCompletenessWarning[];
}

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

export interface AuditReportInput {
  cursor?: string | null;
  pageSize?: number;
}

export interface AuditReport {
  rows: AuditRow[];
  nextCursor: string | null;
}
