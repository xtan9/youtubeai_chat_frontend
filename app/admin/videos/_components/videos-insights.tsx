import type { ReactNode } from "react";
import { BarChart, Donut } from "../../_components/atoms";
import type { VideoInsights } from "@/lib/admin/queries";
import type { TranscriptSource } from "@/lib/admin/types";

const SOURCE_COLOR: Record<TranscriptSource, string> = {
  manual_captions: "var(--text)",
  auto_captions: "var(--text-2)",
  whisper: "var(--warn)",
};
const SOURCE_LABEL: Record<TranscriptSource, string> = {
  manual_captions: "Manual",
  auto_captions: "Auto",
  whisper: "Whisper",
};

interface VideosInsightsProps {
  insights: VideoInsights;
}

export function VideosInsights({ insights }: VideosInsightsProps) {
  return (
    <>
      <div className="kpi-grid cols-4" style={{ marginBottom: 16 }}>
        <KpiTile
          label="Total videos"
          value={insights.totalUniqueVideos.toLocaleString()}
        />
        <KpiTile
          label="Whisper-need"
          value={`${insights.whisperVideoSharePct}%`}
        />
        <KpiTile
          label="Top channel"
          value={insights.topChannels[0]?.channelName ?? "—"}
        />
        <KpiTile
          label="Top language"
          value={insights.languageMix[0]?.language ?? "—"}
        />
      </div>

      <div className="kpi-grid cols-3" style={{ marginBottom: 24 }}>
        <ChartCard title="Top channels" sub="by video count">
          <BarChart
            data={insights.topChannels.map((c) => c.videoCount)}
            h={140}
            accentIndex={0}
          />
        </ChartCard>
        <DonutCard
          title="Language mix"
          segments={insights.languageMix.slice(0, 6).map((m, i) => ({
            label: m.language,
            value: m.videoCount,
            color: i === 0 ? "var(--text)" : "var(--text-2)",
          }))}
        />
        <DonutCard
          title="Source mix (by view)"
          segments={insights.sourceMix.map((m) => ({
            label: SOURCE_LABEL[m.source],
            value: m.count,
            color: SOURCE_COLOR[m.source],
          }))}
        />
      </div>
    </>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi" style={{ padding: "16px 18px" }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ fontSize: 24, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div style={{ padding: "14px 18px 10px" }}>
        <div className="card-title">{title}</div>
        <div className="card-sub">{sub}</div>
      </div>
      <div style={{ padding: "0 14px 14px" }}>{children}</div>
    </div>
  );
}

function DonutCard({
  title,
  segments,
}: {
  title: string;
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="card">
      <div style={{ padding: "14px 18px 10px" }}>
        <div className="card-title">{title}</div>
        <div className="card-sub">{total > 0 ? `${total} items` : "no data"}</div>
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
        <Donut size={130} segments={segments} />
        <div className="donut-legend">
          {segments.map((s, i) => (
            <div key={i} className="row" style={{ alignItems: "center" }}>
              <span>
                <span className="swatch" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tnum text-2">
                {total > 0 ? Math.round((s.value / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
