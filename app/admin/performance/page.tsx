"use client";

import { ArrowDown, ArrowUp, MoreHorizontal } from "lucide-react";
import { AreaChart, Btn, Pill, Sparkline } from "../_components/atoms";

interface PerfStat {
  label: string;
  val: string;
  delta: string;
  tone: "up" | "warn" | "flat";
  spark: number[];
}

const STATS: PerfStat[] = [
  { label: "p50", val: "3.8s", delta: "-0.4s", tone: "up", spark: [5, 4, 5, 4, 3, 4, 3, 4, 3, 4, 3, 3, 4, 3, 4, 3] },
  { label: "p95", val: "11.4s", delta: "+1.2s", tone: "warn", spark: [8, 9, 9, 10, 11, 10, 11, 12, 11, 11, 12, 11, 12, 11, 12, 11] },
  { label: "transcribe p95", val: "8.9s", delta: "+1.0s", tone: "warn", spark: [6, 7, 7, 8, 9, 8, 9, 9, 9, 9, 10, 9, 10, 9, 9, 9] },
  { label: "summarize p95", val: "2.5s", delta: "0.0s", tone: "flat", spark: [3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2] },
  { label: "errors", val: "0.4%", delta: "+0.1pp", tone: "warn", spark: [1, 1, 2, 1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2] },
];

const TIME_TABS = ["1h", "24h", "7d", "30d", "90d"];

export default function AdminPerformancePage() {
  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Performance</h1>
          <p className="page-sub">Last 30 days · processing latency by stage</p>
        </div>
        <div className="row gap-8">
          <div className="tabs">
            {TIME_TABS.map((t, i) => (
              <div key={t} className={`tab ${i === 3 ? "active" : ""}`}>
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Compact metric strip */}
        <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
            {STATS.map((c, i) => {
              const ArrowIcon = c.tone === "up" ? ArrowDown : ArrowUp;
              return (
                <div
                  key={c.label}
                  style={{
                    padding: "16px 18px",
                    borderRight: i < STATS.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div className="kpi-label">{c.label}</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
                    <div className="kpi-value kpi-mini">{c.val}</div>
                    <span
                      className={`kpi-delta ${c.tone === "warn" ? "warn" : c.tone === "up" ? "up" : ""}`}
                      style={{ fontSize: 12 }}
                    >
                      {c.tone !== "flat" && <ArrowIcon size={11} />}
                      {c.delta}
                    </span>
                  </div>
                  <div style={{ marginTop: 8, color: c.tone === "warn" ? "var(--warn)" : "var(--text)" }}>
                    <Sparkline data={c.spark} w={180} h={32} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Main chart */}
        <div className="card">
          <div className="card-h">
            <div>
              <div className="card-title">Latency over time</div>
              <div className="card-sub">p50 vs p95 · whisper vs cached</div>
            </div>
            <div className="row gap-8">
              <Pill>
                <span className="dot" style={{ background: "var(--text)" }} /> p50
              </Pill>
              <Pill>
                <span className="dot" style={{ background: "var(--warn)" }} /> p95
              </Pill>
              <Btn size="sm" kind="ghost" aria-label="More">
                <MoreHorizontal size={14} />
              </Btn>
            </div>
          </div>
          <div style={{ padding: 18 }}>
            <AreaChart
              data={[
                8, 9, 9, 10, 11, 10, 11, 12, 11, 11, 12, 11, 12, 11, 12, 11, 11, 12, 12, 11, 12,
                13, 12, 11, 11, 12, 11, 11, 12, 11,
              ]}
              h={220}
              color="var(--warn)"
              labels={["Apr 1", "", "Apr 8", "", "Apr 15", "", "Apr 22", "", "Apr 30"]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
