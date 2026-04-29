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
];

interface DateRangePopoverProps {
  onClose: () => void;
}

// TODO(admin-data): wire month nav, day-cell click, and "Custom range…" — currently a static April 2026 view.
const VISIBLE_MONTH = new Date(2026, 3, 1); // April 2026

export function DateRangePopover({ onClose }: DateRangePopoverProps) {
  const [active, setActive] = useState("Last 30 days");

  const monthLabel = VISIBLE_MONTH.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const monthDays = new Date(
    VISIBLE_MONTH.getFullYear(),
    VISIBLE_MONTH.getMonth() + 1,
    0,
  ).getDate();
  const firstDay = VISIBLE_MONTH.getDay();
  const prevMonthLastDay = new Date(
    VISIBLE_MONTH.getFullYear(),
    VISIBLE_MONTH.getMonth(),
    0,
  ).getDate();
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
          <div
            className="menu-item"
            aria-disabled="true"
            style={{ opacity: 0.5, cursor: "default" }}
            title="Coming soon"
          >
            Custom range…
          </div>
        </div>
        <div style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{monthLabel}</div>
            <div className="row gap-4">
              <Btn size="sm" kind="ghost" disabled aria-label="Previous month (coming soon)">
                <ChevronLeft size={12} />
              </Btn>
              <Btn size="sm" kind="ghost" disabled aria-label="Next month (coming soon)">
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
              const end = d === monthDays;
              const display = inMonth
                ? d
                : d <= 0
                ? prevMonthLastDay + d
                : d - monthDays;
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
                  style={{ cursor: "default" }}
                  aria-disabled="true"
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
