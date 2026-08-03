import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
} from "lucide-react";
import {
  Avatar,
  Pill,
  Btn,
  AreaChart,
  BarChart,
  Donut,
} from "./_components/atoms";
import { DashboardControls } from "./_components/dashboard-controls";
import { parseWindowDays } from "./_components/window-days";
import { requireAdminPage } from "./_components/admin-gate";
import { ReportCompletenessNotice } from "./_components/report-completeness";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import {
  loadDashboardReport,
  type DashboardReport,
} from "@/lib/admin/dashboard-report";
import type { Delta, TranscriptSource } from "@/lib/admin/types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ window?: string; include_admins?: string }>;
}

export default async function AdminDashboardPage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );

  const params = await searchParams;
  const windowDays = parseWindowDays(params.window);
  const includeAdmins = params.include_admins === "1";
  const report = await loadDashboardReport(client, {
    windowDays,
    includeAdministrators: includeAdmins,
  });

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            {formatRange(report.window)} · compared to previous {windowDays} days ·{" "}
            <span className="muted">
              {includeAdmins ? "including admins" : "excluding admin activity"}
            </span>
          </p>
        </div>
        <DashboardControls windowDays={windowDays} includeAdmins={includeAdmins} />
      </div>

      <div className="page-body">
        <ReportCompletenessNotice warnings={report.warnings} />
        <div className="kpi-grid cols-2" style={{ marginBottom: 16 }}>
          <HeroKPI
            label="Summaries"
            value={formatCount(report.summaries.current)}
            delta={pctDelta(report.summaries.current, report.summaries.previous)}
            sub={summariesSub(report)}
            data={report.summariesPerDay.map((d) => d.value)}
            color="var(--text)"
          />
          <HeroKPI
            label="p95 latency"
            value={formatSeconds(report.p95Seconds.current)}
            delta={absDeltaSeconds(
              report.p95Seconds.current,
              report.p95Seconds.previous,
            )}
            sub={latencySub(report)}
            data={report.summariesPerDay.map(() => report.p95Seconds.current ?? 0)}
            color="var(--warn)"
          />
        </div>

        <div className="kpi-grid cols-3">
          <ChartCard
            title="Daily active users"
            sub={`DAU · last ${windowDays}d`}
            footer={`Range avg · ${avg(report.dauPerDay.map((d) => d.value)).toFixed(0)}`}
            chart={
              <BarChart
                data={report.dauPerDay.map((d) => d.value)}
                h={140}
                accentIndex={report.dauPerDay.length - 1}
              />
            }
          />
          <DonutCard sourceMix={report.sourceMix} />
          <ChartCard
            title="Cache hit rate"
            sub={`last ${windowDays}d · ${formatPct(report.cacheHitRatePct.current)} avg`}
            footer={cacheHitFooter(report)}
            chart={
              <AreaChart
                data={report.cacheHitPerDay.map((d) => d.value)}
                h={140}
                lineClass="chart-line-primary"
                fillClass="chart-fill-primary"
              />
            }
          />
        </div>

        <div className="section-h">
          <h3 className="section-title">Top users · last {windowDays} days</h3>
          <Link
            href="/admin/users"
            className="text-sm"
            style={{
              color: "var(--primary)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            View all users <ArrowUpRight size={11} />
          </Link>
        </div>
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>User</th>
                <th className="num">Summaries</th>
                <th className="num">Whisper%</th>
                <th className="num">p95</th>
                <th>Last seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {report.topUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="muted"
                    style={{ padding: 24, textAlign: "center" }}
                  >
                    No user activity in this window.
                  </td>
                </tr>
              ) : (
                report.topUsers.map((u) => (
                  <tr key={u.userId}>
                    <td>
                      <div className="user-cell">
                        <Avatar
                          idx={hashToIdx(u.email ?? u.userId)}
                          label={(u.email ?? u.userId).slice(0, 2)}
                        />
                        <span className="email">{u.email ?? u.userId}</span>
                        {u.flagged && (
                          <Pill tone="warn" style={{ marginLeft: 4 }}>
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
                        <span className="muted">{u.whisperPct}%</span>
                      )}
                    </td>
                    <td className="num muted">{formatSeconds(u.p95Seconds)}</td>
                    <td className="muted">{formatRelative(u.lastSeen)}</td>
                    <td>
                      <ChevronRight
                        size={14}
                        style={{ color: "var(--text-3)" }}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface HeroKPIProps {
  label: string;
  value: string;
  delta: { text: string; tone: Delta };
  sub: string;
  data: number[];
  color: string;
}

function HeroKPI({ label, value, delta, sub, data, color }: HeroKPIProps) {
  const ArrowIcon =
    delta.tone === "down" ? ArrowDown : delta.tone === "flat" ? null : ArrowUp;
  return (
    <div className="kpi" style={{ padding: "20px 22px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value" style={{ fontSize: 36, marginTop: 6 }}>
            {value}
          </div>
          <div className="kpi-row">
            <span className={`kpi-delta ${delta.tone}`}>
              {ArrowIcon && <ArrowIcon size={12} />}
              {delta.text}
            </span>
            <span>{sub}</span>
          </div>
        </div>
        <Btn size="sm" kind="ghost" aria-label="More">
          <MoreHorizontal size={14} />
        </Btn>
      </div>
      <div style={{ marginTop: 14, height: 110, color }}>
        <AreaChart
          data={data}
          h={110}
          grid
          fillClass="chart-fill"
          lineClass="chart-line"
          color={color}
        />
      </div>
    </div>
  );
}

interface ChartCardProps {
  title: string;
  sub: string;
  footer?: string;
  chart: React.ReactNode;
}

function ChartCard({ title, sub, footer, chart }: ChartCardProps) {
  return (
    <div className="card">
      <div style={{ padding: "14px 18px 10px" }}>
        <div className="card-title">{title}</div>
        <div className="card-sub">{sub}</div>
      </div>
      <div style={{ padding: "0 14px 14px" }}>{chart}</div>
      {footer && (
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            fontSize: 12,
            color: "var(--text-3)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{footer}</span>
          <ExternalLink size={12} />
        </div>
      )}
    </div>
  );
}

const SOURCE_COLOR: Record<TranscriptSource, string> = {
  manual_captions: "var(--text)",
  auto_captions: "var(--text-2)",
  whisper: "var(--warn)",
};

const SOURCE_LABEL: Record<TranscriptSource, string> = {
  manual_captions: "Manual captions",
  auto_captions: "Auto captions",
  whisper: "Whisper",
};

function DonutCard({ sourceMix }: { sourceMix: DashboardReport["sourceMix"] }) {
  const total = sourceMix.reduce((sum, m) => sum + m.count, 0);
  const segs = sourceMix.map((m) => ({
    label: SOURCE_LABEL[m.source],
    value: total > 0 ? Math.round((m.count / total) * 100) : 0,
    color: SOURCE_COLOR[m.source],
  }));
  return (
    <div className="card">
      <div style={{ padding: "14px 18px 10px" }}>
        <div className="card-title">Transcript source</div>
        <div className="card-sub">{total > 0 ? `${total} summaries` : "no data"}</div>
      </div>
      <div
        style={{
          padding: "0 18px 18px",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 18,
          alignItems: "center",
        }}
      >
        <Donut size={130} segments={segs} />
        <div className="donut-legend">
          {segs.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "center" }}>
              <span>
                <span className="swatch" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tnum text-2">{s.value}%</span>
            </div>
          ))}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              marginTop: 6,
              paddingTop: 6,
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            Whisper is the cost lever — manual/auto are free.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function formatRange(window: DashboardReport["window"]): string {
  const start = new Date(window.start);
  const end = new Date(window.end);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}, ${end.getUTCFullYear()}`;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function formatSeconds(s: number | null): string {
  if (s == null) return "—";
  return `${s.toFixed(1)}s`;
}

function formatPct(n: number | null): string {
  if (n == null) return "—";
  return `${n}%`;
}

function pctDelta(curr: number, prev: number): { text: string; tone: Delta } {
  if (prev === 0) {
    if (curr === 0) return { text: "0%", tone: "flat" };
    return { text: "new", tone: "up" };
  }
  const pct = Math.round(((curr - prev) / prev) * 1000) / 10;
  if (pct === 0) return { text: "0.0%", tone: "flat" };
  const sign = pct > 0 ? "+" : "";
  return {
    text: `${sign}${pct.toFixed(1)}%`,
    tone: pct > 0 ? "up" : "down",
  };
}

function absDeltaSeconds(
  curr: number | null,
  prev: number | null,
): { text: string; tone: Delta } {
  if (curr == null || prev == null) return { text: "—", tone: "flat" };
  const diff = Math.round((curr - prev) * 10) / 10;
  if (diff === 0) return { text: "0.0s", tone: "flat" };
  const sign = diff > 0 ? "+" : "";
  return { text: `${sign}${diff.toFixed(1)}s`, tone: diff > 0 ? "warn" : "down" };
}

function summariesSub(report: DashboardReport): string {
  const total = report.summaries.current;
  const w = report.whisper.current;
  const pct = total > 0 ? Math.round((w / total) * 100) : 0;
  return `of which whisper · ${formatCount(w)} (${pct}%)`;
}

function latencySub(report: DashboardReport): string {
  const t = report.transcribeP95Seconds;
  const s = report.summarizeP95Seconds;
  if (t == null && s == null) return "no latency samples";
  return `transcribe ${formatSeconds(t)} · summarize ${formatSeconds(s)}`;
}

function cacheHitFooter(report: DashboardReport): string {
  const c = report.cacheHitRatePct.current;
  const p = report.cacheHitRatePct.previous;
  if (c == null) return "no traffic";
  if (p == null) return `${c}% (no prior data)`;
  const diff = c - p;
  const sign = diff > 0 ? "+" : "";
  return `${c}% · ${sign}${diff}pp vs prev`;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
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

function hashToIdx(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}
