"use client";
import { AlertTriangle, ExternalLink, Info, RefreshCcw, UserCheck } from "lucide-react";
import { Btn, Pill, Sparkline } from "../../_components/atoms";
import { type TranscriptModalTarget } from "../../_components/transcript-modal";
import type { UserAccountsReport } from "@/lib/admin/report-types";

export type UserAccountRow = UserAccountsReport["rows"][number];

type UserSummaryRow = NonNullable<
  UserAccountsReport["expanded"]
>["summaries"][number];

type UserAuditRow = NonNullable<UserAccountsReport["expanded"]>["audit"][number];

type TranscriptSource = UserSummaryRow["source"];

const SOURCE_PILL: Record<TranscriptSource, React.ReactNode> = {
  whisper: <Pill tone="warn">whisper</Pill>,
  auto_captions: <Pill>auto</Pill>,
  manual_captions: <Pill tone="ok">manual</Pill>,
};

interface UserExpandProps {
  user: UserAccountRow;
  summaries: UserSummaryRow[];
  audit: UserAuditRow[];
  onOpenTranscript: (target: TranscriptModalTarget) => void;
}

export function UserExpand({ user, summaries, audit, onOpenTranscript }: UserExpandProps) {
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
              style={{ color: user.flagged ? "var(--warn)" : undefined }}
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

export function formatJoined(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatRelative(iso: string | null): string {
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
