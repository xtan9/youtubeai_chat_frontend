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

type ReadyData = Extract<ViewTranscriptResult, { ok: true }>;

type LoadState =
  | { kind: "loading" }
  | { kind: "audited"; data: ReadyData & { auditId: string } }
  | { kind: "unaudited"; data: ReadyData & { auditId: null } }
  | {
      kind: "error";
      reason: Extract<ViewTranscriptResult, { ok: false }>["reason"] | "unexpected_error";
    };

function readyVariant(data: ReadyData): LoadState {
  return data.auditId
    ? { kind: "audited", data: { ...data, auditId: data.auditId } }
    : { kind: "unaudited", data: { ...data, auditId: null } };
}

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

  // One-shot fetch on mount or target change. The server action does both
  // the audit write and the content read; the cancellation flag keeps a
  // closed/replaced modal from applying stale results to a new instance.
  //
  // **Production is one-audit-per-open.** React 19 dev StrictMode
  // intentionally double-mounts effects, so a dev session opening this
  // modal will write two audit rows. Prod has StrictMode dev-double-mount
  // disabled, so the contract holds. If StrictMode dev double-writes ever
  // become a problem, lift the action call to a module-level "in-flight
  // by summaryId" guard — until then, accept the dev-only duplication.
  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      // Reset to loading at the start of each new fetch — done inside
      // the transition body (not the effect body) to satisfy the
      // react-hooks/set-state-in-effect rule. The cancellation guard
      // below handles the case where target changes mid-flight.
      setState({ kind: "loading" });
      try {
        const result = await viewTranscriptAction(
          target.summaryId,
          target.viewedUserId,
        );
        if (cancelled) return;
        if (result.ok) {
          setState(readyVariant(result));
        } else {
          setState({ kind: "error", reason: result.reason });
        }
      } catch (err) {
        // requireAdminPage()'s redirect throws Next's NEXT_REDIRECT
        // sentinel — we let that re-throw so Next handles it. Anything
        // else (AuthInfraError, network blips, etc) becomes a visible
        // error state instead of leaving the modal stuck on "loading".
        if (isNextRedirect(err)) throw err;
        if (cancelled) return;
        console.error("[transcript-modal] view-transcript action threw", err);
        setState({ kind: "error", reason: "unexpected_error" });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [target.summaryId, target.viewedUserId]);

  const ready = state.kind === "audited" || state.kind === "unaudited"
    ? state.data
    : null;
  const headerTitle = ready?.videoTitle ?? target.videoTitle;
  const headerChannel = ready?.channelName ?? target.channel;
  const headerLanguage = ready?.language ?? target.language;
  const headerSource = ready?.source ?? target.source;
  const headerModel = ready?.model ?? target.model;
  const headerTime = ready?.processingTimeSeconds ?? target.processingTimeSeconds;
  const showVideoMetaWarning = ready?.videoFetchFailed === true;

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
                {ready && ` · created ${formatCreatedAt(ready.createdAt)}`}
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
            {showVideoMetaWarning && (
              <Pill tone="warn">video metadata unavailable</Pill>
            )}
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
            <FooterAuditStatus state={state} />
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
  const headline = bannerHeadline(state);
  return (
    <div className="banner-audit" data-state={state.kind}>
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

function bannerHeadline(state: LoadState): string {
  switch (state.kind) {
    case "loading":
      return "You are viewing as admin · logging this view…";
    case "audited":
      return "You are viewing as admin · this view is logged";
    case "unaudited":
      return "You are viewing as admin · audit write failed";
    case "error":
      return "You are viewing as admin · view did not load";
  }
}

function FooterAuditStatus({ state }: { state: LoadState }) {
  switch (state.kind) {
    case "loading":
      return <>Writing audit row…</>;
    case "audited":
      return (
        <>
          Audit row <span className="mono">{state.data.auditId.slice(0, 8)}…</span>
        </>
      );
    case "unaudited":
      return (
        <span style={{ color: "var(--warn)" }}>
          Audit write failed
          {state.data.auditFailureReason
            ? <>: <span className="mono">{state.data.auditFailureReason}</span></>
            : ""}
        </span>
      );
    case "error":
      return (
        <span style={{ color: "var(--warn)" }}>
          {humaniseErrorReason(state.reason)}
        </span>
      );
  }
}

type ErrorReason = Extract<LoadState, { kind: "error" }>["reason"];

// Stable user-facing copy table — keeps wire reason names out of UI text
// and makes a future rename a one-place change.
function humaniseErrorReason(reason: ErrorReason): string {
  switch (reason) {
    case "summary_not_found":
      return "Summary no longer exists";
    case "missing_summary_id":
      return "Missing summary identifier";
    case "invalid_summary_id":
      return "Invalid summary identifier";
    case "internal_error":
      return "Database query failed";
    case "unexpected_error":
      return "Unexpected error";
  }
}

function readyData(state: LoadState): ReadyData | null {
  return state.kind === "audited" || state.kind === "unaudited"
    ? state.data
    : null;
}

function SummaryPane({ state }: { state: LoadState }) {
  const ready = readyData(state);
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
          {humaniseErrorReason(state.reason)}
        </div>
      )}
      {ready && (
        <>
          <div
            style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {ready.summary || "(empty summary)"}
          </div>
          {ready.thinking && (
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
                {ready.thinking}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function TranscriptPane({ state }: { state: LoadState }) {
  const ready = readyData(state);
  const charCount = ready?.transcript ? ready.transcript.length : 0;
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
      {ready && (
        <div
          style={{
            fontSize: 12.5,
            lineHeight: 1.65,
            color: "var(--text-2)",
            fontFamily: "var(--mono)",
            whiteSpace: "pre-wrap",
          }}
        >
          {ready.transcript || "(no transcript text recorded)"}
        </div>
      )}
    </div>
  );
}

function isNextRedirect(err: unknown): boolean {
  // next/navigation throws a tagged error whose `digest` starts with
  // `NEXT_REDIRECT`. Don't intercept it — let Next handle the redirect.
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function formatCreatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toUTCString().replace("GMT", "UTC");
}
