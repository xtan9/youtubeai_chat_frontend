import { Search } from "lucide-react";
import { requireAdminPage } from "../_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import {
  ALL_SOURCES,
  listVideosWithStats,
  getVideoInsights,
  listAdminUserIds,
  lastNDays,
  type VideoListOptions,
  type TimeWindow,
} from "@/lib/admin/queries";
import type { TranscriptSource } from "@/lib/admin/types";
import {
  parseVideoSearchParams,
  DEFAULT_PAGE_SIZE,
} from "./_components/filter";
import { VideosInsights } from "./_components/videos-insights";
import { VideosTable } from "./_components/videos-table";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function isTranscriptSource(value: string): value is TranscriptSource {
  return (ALL_SOURCES as readonly string[]).includes(value);
}

export default async function AdminVideosPage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const raw = await searchParams;
  const parsed = parseVideoSearchParams(raw);
  const adminIds = await listAdminUserIds(client);

  const window: TimeWindow | undefined =
    parsed.mode === "trending" ? lastNDays(parsed.windowDays) : undefined;

  const sourceParam =
    parsed.source && isTranscriptSource(parsed.source) ? parsed.source : null;

  const listOpts: VideoListOptions = {
    mode: parsed.mode,
    window,
    sort: parsed.sort,
    dir: parsed.dir,
    search: parsed.search,
    language: parsed.language,
    source: sourceParam,
    channel: parsed.channel,
    model: parsed.model,
    flaggedOnly: parsed.flaggedOnly,
    firstSummarizedFrom: parsed.firstSummarizedFrom,
    firstSummarizedTo: parsed.firstSummarizedTo,
    page: parsed.page,
    pageSize: parsed.pageSize || DEFAULT_PAGE_SIZE,
    excludeAdminUserIds: adminIds,
  };

  const [list, insights] = await Promise.all([
    listVideosWithStats(client, listOpts),
    getVideoInsights(client, {
      mode: parsed.mode,
      window,
      excludeAdminUserIds: adminIds,
    }),
  ]);

  const expandedVideoId =
    parsed.expandedVideoId &&
    list.rows.some((r) => r.videoId === parsed.expandedVideoId)
      ? parsed.expandedVideoId
      : null;

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Videos</h1>
          <p className="page-sub">
            {insights.totalUniqueVideos.toLocaleString("en-US")} videos
            summarized · across{" "}
            {insights.totalSummaries.toLocaleString("en-US")} views
            {parsed.mode === "trending" && (
              <span className="muted">
                {" "}
                · trending · last {parsed.windowDays}d
              </span>
            )}
          </p>
        </div>
        <div className="row gap-8">
          <ModeToggle mode={parsed.mode} windowDays={parsed.windowDays} />
          <form method="get" className="search-input" action="/admin/videos">
            <Search size={13} />
            <input
              name="q"
              defaultValue={raw.q ?? ""}
              placeholder="Search title or channel…"
            />
            {parsed.mode === "trending" && (
              <input type="hidden" name="mode" value="trending" />
            )}
            {parsed.mode === "trending" && (
              <input
                type="hidden"
                name="window"
                value={String(parsed.windowDays)}
              />
            )}
          </form>
        </div>
      </div>

      <div className="page-body">
        <VideosInsights insights={insights} />
        <VideosTable
          rows={list.rows}
          total={list.total}
          page={list.page}
          pageCount={list.pageCount}
          truncated={list.truncated}
          activeSort={parsed.sort}
          activeDir={parsed.dir}
          expandedVideoId={expandedVideoId}
        />
      </div>
    </div>
  );
}

function ModeToggle({
  mode,
  windowDays,
}: {
  mode: "all_time" | "trending";
  windowDays: number;
}) {
  return (
    <div className="row gap-4">
      <a
        href="/admin/videos?mode=all_time"
        className={mode === "all_time" ? "btn-active" : "btn"}
      >
        All-time
      </a>
      <a
        href={`/admin/videos?mode=trending&window=${windowDays}`}
        className={mode === "trending" ? "btn-active" : "btn"}
      >
        Trending {windowDays}d
      </a>
    </div>
  );
}
