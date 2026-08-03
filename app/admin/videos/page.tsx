import { Search } from "lucide-react";
import { requireAdminPage } from "../_components/admin-gate";
import { ReportCompletenessNotice } from "../_components/report-completeness";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { loadVideosReport } from "@/lib/admin/videos-report";
import type { VideosReportInput } from "@/lib/admin/report-types";
import {
  isTranscriptSource as isTranscriptSourceValue,
  type TranscriptSource,
} from "@/lib/domain/transcript-source";
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
  return isTranscriptSourceValue(value);
}

export default async function AdminVideosPage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const raw = await searchParams;
  const parsed = parseVideoSearchParams(raw);
  const sourceParam =
    parsed.source && isTranscriptSource(parsed.source) ? parsed.source : null;

  const reportInput: VideosReportInput = {
    mode: parsed.mode,
    windowDays: parsed.windowDays,
    search: parsed.search,
    filters: {
      language: parsed.language,
      source: sourceParam,
      channel: parsed.channel,
      model: parsed.model,
    },
    dateBounds: {
      from: parsed.firstSummarizedFrom,
      to: parsed.firstSummarizedTo,
    },
    sort: parsed.sort,
    direction: parsed.dir,
    pagination: {
      page: parsed.page,
      pageSize: parsed.pageSize || DEFAULT_PAGE_SIZE,
    },
    flaggedOnly: parsed.flaggedOnly,
    expandedVideoId: parsed.expandedVideoId,
  };
  const report = await loadVideosReport(client, reportInput);

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Videos</h1>
          <p className="page-sub">
            {report.insights.totalUniqueVideos.toLocaleString("en-US")} videos
            summarized · across{" "}
            {report.insights.totalSummaries.toLocaleString("en-US")} views
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
        <ReportCompletenessNotice warnings={report.warnings} />
        <VideosInsights insights={report.insights} />
        <VideosTable
          rows={report.list.rows}
          total={report.list.total}
          page={report.list.page}
          pageCount={report.list.pageCount}
          truncated={report.list.truncated}
          activeSort={parsed.sort}
          activeDir={parsed.dir}
          expandedVideoId={report.expandedVideoId}
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
