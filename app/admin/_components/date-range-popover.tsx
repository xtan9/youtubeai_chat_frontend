"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Btn } from "./atoms";

const PRESETS = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Last 90 days",
  "Quarter to date",
  "Year to date",
  "Custom range…",
];

interface DateRangePopoverProps {
  onClose: () => void;
}

export function DateRangePopover({ onClose }: DateRangePopoverProps) {
  const [active, setActive] = useState("Last 30 days");
  // Apr 2026 grid — 30 days, first day is Wednesday (firstDay=3)
  const monthDays = 30;
  const firstDay = 3;
  const cells = Array.from({ length: 35 });

  return (
    <div className="menu" style={{ width: 520, padding: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "180px 1fr" }}>
        <div style={{ borderRight: "1px solid var(--border)", padding: 8 }}>
          {PRESETS.map((p) => (
            <div
              key={p}
              className="menu-item"
              style={{
                background: active === p ? "var(--primary-soft)" : "transparent",
                color: active === p ? "var(--primary)" : "var(--text)",
                fontWeight: active === p ? 500 : 400,
              }}
              onClick={() => setActive(p)}
            >
              {p}
            </div>
          ))}
        </div>
        <div style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>April 2026</div>
            <div className="row gap-4">
              <Btn size="sm" kind="ghost" aria-label="Previous month">
                <ChevronLeft size={12} />
              </Btn>
              <Btn size="sm" kind="ghost" aria-label="Next month">
                <ChevronRight size={12} />
              </Btn>
            </div>
          </div>
          <div className="cal">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <div key={i} className="cal-h">
                {d}
              </div>
            ))}
            {cells.map((_, i) => {
              const d = i - firstDay + 1;
              const inMonth = d >= 1 && d <= monthDays;
              const start = d === 1;
              const end = d === 30;
              const display = d > 0 && d <= monthDays ? d : d <= 0 ? 31 + d : d - monthDays;
              return (
                <div
                  key={i}
                  className={[
                    "cal-d",
                    !inMonth && "muted",
                    inMonth && "in-range",
                    start && "range-start",
                    end && "range-end",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {display}
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 10,
              paddingTop: 10,
              borderTop: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" defaultChecked /> Compare to previous period
            </label>
            <div className="row gap-6">
              <Btn size="sm" kind="ghost" onClick={onClose}>
                Cancel
              </Btn>
              <Btn size="sm" kind="primary" onClick={onClose}>
                Apply
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
