"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  RefreshCcw,
  Calendar,
  ChevronDown,
} from "lucide-react";
import {
  Avatar,
  Pill,
  Btn,
  AreaChart,
  BarChart,
  Donut,
} from "./_components/atoms";
import { DateRangePopover } from "./_components/date-range-popover";
import { useDismissable } from "./_components/use-dismissable";
import type { Delta } from "@/lib/admin/types";

interface TopUserRow {
  email: string;
  label: string;
  av: number;
  summaries: number;
  whisper: number;
  // Pre-formatted display string (e.g. "9.2s"); the source column is numeric on the users page.
  p95: string;
  lastSeen: string;
  flagged?: true;
}

// TODO(admin-data): replace mock arrays with service-role queries.
const summariesPerDay = [
  212, 238, 254, 201, 189, 246, 278, 285, 272, 294, 310, 288, 265, 302, 318,
  325, 298, 341, 356, 330, 312, 328, 346, 362, 378, 341, 325, 358, 372, 389,
];
const p95PerDay = [
  9.8, 10.2, 11.1, 10.5, 11.4, 12.0, 11.8, 11.5, 11.9, 12.4, 12.1, 11.6, 11.2,
  11.5, 11.8, 12.0, 12.3, 11.9, 11.6, 12.2, 12.5, 12.8, 12.4, 11.9, 11.5, 11.7,
  12.1, 11.8, 11.4, 11.2,
];
const dauPerDay = [
  82, 98, 112, 89, 76, 104, 128, 131, 118, 142, 156, 138, 129, 148, 162, 168,
  151, 182, 195, 176, 164, 178, 189, 201, 212, 189, 178, 196, 208, 219,
];
const cacheHitPerDay = [
  71, 72, 75, 73, 76, 78, 77, 79, 80, 78, 77, 79, 81, 80, 78, 76, 79, 80, 82,
  81, 79, 77, 80, 82, 83, 81, 79, 80, 82, 84,
];

const TOP_USERS: TopUserRow[] = [
  { email: "alex@cortexlabs.dev", label: "AL", av: 1, summaries: 142, whisper: 14, p95: "9.2s", lastSeen: "2m ago" },
  { email: "mei@hk.gov.example", label: "ME", av: 2, summaries: 118, whisper: 8, p95: "8.4s", lastSeen: "12m ago" },
  { email: "ben+yt@gmail.example", label: "BE", av: 3, summaries: 113, whisper: 62, p95: "16.8s", lastSeen: "3h ago", flagged: true },
  { email: "saanvi@startup.io", label: "SA", av: 4, summaries: 87, whisper: 0, p95: "6.1s", lastSeen: "5h ago" },
  { email: "ren@studio.jp", label: "RE", av: 5, summaries: 76, whisper: 21, p95: "11.4s", lastSeen: "1d ago" },
];

export default function AdminDashboardPage() {
  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Apr 1 – Apr 30, 2026 · compared to previous 30 days</p>
        </div>
        <div className="row gap-8">
          <DateRangePicker />
          <Btn size="sm" kind="ghost" aria-label="Refresh">
            <RefreshCcw size={13} />
          </Btn>
        </div>
      </div>

      <div className="page-body">
        <div className="kpi-grid cols-2" style={{ marginBottom: 16 }}>
          <HeroKPI
            label="Summaries"
            value="8,896"
            delta="+12.4%"
            deltaTone="up"
            sub="of which whisper · 1,872 (21%)"
            data={summariesPerDay}
            color="var(--text)"
          />
          <HeroKPI
            label="p95 latency"
            value="11.4s"
            delta="+1.2s"
            deltaTone="warn"
            sub="transcribe 8.9s · summarize 2.5s"
            data={p95PerDay}
            color="var(--warn)"
          />
        </div>

        <div className="kpi-grid cols-3">
          <ChartCard
            title="Daily active users"
            sub="DAU · last 30d"
            footer="WAU · 1,128"
            chart={<BarChart data={dauPerDay} h={140} accentIndex={29} />}
          />
          <DonutCard />
          <ChartCard
            title="Cache hit rate"
            sub="last 30d · 78% avg"
            footer="saved · $311.20"
            chart={
              <AreaChart
                data={cacheHitPerDay}
                h={140}
                lineClass="chart-line-primary"
                fillClass="chart-fill-primary"
              />
            }
          />
        </div>

        <div className="section-h">
          <h3 className="section-title">Top users · last 7 days</h3>
          <Link
            href="/admin/users"
            className="text-sm"
            style={{ color: "var(--primary)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
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
              {TOP_USERS.map((u, i) => (
                <tr key={i}>
                  <td>
                    <div className="user-cell">
                      <Avatar idx={u.av} label={u.label} />
                      <span className="email">{u.email}</span>
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
                    {u.whisper > 30 ? (
                      <Pill tone="warn">{u.whisper}%</Pill>
                    ) : (
                      <span className="muted">{u.whisper}%</span>
                    )}
                  </td>
                  <td className="num muted">{u.p95}</td>
                  <td className="muted">{u.lastSeen}</td>
                  <td>
                    <ChevronRight size={14} style={{ color: "var(--text-3)" }} />
                  </td>
                </tr>
              ))}
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
  delta: string;
  deltaTone?: Delta;
  sub: string;
  data: number[];
  color: string;
}

function HeroKPI({ label, value, delta, deltaTone = "up", sub, data, color }: HeroKPIProps) {
  const ArrowIcon = deltaTone === "down" ? ArrowDown : deltaTone === "flat" ? null : ArrowUp;
  return (
    <div className="kpi" style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="kpi-label">{label}</div>
          <div className="kpi-value" style={{ fontSize: 36, marginTop: 6 }}>{value}</div>
          <div className="kpi-row">
            <span className={`kpi-delta ${deltaTone}`}>
              {ArrowIcon && <ArrowIcon size={12} />}
              {delta}
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
          labels={["Apr 1", "", "Apr 15", "", "Apr 30"]}
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

function DonutCard() {
  const segs = [
    { label: "Manual captions", value: 58, color: "#0a0a0a" },
    { label: "Auto captions", value: 21, color: "#525252" },
    { label: "Whisper", value: 21, color: "var(--warn)" },
  ];
  return (
    <div className="card">
      <div style={{ padding: "14px 18px 10px" }}>
        <div className="card-title">Transcript source</div>
        <div className="card-sub">last 30d</div>
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

function DateRangePicker() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  useDismissable(open, wrapperRef, () => setOpen(false));

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <Btn size="sm" onClick={() => setOpen(!open)}>
        <Calendar size={13} /> Last 30 days
        <ChevronDown size={12} />
      </Btn>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 50,
          }}
        >
          <DateRangePopover onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
