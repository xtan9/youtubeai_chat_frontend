import Link from "next/link";
import { ChevronRight, Download, RefreshCcw } from "lucide-react";
import { Avatar, Btn, Pill } from "../_components/atoms";
import { requireAdminPage } from "../_components/admin-gate";
import { requireAdminClient } from "@/lib/supabase/admin-client";
import { listAuditLog, type AuditRow } from "@/lib/admin/queries";
import type { Tone } from "@/lib/admin/types";

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ cursor?: string }>;
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  const principal = await requireAdminPage();
  const client = requireAdminClient(
    { email: principal.email },
    principal.allowlist,
  );
  const { cursor } = await searchParams;
  const { rows, nextCursor } = await listAuditLog(client, {
    cursor: cursor ?? null,
    pageSize: PAGE_SIZE,
  });

  return (
    <div className="surface-anim">
      <div className="page-h">
        <div>
          <h1 className="page-title">Audit log</h1>
          <p className="page-sub">
            Append-only · {rows.length === 0 ? "no events yet" : `showing ${rows.length} latest events`}
          </p>
        </div>
        <div className="row gap-8">
          <Btn size="sm" kind="ghost">
            <Download size={13} /> Export CSV
          </Btn>
          <Btn size="sm">
            <RefreshCcw size={13} /> Refresh
          </Btn>
        </div>
      </div>

      <div className="page-body">
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Time (UTC)</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Resource ID</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted" style={{ padding: 24, textAlign: "center" }}>
                    No audit events recorded yet.
                  </td>
                </tr>
              ) : (
                rows.map((event) => <AuditEventRow key={event.id} event={event} />)
              )}
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
            <span>{nextCursor ? "More events available" : "End of log"}</span>
            {nextCursor && (
              <Link
                href={`/admin/audit?cursor=${encodeURIComponent(nextCursor)}`}
                style={{ textDecoration: "none" }}
              >
                <Btn size="sm" kind="ghost">Load more</Btn>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditEventRow({ event }: { event: AuditRow }) {
  const tone = actionTone(event.action);
  const adminLabel = event.adminEmail.slice(0, 2).toUpperCase();
  const adminIdx = hashToIdx(event.adminEmail);
  return (
    <tr>
      <td className="mono">{formatTime(event.createdAt)}</td>
      <td>
        <div className="user-cell">
          <Avatar idx={adminIdx} label={adminLabel} size={20} />
          <span>{event.adminEmail}</span>
        </div>
      </td>
      <td>
        <Pill tone={tone}>{event.action.replace(/_/g, " ")}</Pill>
      </td>
      <td>
        <span className="muted">{event.resourceType}</span>
      </td>
      <td className="mono muted">{shortenId(event.resourceId)}</td>
      <td>
        <ChevronRight size={14} style={{ color: "var(--text-3)" }} />
      </td>
    </tr>
  );
}

function actionTone(action: string): Tone | undefined {
  if (action.startsWith("view_")) return "warn";
  if (action === "reset_rate_limit" || action === "restore_user") return "primary";
  if (action === "suspend_user") return "bad";
  return undefined;
}

function formatTime(iso: string): string {
  // YYYY-MM-DD HH:MM:SS UTC, trimmed to fit the column.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function shortenId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function hashToIdx(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return Math.abs(h) % 7;
}
