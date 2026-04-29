import { ArrowDown, ArrowUp, MoreHorizontal } from "lucide-react";
import { AreaChart, Btn, Pill, Sparkline } from "../_components/atoms";
import { requireAdminPage } from "../_components/admin-gate";
import { parseWindowDays } from "../_components/window-days";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import {
  getPerformanceStats,
  listAdminUserIds,
  lastNDays,
  type PerformanceStats,
} from "@/lib/admin/queries";
import { assertNever, type Delta } from "@/lib/admin/types";

export const dynamic = "force-dynamic";

const TIME_TABS: { key: number; label: string }[] = [
  { key: 1, label: "1d" },
  { key: 7, label: "7d" },
  { key: 14, label: "14d" },
  { key: 30, label: "30d" },
  { key: 90, label: "90d" },
];

interface PageProps {
  searchParams: Promise<{ window?: string; include_admins?: string }>;
}

export default async function AdminPerformancePage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );
  const params = await searchParams;
  const windowDays = parseWindowDays(params.window, [1, 7, 14, 30, 90]);
  const window = lastNDays(windowDays);
  const includeAdmins = params.include_admins === "1";
  const adminUserIds = includeAdmins ? [] : await listAdminUserIds(client);
  const stats = await getPerformanceStats(client, window, {
    excludeAdminUserIds: adminUserIds,
  });

  const cards = buildCards(stats);

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Performance</h1>
          <p className="page-sub">
            Last {windowDays} days · processing latency by stage ·{" "}
            <span className="muted">
              {includeAdmins ? "including admins" : "excluding admin activity"}
            </span>
          </p>
        </div>
        <div className="row gap-8">
          <a
            href={(() => {
              const sp = new URLSearchParams();
              if (windowDays !== 30) sp.set("window", String(windowDays));
              if (!includeAdmins) sp.set("include_admins", "1");
              const qs = sp.toString();
              return qs ? `?${qs}` : "?";
            })()}
            className={`tab ${includeAdmins ? "active" : ""}`}
            title="Toggle whether admin-account activity is included in metrics"
          >
            {includeAdmins ? "incl. admins" : "real users"}
          </a>
          <div className="tabs">
            {TIME_TABS.map((t) => (
              <a
                key={t.key}
                href={(() => {
                  const sp = new URLSearchParams();
                  if (t.key !== 30) sp.set("window", String(t.key));
                  if (includeAdmins) sp.set("include_admins", "1");
                  const qs = sp.toString();
                  return qs ? `?${qs}` : "?";
                })()}
                className={`tab ${windowDays === t.key ? "active" : ""}`}
              >
                {t.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Compact metric strip */}
        <div className="card" style={{ overflow: "hidden", marginBottom: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)" }}>
            {cards.map((c, i) => {
              const arrow = renderArrow(c.tone);
              return (
                <div
                  key={c.label}
                  style={{
                    padding: "16px 18px",
                    borderRight:
                      i < cards.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div className="kpi-label">{c.label}</div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <div className="kpi-value kpi-mini">{c.value}</div>
                    <span className={`kpi-delta ${c.tone}`} style={{ fontSize: 12 }}>
                      {arrow}
                      {c.delta}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      color: c.tone === "warn" ? "var(--warn)" : "var(--text)",
                    }}
                  >
                    <Sparkline
                      data={c.spark.length > 0 ? c.spark : [0]}
                      w={180}
                      h={32}
                    />
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
              <div className="card-sub">p95 · daily buckets</div>
            </div>
            <div className="row gap-8">
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
              data={stats.latencyByBucket.map((b) => b.p95Seconds ?? 0)}
              h={220}
              color="var(--warn)"
              labels={buildAxisLabels(stats.latencyByBucket.length)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface PerfCard {
  label: string;
  value: string;
  delta: string;
  tone: Delta;
  spark: number[];
}

function buildCards(stats: PerformanceStats): PerfCard[] {
  const sparkSeries = stats.latencyByBucket.map((b) => b.p95Seconds ?? 0);
  return [
    {
      label: "p50",
      value: formatSeconds(stats.p50Seconds),
      ...delta(stats.p50Seconds, stats.prev.p50Seconds, "lower-better"),
      spark: sparkSeries,
    },
    {
      label: "p95",
      value: formatSeconds(stats.p95Seconds),
      ...delta(stats.p95Seconds, stats.prev.p95Seconds, "lower-better"),
      spark: sparkSeries,
    },
    {
      label: "transcribe p95",
      value: formatSeconds(stats.transcribeP95Seconds),
      ...delta(
        stats.transcribeP95Seconds,
        stats.prev.transcribeP95Seconds,
        "lower-better",
      ),
      spark: sparkSeries,
    },
    {
      label: "summarize p95",
      value: formatSeconds(stats.summarizeP95Seconds),
      ...delta(
        stats.summarizeP95Seconds,
        stats.prev.summarizeP95Seconds,
        "lower-better",
      ),
      spark: sparkSeries,
    },
    {
      label: "samples",
      value: stats.latencyByBucket
        .reduce((s, b) => s + (b.p95Seconds == null ? 0 : 1), 0)
        .toString(),
      delta: "—",
      tone: "flat",
      spark: stats.latencyByBucket.map((b) => (b.p95Seconds == null ? 0 : 1)),
    },
  ];
}

function delta(
  curr: number | null,
  prev: number | null,
  direction: "lower-better" | "higher-better",
): { delta: string; tone: Delta } {
  if (curr == null || prev == null) return { delta: "—", tone: "flat" };
  const diff = Math.round((curr - prev) * 10) / 10;
  if (diff === 0) return { delta: "0.0s", tone: "flat" };
  const sign = diff > 0 ? "+" : "";
  const tone: Delta =
    diff > 0
      ? direction === "lower-better"
        ? "warn"
        : "up"
      : direction === "lower-better"
        ? "up"
        : "warn";
  return { delta: `${sign}${diff.toFixed(1)}s`, tone };
}

function formatSeconds(s: number | null): string {
  if (s == null) return "—";
  return `${s.toFixed(1)}s`;
}

function renderArrow(tone: Delta) {
  switch (tone) {
    case "up":
      return <ArrowDown size={11} />;
    case "down":
    case "warn":
      return <ArrowUp size={11} />;
    case "flat":
      return null;
    default:
      return assertNever(tone);
  }
}

function buildAxisLabels(n: number): string[] {
  if (n === 0) return [];
  const labels: string[] = Array.from({ length: n }, () => "");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  // Roughly 4 evenly spaced labels.
  const positions = [0, Math.floor(n / 3), Math.floor((n * 2) / 3), n - 1];
  for (const idx of positions) {
    if (idx >= 0 && idx < n) {
      const d = new Date(today.getTime() - (n - 1 - idx) * 86_400_000);
      labels[idx] = fmt(d);
    }
  }
  return labels;
}
