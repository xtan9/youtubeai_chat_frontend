import {
  VIDEOS_PAGE_SIZE_CAP,
  type VideoSortKey,
  type VideoMode,
  type SortDir,
} from "@/lib/admin/queries";

export const DEFAULT_MODE: VideoMode = "all_time";
export const DEFAULT_SORT: VideoSortKey = "distinctUsers";
export const DEFAULT_DIR: SortDir = "desc";
export const DEFAULT_PAGE_SIZE = 25;
/** Re-export under the parser-local name so the rest of the page (and
 * the test suite) keeps a stable import path while the canonical value
 * is owned by `lib/admin/queries.ts` (server-side cap). */
export const MAX_PAGE_SIZE: number = VIDEOS_PAGE_SIZE_CAP;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 30;

const KNOWN_SORT: ReadonlySet<VideoSortKey> = new Set([
  "distinctUsers",
  "totalSummaries",
  "title",
  "channelName",
  "language",
  "firstSummarizedAt",
  "lastSummarizedAt",
  "whisperPct",
  "p95ProcessingSeconds",
  "durationSeconds",
]);

export function parseMode(v: string | undefined): VideoMode {
  return v === "trending" ? "trending" : DEFAULT_MODE;
}

export function parseVideoSort(v: string | undefined): VideoSortKey {
  return v && (KNOWN_SORT as Set<string>).has(v)
    ? (v as VideoSortKey)
    : DEFAULT_SORT;
}

export function parseVideoDir(v: string | undefined): SortDir {
  return v === "asc" ? "asc" : DEFAULT_DIR;
}

export function parsePage(v: string | undefined): number {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function parsePageSize(v: string | undefined): number {
  const n = Number.parseInt(v ?? String(DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

export function parseWindowDaysParam(v: string | undefined): number {
  const n = Number.parseInt(v ?? String(DEFAULT_WINDOW_DAYS), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(n, MAX_WINDOW_DAYS);
}

export interface ParsedVideoParams {
  mode: VideoMode;
  windowDays: number;
  sort: VideoSortKey;
  dir: SortDir;
  search: string | null;
  language: string | null;
  source: string | null;
  channel: string | null;
  model: string | null;
  flaggedOnly: boolean;
  firstSummarizedFrom: string | null;
  firstSummarizedTo: string | null;
  page: number;
  pageSize: number;
  expandedVideoId: string | null;
}

export function parseVideoSearchParams(
  params: Record<string, string | undefined>,
): ParsedVideoParams {
  return {
    mode: parseMode(params.mode),
    windowDays: parseWindowDaysParam(params.window),
    sort: parseVideoSort(params.sort),
    dir: parseVideoDir(params.dir),
    search: params.q?.trim() || null,
    language: params.lang?.trim() || null,
    source: params.source?.trim() || null,
    channel: params.channel?.trim() || null,
    model: params.model?.trim() || null,
    flaggedOnly: params.flagged === "1",
    firstSummarizedFrom: params.from?.trim() || null,
    firstSummarizedTo: params.to?.trim() || null,
    page: parsePage(params.page),
    pageSize: parsePageSize(params.pageSize),
    expandedVideoId: params.expanded?.trim() || null,
  };
}
