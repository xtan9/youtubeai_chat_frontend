"use client";

/**
 * Admin shared atoms — pills, buttons, avatars, charts.
 *
 * Each atom maps to a custom class defined in `admin.css`. Lucide icons
 * come from `lucide-react` (already a project dependency) instead of the
 * inline SVG icon component used in the design prototype.
 */

import type { ReactNode, ButtonHTMLAttributes, CSSProperties } from "react";
import { cn } from "@/lib/utils";

// ============================================================
// Avatar
// ============================================================

interface AvatarProps {
  /** Gradient palette index 1–7. Maps to .av-1 ... .av-7 in admin.css. */
  idx?: number;
  /** Two-letter label (uppercased automatically). */
  label?: string;
  size?: number;
  className?: string;
}

export function Avatar({ idx = 1, label = "?", size = 24, className }: AvatarProps) {
  const palette = ((idx - 1) % 7) + 1;
  return (
    <span
      className={cn(`av-${palette}`, className)}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        color: "#fff",
        flexShrink: 0,
      }}
    >
      {label.slice(0, 2).toUpperCase()}
    </span>
  );
}

// ============================================================
// Pill
// ============================================================

type PillTone = "ok" | "warn" | "bad" | "primary";

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  mono?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function Pill({ children, tone, mono, style, className }: PillProps) {
  return (
    <span
      className={cn("pill", tone && `pill-${tone}`, mono && "pill-mono", className)}
      style={style}
    >
      {children}
    </span>
  );
}

// ============================================================
// Button
// ============================================================

type BtnKind = "default" | "primary" | "ghost" | "danger";
type BtnSize = "sm" | "md" | "lg";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: BtnKind;
  size?: BtnSize;
}

export function Btn({ kind = "default", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cn(
        "btn",
        kind === "primary" && "btn-primary",
        kind === "ghost" && "btn-ghost",
        kind === "danger" && "btn-danger",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ============================================================
// Charts — pure-SVG, no external chart lib
// ============================================================

interface AreaChartProps {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fillClass?: string;
  lineClass?: string;
  grid?: boolean;
  labels?: string[];
}

export function AreaChart({
  data,
  w = 600,
  h = 140,
  color,
  fillClass = "chart-fill",
  lineClass = "chart-line",
  grid = true,
  labels,
}: AreaChartProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data) * 1.15;
  const min = 0;
  const xs = data.map((_, i) => (i / Math.max(1, data.length - 1)) * (w - 8) + 4);
  const ys = data.map((v) => h - 8 - ((v - min) / (max - min || 1)) * (h - 16));
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    const cpx = (xs[i - 1] + xs[i]) / 2;
    d += ` C ${cpx} ${ys[i - 1]}, ${cpx} ${ys[i]}, ${xs[i]} ${ys[i]}`;
  }
  const fillPath = d + ` L ${xs[xs.length - 1]} ${h - 1} L ${xs[0]} ${h - 1} Z`;
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="chart-area"
    >
      {grid &&
        Array.from({ length: 4 }).map((_, i) => {
          const y = (i / 3) * (h - 16) + 8;
          return <line key={i} x1="0" y1={y} x2={w} y2={y} className="gridline" />;
        })}
      <path d={fillPath} className={fillClass} style={color ? { fill: color, fillOpacity: 0.1 } : undefined} />
      <path d={d} className={lineClass} style={color ? { stroke: color } : undefined} />
      {labels && (
        <g>
          {labels.map((l, i) => (
            <text
              key={i}
              x={(i / Math.max(1, labels.length - 1)) * (w - 8) + 4}
              y={h - 1}
              textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
              className="label"
            >
              {l}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
}

export function Sparkline({ data, w = 120, h = 36, color, fill = true }: SparklineProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const xs = data.map((_, i) => (i / Math.max(1, data.length - 1)) * (w - 2) + 1);
  const ys = data.map((v) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4));
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    const cpx = (xs[i - 1] + xs[i]) / 2;
    d += ` C ${cpx} ${ys[i - 1]}, ${cpx} ${ys[i]}, ${xs[i]} ${ys[i]}`;
  }
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      {fill && (
        <path
          d={d + ` L ${xs[xs.length - 1]} ${h} L ${xs[0]} ${h} Z`}
          fill={color || "currentColor"}
          fillOpacity="0.08"
        />
      )}
      <path
        d={d}
        stroke={color || "currentColor"}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface BarChartProps {
  data: number[];
  w?: number;
  h?: number;
  /** Index of the bar to render in the accent color (others muted). */
  accentIndex?: number;
}

export function BarChart({ data, w = 600, h = 140, accentIndex }: BarChartProps) {
  if (data.length === 0) return null;
  const max = Math.max(...data) * 1.1;
  const barW = (w - 8) / data.length - 4;
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="chart-area"
    >
      {data.map((v, i) => {
        const bh = (v / max) * (h - 12);
        const x = 4 + i * (barW + 4);
        const y = h - 6 - bh;
        const isAccent = accentIndex !== undefined ? i === accentIndex : false;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={bh}
            rx="2"
            className={isAccent ? "chart-bar" : "chart-bar muted"}
          />
        );
      })}
    </svg>
  );
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  size?: number;
  segments: DonutSegment[];
}

export function Donut({ size = 140, segments }: DonutProps) {
  const r = size / 2 - 12;
  const cx = size / 2;
  const cy = size / 2;
  const total = segments.reduce((a, b) => a + b.value, 0) || 1;

  // Pre-compute the cumulative start angle for each segment via reduce
  // (avoids `let` reassignment inside .map, which React 19 strict mode
  // flags as `react-hooks/immutability` after render).
  const startAngles = segments.reduce<number[]>(
    (acc, seg) => {
      const next = acc[acc.length - 1] + (seg.value / total) * Math.PI * 2;
      return [...acc, next];
    },
    [-Math.PI / 2],
  );

  const arcs = segments.map((seg, i) => {
    const a0 = startAngles[i];
    const a1 = startAngles[i + 1];
    const angle = a1 - a0;
    const x1 = cx + r * Math.cos(a0);
    const y1 = cy + r * Math.sin(a0);
    const x2 = cx + r * Math.cos(a1);
    const y2 = cy + r * Math.sin(a1);
    const large = angle > Math.PI ? 1 : 0;
    return (
      <path
        key={i}
        d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
        fill={seg.color}
      />
    );
  });
  return (
    <svg width={size} height={size}>
      {arcs}
      <circle cx={cx} cy={cy} r={r * 0.62} fill="var(--surface)" />
    </svg>
  );
}
