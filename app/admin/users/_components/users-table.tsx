"use client";
import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { Avatar, Btn, Pill } from "../../_components/atoms";
import { TranscriptModal, type TranscriptModalTarget } from "../../_components/transcript-modal";
import { ReportCompletenessNotice } from "../../_components/report-completeness";
import type { UserAccountsReport, UserAccountsReportInput } from "@/lib/admin/report-types";
import { TABS } from "./filter";
import {
  type UserAccountRow,
  UserExpand,
  formatJoined,
  formatRelative,
} from "./user-account-details";

type UsersTab = UserAccountsReportInput["tab"];

type SortKey = UserAccountsReportInput["sort"];

type SortDir = UserAccountsReportInput["direction"];

const STATUS_PILL: Record<UserAccountRow["status"], React.ReactNode> = {
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
  report: UserAccountsReport;
  activeTab: UsersTab;
  activeSort: SortKey;
  activeDir: SortDir;
}

export function UsersTable({
  report,
  activeTab,
  activeSort,
  activeDir,
}: UsersTableProps) {
  const { rows, total, page, pageCount, truncated } = report;
  const expandedUserId = report.expanded?.accountId ?? null;
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
      <ReportCompletenessNotice warnings={report.warnings} />
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
                          {u.isSmokeAccount && (
                            <Pill tone="warn" style={{ marginLeft: 6 }}>
                              smoke account
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
                        {u.flagged ? (
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
                            summaries={report.expanded?.summaries ?? []}
                            audit={report.expanded?.audit ?? []}
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

function shortenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function hashToIdx(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}
