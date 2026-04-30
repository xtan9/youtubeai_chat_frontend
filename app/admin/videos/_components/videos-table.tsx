"use client";

import { Fragment, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Pill } from "../../_components/atoms";
import type {
  AdminVideoRow,
  VideoSortKey,
  SortDir,
} from "@/lib/admin/queries";
import type { TranscriptSource } from "@/lib/admin/types";
import { VideoRowExpansion } from "./video-row-expansion";

interface ColumnDef {
  key: VideoSortKey | "title";
  label: string;
  numeric?: boolean;
  sortable: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "title", label: "Title", sortable: true },
  { key: "channelName", label: "Channel", sortable: true },
  { key: "language", label: "Lang", sortable: true },
  { key: "distinctUsers", label: "Users", sortable: true, numeric: true },
  { key: "totalSummaries", label: "Views", sortable: true, numeric: true },
  { key: "whisperPct", label: "Whisper%", sortable: true, numeric: true },
  { key: "firstSummarizedAt", label: "First summ.", sortable: true },
  { key: "lastSummarizedAt", label: "Last", sortable: true },
  { key: "durationSeconds", label: "Duration", sortable: true, numeric: true },
];

interface VideosTableProps {
  rows: AdminVideoRow[];
  total: number;
  page: number;
  pageCount: number;
  truncated: boolean;
  activeSort: VideoSortKey;
  activeDir: SortDir;
  expandedVideoId: string | null;
}

export function VideosTable({
  rows,
  total,
  page,
  pageCount,
  truncated,
  activeSort,
  activeDir,
  expandedVideoId,
}: VideosTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const setQuery = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname),
    );
  };

  const toggleExpanded = (videoId: string) => {
    setQuery((p) => {
      if (p.get("expanded") === videoId) p.delete("expanded");
      else p.set("expanded", videoId);
    });
  };

  const onHeaderClick = (key: VideoSortKey) => {
    setQuery((p) => {
      const currentSort = p.get("sort") ?? "distinctUsers";
      const currentDir = p.get("dir") === "asc" ? "asc" : "desc";
      let nextDir: SortDir;
      if (currentSort === key) {
        nextDir = currentDir === "asc" ? "desc" : "asc";
      } else {
        nextDir = "desc";
      }
      if (key === "distinctUsers") p.delete("sort");
      else p.set("sort", key);
      if (nextDir === "desc") p.delete("dir");
      else p.set("dir", nextDir);
      p.delete("expanded");
      p.delete("page");
    });
  };

  const setPage = (next: number) => {
    setQuery((p) => {
      if (next <= 1) p.delete("page");
      else p.set("page", String(next));
      p.delete("expanded");
    });
  };

  return (
    <>
      {truncated && (
        <div
          className="banner-warn"
          style={{
            padding: "8px 12px",
            border: "1px solid var(--warn)",
            background: "var(--surface-2)",
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 12,
          }}
        >
          Capped at 25,000 videos — sort/filter applied to the first 25,000.
        </div>
      )}
      <div
        className="row gap-8"
        style={{ marginBottom: 12, alignItems: "center" }}
      >
        <span className="text-sm muted" style={{ marginLeft: "auto" }}>
          Showing {rows.length} of {total.toLocaleString("en-US")}
          {truncated && " (capped)"}
        </span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              {COLUMNS.map((col) => {
                const sortKey = col.key === "title" ? "title" : col.key;
                const isActive = activeSort === sortKey;
                return (
                  <th
                    key={col.key}
                    className={col.numeric ? "num" : undefined}
                    aria-sort={
                      col.sortable && isActive
                        ? activeDir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    style={
                      col.sortable
                        ? { cursor: "pointer", userSelect: "none" }
                        : undefined
                    }
                    onClick={
                      col.sortable
                        ? () => onHeaderClick(sortKey as VideoSortKey)
                        : undefined
                    }
                  >
                    <span
                      className="row gap-4"
                      style={{ alignItems: "center" }}
                    >
                      {col.label}
                      {col.sortable && isActive && (
                        activeDir === "asc"
                          ? <ArrowUp size={11} />
                          : <ArrowDown size={11} />
                      )}
                    </span>
                  </th>
                );
              })}
              <th>Source mix</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 2}
                  className="muted"
                  style={{ textAlign: "center", padding: 24 }}
                >
                  No videos match these filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isExpanded = expandedVideoId === row.videoId;
                return (
                  <Fragment key={row.videoId}>
                    <tr
                      className={isExpanded ? "expanded" : undefined}
                      onClick={() => toggleExpanded(row.videoId)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ paddingLeft: 12 }}>
                        {isExpanded
                          ? <ChevronDown size={12} />
                          : <ChevronRight size={12} />}
                      </td>
                      <td>{row.title ?? "(untitled)"}</td>
                      <td className="muted">{row.channelName ?? "—"}</td>
                      <td className="muted">{row.language ?? "—"}</td>
                      <td className="num">{row.distinctUsers}</td>
                      <td className="num">{row.totalSummaries}</td>
                      <td className="num">
                        {row.flagged
                          ? <Pill tone="warn">{row.whisperPct}%</Pill>
                          : <span className="muted">{row.whisperPct}%</span>}
                      </td>
                      <td className="muted">
                        {row.firstSummarizedAt.slice(0, 10)}
                      </td>
                      <td className="muted">
                        {row.lastSummarizedAt.slice(0, 10)}
                      </td>
                      <td className="num muted">
                        {formatDuration(row.durationSeconds)}
                      </td>
                      <td>
                        <SourceMixCell mix={row.sourceMix} />
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={COLUMNS.length + 2} style={{ padding: 0 }}>
                          <VideoRowExpansion row={row} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div
        className="row gap-8"
        style={{
          marginTop: 12,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn"
          onClick={() => setPage(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          ← prev
        </button>
        <span className="muted text-sm">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => setPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
        >
          next →
        </button>
      </div>
    </>
  );
}

function SourceMixCell({
  mix,
}: {
  mix: { source: TranscriptSource; count: number }[];
}) {
  if (mix.length === 0) return <span className="muted">—</span>;
  return (
    <div className="row gap-4">
      {mix.map((m) => (
        <Pill key={m.source} tone={m.source === "whisper" ? "warn" : undefined}>
          {labelForSource(m.source)}: {m.count}
        </Pill>
      ))}
    </div>
  );
}

function labelForSource(s: TranscriptSource): string {
  return s === "whisper"
    ? "whpr"
    : s === "manual_captions"
      ? "manual"
      : "auto";
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
