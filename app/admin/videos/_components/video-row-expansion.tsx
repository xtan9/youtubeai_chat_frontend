"use client";

import { useState, useTransition } from "react";
import { Btn, Pill } from "../../_components/atoms";
import type { AdminVideoRow } from "@/lib/admin/queries";
import {
  viewVideoUsersAction,
  type ViewVideoUsersResult,
} from "../_actions/view-video-users";
import { VideoContentModal } from "./video-summary-modal";

interface VideoRowExpansionProps {
  row: AdminVideoRow;
}

type ModalMode = "summary" | "transcript" | null;

export function VideoRowExpansion({ row }: VideoRowExpansionProps) {
  const [users, setUsers] = useState<ViewVideoUsersResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<ModalMode>(null);

  function loadUsers() {
    startTransition(async () => {
      const result = await viewVideoUsersAction(row.videoId);
      setUsers(result);
    });
  }

  return (
    <div
      style={{
        padding: "14px 18px",
        background: "var(--surface-2)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
          fontSize: 12,
          marginBottom: 10,
        }}
      >
        <span>
          <strong>First summarized:</strong>{" "}
          <span className="muted">{row.firstSummarizedAt.slice(0, 10)}</span>
        </span>
        <span>
          <strong>Last:</strong>{" "}
          <span className="muted">{row.lastSummarizedAt.slice(0, 10)}</span>
        </span>
        <span>
          <strong>Models:</strong>{" "}
          <span className="muted">{row.modelsUsed.join(", ") || "—"}</span>
        </span>
        <span>
          <strong>p95:</strong>{" "}
          <span className="muted">
            {row.p95ProcessingSeconds != null
              ? `${row.p95ProcessingSeconds.toFixed(1)}s`
              : "—"}
          </span>
        </span>
        <span>
          <strong>Status:</strong>{" "}
          <Pill tone={row.status === "active" ? "ok" : undefined}>
            {row.status}
          </Pill>
        </span>
      </div>

      <div className="row gap-8" style={{ marginTop: 12 }}>
        <Btn size="sm" onClick={() => setModal("summary")}>
          View summary
        </Btn>
        <Btn size="sm" onClick={() => setModal("transcript")}>
          View transcript
        </Btn>
        <Btn size="sm" kind="ghost" onClick={loadUsers} disabled={pending}>
          {pending ? "Loading users…" : "Show users"}
        </Btn>
      </div>

      {users && users.ok && (
        <table
          className="tbl"
          style={{ marginTop: 14, width: "100%", borderCollapse: "collapse" }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>User</th>
              <th style={{ textAlign: "left" }}>Accessed</th>
              <th style={{ textAlign: "left" }}>Cache</th>
              <th style={{ textAlign: "left" }}>Audit</th>
            </tr>
          </thead>
          <tbody>
            {users.users.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No users.
                </td>
              </tr>
            ) : (
              users.users.map((u) => (
                <tr key={u.userId + ":" + u.accessedAt}>
                  <td>
                    {u.email
                      ? u.email
                      : u.emailLookupOk
                        ? "(no email)"
                        : "(lookup failed)"}
                  </td>
                  <td className="muted">
                    {u.accessedAt.slice(0, 16).replace("T", " ")}
                  </td>
                  <td>{u.cacheHit ? "hit" : "miss"}</td>
                  <td className="muted mono">
                    {u.auditId ? u.auditId.slice(0, 8) + "…" : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
      {users && !users.ok && (
        <div style={{ marginTop: 12 }}>
          <Pill tone="warn">Failed: {users.reason}</Pill>
        </div>
      )}

      {modal && (
        <VideoContentModal
          videoId={row.videoId}
          initialMode={modal}
          videoTitle={row.title}
          channelName={row.channelName}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
