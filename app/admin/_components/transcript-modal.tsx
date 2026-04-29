"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { X, Download, ChevronDown } from "lucide-react";
import { Btn, Pill } from "./atoms";
import { useAdmin } from "./admin-context";
import {
  viewTranscriptAction,
  type ViewTranscriptResult,
} from "@/app/admin/users/_actions/view-transcript";
import type { TranscriptSource } from "@/lib/admin/types";

export interface TranscriptModalTarget {
  /** UUID of the cached summaries row to fetch + audit. */
  summaryId: string;
  /** User whose drill-down opened this modal — captured in audit
   * metadata so /admin/audit can answer "which user's expansion led
   * here". May be null when the modal is opened from a non-user-scoped
   * surface (e.g. a future global summaries list). */
  viewedUserId: string | null;
  /** Pre-known display fields used for the header *before* the server
   * action returns. Header swaps to the action's authoritative values
   * once content lands. */
  videoTitle: string | null;
  channel: string | null;
  language: string | null;
  source: TranscriptSource;
  model: string | null;
  processingTimeSeconds: number | null;
}

interface TranscriptModalProps {
  target: TranscriptModalTarget;
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: Extract<ViewTranscriptResult, { ok: true }> }
  | { kind: "error"; reason: string };

export function TranscriptModal({ target, onClose }: TranscriptModalProps) {
  const { email: adminEmail } = useAdmin();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [, startTransition] = useTransition();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const ts = new Date().toISOString().replace("T", " ").slice(11, 19);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // One-shot fetch on mount. The server action does both the audit write
  // and the content read, so re-running it on remount would double-fire
  // the audit row — modal lifecycle owns the contract that "open = one
  // audit", and we never re-invoke once a result lands.
  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      const result = await viewTranscriptAction(
        target.summaryId,
        target.viewedUserId,
      );
      if (cancelled) return;
      if (result.ok) {
        setState({ kind: "ready", data: result });
      } else {
        setState({ kind: "error", reason: result.reason });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [target.summaryId, target.viewedUserId]);

  const headerTitle =
    state.kind === "ready" ? state.data.videoTitle : target.videoTitle;
  const headerChannel =
    state.kind === "ready" ? state.data.channelName : target.channel;
  const headerLanguage =
    state.kind === "ready" ? state.data.language : target.language;
  const headerSource =
    state.kind === "ready" ? state.data.source : target.source;
  const headerModel = state.kind === "ready" ? state.data.model : target.model;
  const headerTime =
    state.kind === "ready"
      ? state.data.processingTimeSeconds
      : target.processingTimeSeconds;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Transcript and summary"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        animation: "admin-fade-in 200ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
      onClick={onClose}
    >
      <div
        className="modal"
        style={{
          width: "min(820px, 92vw)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <AuditBanner
          adminEmail={adminEmail ?? "(unknown)"}
          ts={ts}
          state={state}
        />

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
            }}
          >
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                }}
              >
                {headerTitle ?? "(untitled video)"}
              </h2>
              <div className="text-sm muted" style={{ marginTop: 4 }}>
                {headerChannel ?? "—"}
                {state.kind === "ready" &&
                  ` · created ${formatCreatedAt(state.data.createdAt)}`}
              </div>
            </div>
            <Btn ref={closeRef} size="sm" kind="ghost" onClick={onClose} aria-label="Close">
              <X size={14} />
            </Btn>
          </div>
          <div className="row gap-6" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <Pill>{headerLanguage ?? "?"}</Pill>
            <Pill tone={headerSource === "whisper" ? "warn" : "ok"}>
              {headerSource}
            </Pill>
            {headerModel && <Pill mono>{headerModel}</Pill>}
            {headerTime != null && <Pill>{headerTime.toFixed(1)}s</Pill>}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <SummaryPane state={state} />
          <TranscriptPane state={state} />
        </div>

        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div className="text-xs muted">
            {state.kind === "ready" && state.data.auditId
              ? <>Audit row <span className="mono">{state.data.auditId.slice(0, 8)}…</span></>
              : state.kind === "ready" && !state.data.auditId
                ? <span style={{ color: "var(--warn)" }}>Audit write failed (logged for ops review)</span>
                : "—"}
          </div>
          <div className="row gap-6">
            <Btn size="sm" kind="ghost" disabled>
              <Download size={12} /> Download .txt
            </Btn>
            <Btn size="sm" kind="primary" onClick={onClose}>
              Close
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditBanner({
  adminEmail,
  ts,
  state,
}: {
  adminEmail: string;
  ts: string;
  state: LoadState;
}) {
  const headline =
    state.kind === "ready"
      ? state.data.auditId
        ? "You are viewing as admin · this view is logged"
        : "You are viewing as admin · audit write failed"
      : state.kind === "loading"
        ? "You are viewing as admin · logging this view…"
        : "You are viewing as admin · view did not load";
  return (
    <div className="banner-audit">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dot" />
        <strong>{headline}</strong>
        <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
          · {adminEmail} · {ts} UTC
        </span>
      </div>
    </div>
  );
}

function SummaryPane({ state }: { state: LoadState }) {
  return (
    <div
      style={{
        padding: "14px 20px",
        borderRight: "1px solid var(--border)",
        overflow: "auto",
      }}
    >
      <div
        className="text-xs muted"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 8,
        }}
      >
        Summary
      </div>
      {state.kind === "loading" && (
        <div className="text-sm muted">Loading summary…</div>
      )}
      {state.kind === "error" && (
        <div className="text-sm" style={{ color: "var(--warn)" }}>
          Could not load summary: {state.reason.replace(/_/g, " ")}
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {state.data.summary || "(empty summary)"}
          </div>
          {state.data.thinking && (
            <details
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              <summary
                className="text-xs"
                style={{
                  color: "var(--text-2)",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  listStyle: "none",
                }}
              >
                <span>Thinking</span>
                <ChevronDown size={12} />
              </summary>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  lineHeight: 1.55,
                  color: "var(--text-2)",
                  whiteSpace: "pre-wrap",
                }}
              >
                {state.data.thinking}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function TranscriptPane({ state }: { state: LoadState }) {
  const charCount =
    state.kind === "ready" && state.data.transcript
      ? state.data.transcript.length
      : 0;
  return (
    <div style={{ padding: "14px 20px", overflow: "auto" }}>
      <div
        className="text-xs muted"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 8,
        }}
      >
        Transcript
        {charCount > 0 && ` · ${charCount.toLocaleString("en-US")} chars`}
      </div>
      {state.kind === "loading" && (
        <div className="text-sm muted">Loading transcript…</div>
      )}
      {state.kind === "error" && (
        <div className="text-sm" style={{ color: "var(--warn)" }}>
          Could not load transcript.
        </div>
      )}
      {state.kind === "ready" && (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.65,
            color: "var(--text-2)",
            fontFamily: "var(--mono)",
            whiteSpace: "pre-wrap",
          }}
        >
          {state.data.transcript || "(no transcript text recorded)"}
        </div>
      )}
    </div>
  );
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toUTCString().replace("GMT", "UTC");
}
