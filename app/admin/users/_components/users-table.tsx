"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  Info,
  RefreshCcw,
  UserCheck,
} from "lucide-react";
import { Avatar, Btn, Pill, Sparkline } from "../../_components/atoms";
import {
  TranscriptModal,
  type TranscriptModalTarget,
} from "../../_components/transcript-modal";
import type { TranscriptSource } from "@/lib/admin/types";
import type { AdminUserRow, UserSummaryRow } from "@/lib/admin/queries";
import { applyUsersFilter } from "./filter";

const SOURCE_PILL: Record<TranscriptSource, React.ReactNode> = {
  whisper: <Pill tone="warn">whisper</Pill>,
  auto_captions: <Pill>auto</Pill>,
  manual_captions: <Pill tone="ok">manual</Pill>,
};

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "flagged", label: "Flagged" },
];

interface UsersTableProps {
  rows: AdminUserRow[];
  nextCursor: string | null;
  totalApprox: number;
  expandedUserId: string | null;
  expandedSummaries: UserSummaryRow[];
}

export function UsersTable({
  rows,
  nextCursor,
  totalApprox,
  expandedUserId,
  expandedSummaries,
}: UsersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [openTranscript, setOpenTranscript] = useState<TranscriptModalTarget | null>(null);

  const filter = searchParams.get("filter") ?? "all";
  const visibleRows = applyUsersFilter(rows, filter);

  const setQuery = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  };

  const toggleExpanded = (userId: string) => {
    setQuery((p) => {
      if (p.get("expanded") === userId) p.delete("expanded");
      else p.set("expanded", userId);
    });
  };

  const setFilter = (next: string) => {
    setQuery((p) => {
      if (next === "all") p.delete("filter");
      else p.set("filter", next);
      p.delete("expanded");
    });
  };

  return (
    <>
      <div
        className="row gap-8"
        style={{ marginBottom: 14, alignItems: "center" }}
      >
        <div className="tabs">
          {TABS.map((t) => (
            <div
              key={t.key}
              className={`tab ${filter === t.key ? "active" : ""}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
              {t.key === "flagged" && (
                <span className="muted" style={{ marginLeft: 4 }}>
                  · {rows.filter((r) => r.flagged).length}
                </span>
              )}
            </div>
          ))}
        </div>
        <span className="text-sm muted" style={{ marginLeft: "auto" }}>
          {filter === "all"
            ? `Showing ${visibleRows.length} of ${totalApprox.toLocaleString("en-US")}`
            : `Showing ${visibleRows.length} matching this page · ${totalApprox.toLocaleString("en-US")} total`}
        </span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>User</th>
              <th className="num">Summaries</th>
              <th className="num">Whisper%</th>
              <th className="num">p95</th>
              <th>Joined</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="muted"
                  style={{ padding: 24, textAlign: "center" }}
                >
                  No users in this view.
                </td>
              </tr>
            ) : (
              visibleRows.map((u) => {
                const isOpen = expandedUserId === u.userId;
                return (
                  <Fragment key={u.userId}>
                    <tr
                      className={isOpen ? "expanded" : ""}
                      onClick={() => toggleExpanded(u.userId)}
                    >
                      <td>
                        <ChevronRight
                          size={14}
                          style={{
                            color: "var(--text-3)",
                            transform: isOpen ? "rotate(90deg)" : "none",
                            transition:
                              "transform 160ms cubic-bezier(0.32, 0.72, 0, 1)",
                          }}
                        />
                      </td>
                      <td>
                        <div className="user-cell">
                          <Avatar
                            idx={hashToIdx(u.email)}
                            label={u.email.slice(0, 2)}
                          />
                          <span>
                            <div className="email">{u.email}</div>
                            <div className="uid">{shortenId(u.userId)}</div>
                          </span>
                          {u.flagged && (
                            <Pill tone="warn" style={{ marginLeft: 6 }}>
                              <span className="dot" />
                              flagged
                            </Pill>
                          )}
                        </div>
                      </td>
                      <td className="num">{u.summaries}</td>
                      <td className="num">
                        {u.whisperPct > 30 ? (
                          <Pill tone="warn">{u.whisperPct}%</Pill>
                        ) : (
                          <span className="muted tnum">{u.whisperPct}%</span>
                        )}
                      </td>
                      <td className="num muted">
                        {u.p95Seconds == null ? "—" : `${u.p95Seconds.toFixed(1)}s`}
                      </td>
                      <td className="muted">{formatJoined(u.createdAt)}</td>
                      <td className="muted">{formatRelative(u.lastSeen)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="expand-row">
                        <td colSpan={7} style={{ padding: 0 }}>
                          <UserExpand
                            user={u}
                            summaries={expandedSummaries}
                            onOpenTranscript={setOpenTranscript}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "var(--text-3)",
          }}
        >
          <span>
            {visibleRows.length} shown · {totalApprox.toLocaleString("en-US")} total
          </span>
          <div className="row gap-6">
            <PrevLink />
            {nextCursor && (
              <Link
                href={buildHref(searchParams, { cursor: nextCursor, expanded: null })}
                replace
                style={{ textDecoration: "none" }}
              >
                <Btn size="sm" kind="ghost">Next</Btn>
              </Link>
            )}
          </div>
        </div>
      </div>

      {openTranscript && (
        <TranscriptModal
          target={openTranscript}
          onClose={() => setOpenTranscript(null)}
        />
      )}
    </>
  );
}

function PrevLink() {
  const searchParams = useSearchParams();
  const cursor = searchParams.get("cursor");
  if (!cursor) return null;
  // No page stack kept; "First page" resets the cursor rather than walking
  // back one page. Acceptable for an admin tool; if operators ask for a
  // back-button, store recent cursors in URL state.
  return (
    <Link
      href={buildHref(searchParams, { cursor: null, expanded: null })}
      replace
      style={{ textDecoration: "none" }}
    >
      <Btn size="sm" kind="ghost">First page</Btn>
    </Link>
  );
}

function buildHref(
  searchParams: URLSearchParams | ReturnType<typeof useSearchParams>,
  patch: Record<string, string | null>,
): string {
  const params = new URLSearchParams(searchParams.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

interface UserExpandProps {
  user: AdminUserRow;
  summaries: UserSummaryRow[];
  onOpenTranscript: (target: TranscriptModalTarget) => void;
}

function UserExpand({ user, summaries, onOpenTranscript }: UserExpandProps) {
  const sparkline = sparklineFromSummaries(summaries);

  return (
    <div className="expand-panel">
      <div>
        <div className="text-xs muted" style={{ marginBottom: 8 }}>
          ACTIVITY
        </div>
        <div className="mini-stat-row">
          <div className="mini-stat">
            <div className="mini-stat-label">Summaries</div>
            <div className="mini-stat-value tnum">{user.summaries}</div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Whisper rate</div>
            <div
              className="mini-stat-value tnum"
              style={{ color: user.whisperPct > 30 ? "var(--warn)" : undefined }}
            >
              {user.whisperPct}%
            </div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">p95 latency</div>
            <div className="mini-stat-value tnum">
              {user.p95Seconds == null ? "—" : `${user.p95Seconds.toFixed(1)}s`}
            </div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Joined</div>
            <div className="mini-stat-value">{formatJoined(user.createdAt)}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, color: "var(--text-3)" }}>
          {sparkline.length > 0 ? (
            <Sparkline data={sparkline} w={220} h={36} />
          ) : (
            <div className="text-xs muted">No recent activity to chart.</div>
          )}
          <div className="text-xs muted" style={{ marginTop: 4 }}>
            recent summaries
          </div>
        </div>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <div className="text-xs muted">RECENT SUMMARIES</div>
          {user.summaries > summaries.length && (
            <span className="text-xs" style={{ color: "var(--primary)" }}>
              {user.summaries} total
            </span>
          )}
        </div>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {summaries.length === 0 ? (
            <div className="text-sm muted" style={{ padding: 12 }}>
              No summaries pulled in the activity window.
            </div>
          ) : (
            summaries.map((s, i) => (
              <div
                key={`${s.summaryId}-${s.pulledAt}`}
                style={{
                  padding: "10px 12px",
                  borderBottom:
                    i < summaries.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.videoTitle ?? "(untitled video)"}
                  </div>
                  <div className="text-xs muted" style={{ marginTop: 2 }}>
                    {s.videoChannel ?? "—"} · {s.language ?? "?"} ·{" "}
                    <span className="mono">{s.model ?? "?"}</span> ·{" "}
                    {s.processingTimeSeconds == null
                      ? "—"
                      : `${s.processingTimeSeconds.toFixed(1)}s`}{" "}
                    · {formatRelative(s.pulledAt)}
                  </div>
                </div>
                <div className="row gap-4">{SOURCE_PILL[s.source]}</div>
                <Btn
                  size="sm"
                  kind="ghost"
                  disabled={!s.summaryId}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!s.summaryId) return;
                    onOpenTranscript({
                      summaryId: s.summaryId,
                      viewedUserId: user.userId,
                      videoTitle: s.videoTitle,
                      channel: s.videoChannel,
                      language: s.language,
                      source: s.source,
                      model: s.model,
                      processingTimeSeconds: s.processingTimeSeconds,
                    });
                  }}
                >
                  View transcript <ExternalLink size={11} />
                </Btn>
              </div>
            ))
          )}
        </div>
        <div
          className="text-xs muted"
          style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Info size={12} /> Aggregate stats above are not audit-logged. Opening a transcript writes an audit row.
        </div>
      </div>

      <div>
        <div className="text-xs muted" style={{ marginBottom: 8 }}>
          ACTIONS
        </div>
        <div className="col gap-6">
          <Btn size="sm" style={{ justifyContent: "flex-start" }} disabled>
            <RefreshCcw size={13} /> Reset rate limit
          </Btn>
          <Btn size="sm" style={{ justifyContent: "flex-start" }} disabled>
            <UserCheck size={13} /> View as user
          </Btn>
          <Btn size="sm" style={{ justifyContent: "flex-start" }} disabled>
            <ExternalLink size={13} /> Open user_id in DB
          </Btn>
          <div className="divider-h" style={{ margin: "4px 0" }} />
          <Btn
            size="sm"
            kind="danger"
            style={{ justifyContent: "flex-start" }}
            disabled
          >
            <AlertTriangle size={13} /> Suspend account
          </Btn>
        </div>
        <div
          className="text-xs muted"
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div>Joined · {formatJoined(user.createdAt)}</div>
          <div className="mono" style={{ marginTop: 4 }}>
            user_id {user.userId}
          </div>
        </div>
      </div>
    </div>
  );
}

function sparklineFromSummaries(rows: UserSummaryRow[]): number[] {
  if (rows.length === 0) return [];
  // 14-day bucket count of summaries pulled.
  const days = 14;
  const buckets = Array.from({ length: days }, () => 0);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const r of rows) {
    const t = new Date(r.pulledAt);
    if (Number.isNaN(t.getTime())) continue;
    const dayDiff = Math.floor((today.getTime() - t.getTime()) / 86_400_000);
    if (dayDiff >= 0 && dayDiff < days) buckets[days - 1 - dayDiff] += 1;
  }
  return buckets;
}

function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toISOString().slice(0, 10);
}

function shortenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function hashToIdx(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}
