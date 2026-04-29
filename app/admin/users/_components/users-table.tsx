"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
import type {
  AdminUserRow,
  AuditRow,
  SortDir,
  SortKey,
  UserSummaryRow,
  UsersTab,
} from "@/lib/admin/queries";
import { TABS } from "./filter";

const SOURCE_PILL: Record<TranscriptSource, React.ReactNode> = {
  whisper: <Pill tone="warn">whisper</Pill>,
  auto_captions: <Pill>auto</Pill>,
  manual_captions: <Pill tone="ok">manual</Pill>,
};

const STATUS_PILL: Record<AdminUserRow["status"], React.ReactNode> = {
  active: <Pill tone="ok">active</Pill>,
  anonymous: <Pill>anon</Pill>,
  banned: <Pill tone="warn">banned</Pill>,
  deleted: <Pill tone="warn">deleted</Pill>,
  unverified: <Pill>unverified</Pill>,
};

interface ColumnDef {
  key: SortKey | "user";
  label: string;
  numeric?: boolean;
  sortable: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "user", label: "User", sortable: false },
  { key: "providers", label: "Provider", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "emailVerified", label: "Verified", sortable: true },
  { key: "summaries", label: "Summaries", sortable: true, numeric: true },
  { key: "whisperPct", label: "Whisper%", sortable: true, numeric: true },
  { key: "createdAt", label: "Joined", sortable: true },
  { key: "lastSignIn", label: "Last sign-in", sortable: true },
  { key: "lastActivity", label: "Last activity", sortable: true },
];

interface UsersTableProps {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageCount: number;
  truncated: boolean;
  activeTab: UsersTab;
  activeSort: SortKey;
  activeDir: SortDir;
  expandedUserId: string | null;
  expandedSummaries: UserSummaryRow[];
  expandedAudit: AuditRow[];
}

export function UsersTable({
  rows,
  total,
  page,
  pageCount,
  truncated,
  activeTab,
  activeSort,
  activeDir,
  expandedUserId,
  expandedSummaries,
  expandedAudit,
}: UsersTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [openTranscript, setOpenTranscript] = useState<TranscriptModalTarget | null>(null);

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

  const setTab = (next: UsersTab) => {
    setQuery((p) => {
      if (next === "exclude_anon") p.delete("tab");
      else p.set("tab", next);
      p.delete("expanded");
      p.delete("page");
    });
  };

  const onHeaderClick = (key: SortKey) => {
    setQuery((p) => {
      const currentSort = p.get("sort") ?? "createdAt";
      const currentDir = p.get("dir") === "asc" ? "asc" : "desc";
      let nextDir: SortDir;
      if (currentSort === key) {
        nextDir = currentDir === "asc" ? "desc" : "asc";
      } else {
        nextDir = "desc";
      }
      if (key === "createdAt") p.delete("sort");
      else p.set("sort", key);
      if (nextDir === "desc") p.delete("dir");
      else p.set("dir", nextDir);
      p.delete("expanded");
      p.delete("page");
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
              className={`tab ${activeTab === t.key ? "active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </div>
          ))}
        </div>
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
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={col.numeric ? "num" : undefined}
                  aria-sort={
                    col.sortable && activeSort === col.key
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
                      ? () => onHeaderClick(col.key as SortKey)
                      : undefined
                  }
                >
                  <span className="row gap-4" style={{ alignItems: "center" }}>
                    {col.label}
                    {col.sortable && activeSort === col.key && (
                      activeDir === "asc"
                        ? <ArrowUp size={11} />
                        : <ArrowDown size={11} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length + 1}
                  className="muted"
                  style={{ padding: 24, textAlign: "center" }}
                >
                  No users in this view.
                </td>
              </tr>
            ) : (
              rows.map((u) => {
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
                            idx={hashToIdx(u.email ?? u.userId)}
                            label={(u.email ?? "??").slice(0, 2)}
                          />
                          <span>
                            <div className="email">
                              {u.email ?? <span className="muted">(no email)</span>}
                            </div>
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
                      <td>
                        {u.providers.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className="row gap-4">
                            {u.providers.map((p) => (
                              <Pill key={p}>{p}</Pill>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>{STATUS_PILL[u.status]}</td>
                      <td>
                        {u.emailVerified ? (
                          <Pill tone="ok">yes</Pill>
                        ) : (
                          <span className="muted">no</span>
                        )}
                      </td>
                      <td className="num">{u.summaries}</td>
                      <td className="num">
                        {u.whisperPct > 30 ? (
                          <Pill tone="warn">{u.whisperPct}%</Pill>
                        ) : (
                          <span className="muted tnum">{u.whisperPct}%</span>
                        )}
                      </td>
                      <td className="muted">{formatJoined(u.createdAt)}</td>
                      <td className="muted">{formatRelative(u.lastSignIn)}</td>
                      <td className="muted">{formatRelative(u.lastActivity)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="expand-row">
                        <td colSpan={COLUMNS.length + 1} style={{ padding: 0 }}>
                          <UserExpand
                            user={u}
                            summaries={expandedSummaries}
                            audit={expandedAudit}
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
            Page {page} of {pageCount} · {total.toLocaleString("en-US")} matching
          </span>
          <div className="row gap-6">
            {page > 1 && (
              <Link
                href={buildHref(searchParams, {
                  page: page === 2 ? null : String(page - 1),
                  expanded: null,
                })}
                replace
                style={{ textDecoration: "none" }}
              >
                <Btn size="sm" kind="ghost">Prev</Btn>
              </Link>
            )}
            {page < pageCount && (
              <Link
                href={buildHref(searchParams, {
                  page: String(page + 1),
                  expanded: null,
                })}
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
  audit: AuditRow[];
  onOpenTranscript: (target: TranscriptModalTarget) => void;
}

function UserExpand({ user, summaries, audit, onOpenTranscript }: UserExpandProps) {
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
            <div className="mini-stat-label">Joined</div>
            <div className="mini-stat-value">{formatJoined(user.createdAt)}</div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Last sign-in</div>
            <div className="mini-stat-value">{formatRelative(user.lastSignIn)}</div>
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
            maxHeight: 360,
            overflowY: "auto",
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

        <div className="text-xs muted" style={{ marginTop: 16, marginBottom: 8 }}>
          RECENT AUDIT EVENTS
        </div>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {audit.length === 0 ? (
            <div className="text-sm muted" style={{ padding: 12 }}>
              No admin actions recorded for this user.
            </div>
          ) : (
            audit.map((a, i) => (
              <div
                key={a.id}
                style={{
                  padding: "8px 12px",
                  borderBottom:
                    i < audit.length - 1 ? "1px solid var(--border)" : "none",
                  fontSize: 12,
                }}
              >
                <span className="mono">{a.action}</span>
                {" by "}
                <span className="mono">{a.adminEmail}</span>
                {" · "}
                <span className="muted">{formatRelative(a.createdAt)}</span>
              </div>
            ))
          )}
        </div>

        <details style={{ marginTop: 16 }}>
          <summary
            className="text-xs muted"
            style={{ cursor: "pointer", userSelect: "none" }}
          >
            RAW METADATA
          </summary>
          <div
            style={{
              marginTop: 8,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div>
              <div className="text-xs muted" style={{ marginBottom: 4 }}>
                app_metadata
              </div>
              <pre
                className="mono"
                style={{
                  fontSize: 11,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: 8,
                  overflowX: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(user.appMetadata, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-xs muted" style={{ marginBottom: 4 }}>
                user_metadata
              </div>
              <pre
                className="mono"
                style={{
                  fontSize: 11,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: 8,
                  overflowX: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(user.userMetadata, null, 2)}
              </pre>
            </div>
          </div>
        </details>

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
