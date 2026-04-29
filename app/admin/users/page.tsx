"use client";

import { useState, Fragment } from "react";
import {
  ChevronRight,
  Search,
  Filter,
  Download,
  ExternalLink,
  Info,
  RefreshCcw,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { Avatar, Pill, Btn, Sparkline } from "../_components/atoms";
import { TranscriptModal } from "../_components/transcript-modal";
import type { AdminUser, TranscriptSummary } from "@/lib/admin/types";

// TODO(admin-data): replace mock arrays with service-role queries.
const USERS: AdminUser[] = [
  { id: "8af2e1c0", email: "ben+yt@gmail.example", avIdx: 3, label: "BE", plan: "free", summaries: 113, whisper: 62, p95: 16.8, lastSeen: "3h ago", joined: "Mar 2, 2026", flagged: true, tokens: "412.8k" },
  { id: "2c40b9a3", email: "alex@cortexlabs.dev", avIdx: 1, label: "AL", plan: "pro", summaries: 142, whisper: 14, p95: 9.2, lastSeen: "2m ago", joined: "Jan 18, 2026", tokens: "356.1k" },
  { id: "5e91d22f", email: "mei@hk.gov.example", avIdx: 2, label: "ME", plan: "pro", summaries: 118, whisper: 8, p95: 8.4, lastSeen: "12m ago", joined: "Feb 4, 2026", tokens: "298.4k" },
  { id: "9d31aa07", email: "saanvi@startup.io", avIdx: 4, label: "SA", plan: "free", summaries: 87, whisper: 0, p95: 6.1, lastSeen: "5h ago", joined: "Apr 11, 2026", tokens: "184.0k" },
  { id: "1f08e6bb", email: "ren@studio.jp", avIdx: 5, label: "RE", plan: "pro", summaries: 76, whisper: 21, p95: 11.4, lastSeen: "1d ago", joined: "Feb 22, 2026", tokens: "212.7k" },
  { id: "c73a4811", email: "priya@mlcollective", avIdx: 6, label: "PR", plan: "free", summaries: 64, whisper: 5, p95: 7.8, lastSeen: "1d ago", joined: "Mar 28, 2026", tokens: "162.3k" },
  { id: "3b502fe8", email: "noah@indielab.cc", avIdx: 7, label: "NO", plan: "pro", summaries: 58, whisper: 12, p95: 9.8, lastSeen: "2d ago", joined: "Feb 9, 2026", tokens: "151.0k" },
];

const RECENT_SUMMARIES: TranscriptSummary[] = [
  { title: "The Bitter Lesson — Rich Sutton", channel: "Pioneer Works", lang: "en→en", source: "whisper", model: "claude-opus-4-7", time: 38.4 },
  { title: "GPU memory: a primer for ML eng", channel: "Modal", lang: "en→en", source: "auto_captions", model: "claude-sonnet-4-6", time: 12.1 },
  { title: "Why founders don't focus enough", channel: "Y Combinator", lang: "en→en", source: "manual_captions", model: "claude-haiku-4-5", time: 6.4 },
  { title: "李飞飞 · 视觉智能的下一个十年", channel: "TED", lang: "zh→en", source: "auto_captions", model: "claude-sonnet-4-6", time: 14.2 },
  { title: "Building Anthropic's MCP", channel: "Latent.Space", lang: "en→en", source: "manual_captions", model: "claude-opus-4-7", time: 8.9 },
];

const RECENT_TIMES = ["9 min ago", "47 min ago", "3h ago", "5h ago", "8h ago"];

const TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "flagged", label: "Flagged" },
  { key: "free", label: "Free" },
  { key: "pro", label: "Pro" },
];

export default function AdminUsersPage() {
  const [expanded, setExpanded] = useState<string | null>("8af2e1c0");
  // TODO(admin-data): wire `filter` to actually filter rows once real data lands.
  const [filter, setFilter] = useState("all");
  const [openTranscript, setOpenTranscript] = useState<TranscriptSummary | null>(null);

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-sub">1,284 total · 412 active in last 7 days</p>
        </div>
        <div className="row gap-8">
          <div className="search-input">
            <Search size={13} />
            <input placeholder="Search email or user_id…" />
          </div>
          <Btn size="sm" kind="ghost">
            <Filter size={13} /> Filter
          </Btn>
          <Btn size="sm">
            <Download size={13} /> Export
          </Btn>
        </div>
      </div>

      <div className="page-body">
        <div className="row gap-8" style={{ marginBottom: 14, alignItems: "center" }}>
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
                    · 3
                  </span>
                )}
              </div>
            ))}
          </div>
          <span className="text-sm muted" style={{ marginLeft: "auto" }}>
            Showing 1–7 of 1,284
          </span>
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>User</th>
                <th>Plan</th>
                <th className="num">Summaries · 30d</th>
                <th className="num">Whisper%</th>
                <th className="num">p95</th>
                <th className="num">Tokens</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {USERS.map((u) => (
                <Fragment key={u.id}>
                  <tr
                    className={expanded === u.id ? "expanded" : ""}
                    onClick={() => setExpanded(expanded === u.id ? null : u.id)}
                  >
                    <td>
                      <ChevronRight
                        size={14}
                        style={{
                          color: "var(--text-3)",
                          transform: expanded === u.id ? "rotate(90deg)" : "none",
                          transition: "transform 160ms cubic-bezier(0.32, 0.72, 0, 1)",
                        }}
                      />
                    </td>
                    <td>
                      <div className="user-cell">
                        <Avatar idx={u.avIdx} label={u.label} />
                        <span>
                          <div className="email">{u.email}</div>
                          <div className="uid">{u.id}</div>
                        </span>
                        {u.flagged && (
                          <Pill tone="warn" style={{ marginLeft: 6 }}>
                            <span className="dot" />
                            flagged
                          </Pill>
                        )}
                      </div>
                    </td>
                    <td>{u.plan === "pro" ? <Pill tone="primary">Pro</Pill> : <Pill>Free</Pill>}</td>
                    <td className="num">{u.summaries}</td>
                    <td className="num">
                      {u.whisper > 30 ? (
                        <Pill tone="warn">{u.whisper}%</Pill>
                      ) : (
                        <span className="muted tnum">{u.whisper}%</span>
                      )}
                    </td>
                    <td className="num muted">{u.p95}s</td>
                    <td className="num muted">{u.tokens}</td>
                    <td className="muted">{u.lastSeen}</td>
                  </tr>
                  {expanded === u.id && (
                    <tr className="expand-row">
                      <td colSpan={8} style={{ padding: 0 }}>
                        <UserExpand
                          user={u}
                          openTranscript={(s) => setOpenTranscript(s)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
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
            <span>Showing 1–7 of 1,284</span>
            <div className="row gap-6">
              <Btn size="sm" kind="ghost">Previous</Btn>
              <Btn size="sm" kind="ghost">Next</Btn>
            </div>
          </div>
        </div>
      </div>

      {openTranscript && (
        <TranscriptModal
          summary={openTranscript}
          onClose={() => setOpenTranscript(null)}
        />
      )}
    </div>
  );
}

interface UserExpandProps {
  user: AdminUser;
  openTranscript: (s: TranscriptSummary) => void;
}

function UserExpand({ user, openTranscript }: UserExpandProps) {
  return (
    <div className="expand-panel">
      <div>
        <div className="text-xs muted" style={{ marginBottom: 8 }}>
          30-DAY ACTIVITY
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
              style={{ color: user.whisper > 30 ? "var(--warn)" : undefined }}
            >
              {user.whisper}%
            </div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Avg latency</div>
            <div className="mini-stat-value tnum">{user.p95}s</div>
          </div>
          <div className="mini-stat">
            <div className="mini-stat-label">Tokens</div>
            <div className="mini-stat-value tnum">{user.tokens}</div>
          </div>
        </div>
        <div style={{ marginTop: 12, color: "var(--text-3)" }}>
          <Sparkline
            data={[3, 4, 4, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 7, 9, 10, 9, 11, 10, 12, 11, 9, 10, 11, 12, 13, 11, 10, 12, 11]}
            w={220}
            h={36}
          />
          <div className="text-xs muted" style={{ marginTop: 4 }}>
            summaries / day · last 30d
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
          <span className="text-xs" style={{ color: "var(--primary)", cursor: "pointer" }}>
            View all {user.summaries} →
          </span>
        </div>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
          }}
        >
          {RECENT_SUMMARIES.map((s, i) => (
            <div
              key={i}
              style={{
                padding: "10px 12px",
                borderBottom: i < RECENT_SUMMARIES.length - 1 ? "1px solid var(--border)" : "none",
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
                  {s.title}
                </div>
                <div className="text-xs muted" style={{ marginTop: 2 }}>
                  {s.channel} · {s.lang} · <span className="mono">{s.model}</span> · {s.time}s · {RECENT_TIMES[i]}
                </div>
              </div>
              <div className="row gap-4">
                {s.source === "whisper" && <Pill tone="warn">whisper</Pill>}
                {s.source === "auto_captions" && <Pill>auto</Pill>}
                {s.source === "manual_captions" && <Pill tone="ok">manual</Pill>}
              </div>
              <Btn
                size="sm"
                kind="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  openTranscript(s);
                }}
              >
                View transcript <ExternalLink size={11} />
              </Btn>
            </div>
          ))}
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
          <Btn size="sm" style={{ justifyContent: "flex-start" }}>
            <RefreshCcw size={13} /> Reset rate limit
          </Btn>
          <Btn size="sm" style={{ justifyContent: "flex-start" }}>
            <UserCheck size={13} /> View as user
          </Btn>
          <Btn size="sm" style={{ justifyContent: "flex-start" }}>
            <ExternalLink size={13} /> Open user_id in DB
          </Btn>
          <div className="divider-h" style={{ margin: "4px 0" }} />
          <Btn size="sm" kind="danger" style={{ justifyContent: "flex-start" }}>
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
          <div>Joined · {user.joined}</div>
          <div className="mono" style={{ marginTop: 4 }}>
            user_id {user.id}
          </div>
        </div>
      </div>
    </div>
  );
}
