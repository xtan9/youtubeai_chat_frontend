"use client";

import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCcw,
} from "lucide-react";
import { Avatar, Btn, Pill } from "../_components/atoms";

// ============================================================
// Mock audit events (real-shape, matches admin_audit_log schema)
// ============================================================

interface AuditEvent {
  t: string;
  admin: string;
  action: string;
  res: string;
  reason: string;
  ip: string;
  actionTone?: "warn" | "primary";
}

const AUDIT: AuditEvent[] = [
  { t: "14:22:08", admin: "steven@", action: "viewed transcript", res: "summary c4e1…", reason: "abuse review · #4821", ip: "203.0.113.7", actionTone: "warn" },
  { t: "14:21:55", admin: "steven@", action: "viewed user", res: "user 8af2…", reason: "—", ip: "203.0.113.7" },
  { t: "14:18:02", admin: "steven@", action: "reset rate limit", res: "user 8af2…", reason: "support · #4821", ip: "203.0.113.7", actionTone: "primary" },
  { t: "13:51:40", admin: "steven@", action: "viewed transcript", res: "summary 9b04…", reason: "quality check", ip: "203.0.113.7", actionTone: "warn" },
  { t: "13:50:11", admin: "steven@", action: "exported csv", res: "users (n=42)", reason: "monthly review", ip: "203.0.113.7" },
  { t: "09:02:44", admin: "ana@", action: "viewed transcript", res: "summary aa18…", reason: "support · #4811", ip: "198.51.100.2", actionTone: "warn" },
  { t: "08:55:30", admin: "ana@", action: "signed in", res: "—", reason: "—", ip: "198.51.100.2" },
];

export default function AdminAuditPage() {
  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Audit log</h1>
          <p className="page-sub">Append-only · 312 events in last 30 days</p>
        </div>
        <div className="row gap-8">
          <Btn size="sm" kind="ghost">
            <Download size={13} /> Export CSV
          </Btn>
          <Btn size="sm">
            <RefreshCcw size={13} /> Subscribe
          </Btn>
        </div>
      </div>

      <div className="page-body">
        <div className="row gap-6" style={{ flexWrap: "wrap", marginBottom: 14 }}>
          <Pill tone="primary">
            <Check size={10} /> all admins
          </Pill>
          <Pill>
            action: any <ChevronDown size={10} />
          </Pill>
          <Pill>
            resource: summary <ChevronDown size={10} />
          </Pill>
          <Pill>
            last 7 days <ChevronDown size={10} />
          </Pill>
          <Pill>has reason ☑</Pill>
          <Pill style={{ borderStyle: "dashed", color: "var(--text-3)" }}>+ filter</Pill>
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Time (UTC)</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Reason</th>
                <th>IP</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {AUDIT.map((e, i) => (
                <tr key={i}>
                  <td className="mono">{e.t}</td>
                  <td>
                    <div className="user-cell">
                      <Avatar
                        idx={e.admin === "steven@" ? 1 : 2}
                        label={e.admin.slice(0, 2)}
                        size={20}
                      />
                      <span>{e.admin}</span>
                    </div>
                  </td>
                  <td>
                    <Pill tone={e.actionTone}>{e.action}</Pill>
                  </td>
                  <td className="mono">{e.res}</td>
                  <td className="muted">{e.reason}</td>
                  <td className="mono muted">{e.ip}</td>
                  <td>
                    <ChevronRight size={14} style={{ color: "var(--text-3)" }} />
                  </td>
                </tr>
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
            <span>Showing 7 of 312 events</span>
            <Btn size="sm" kind="ghost">Load more</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
