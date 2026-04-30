"use client";

import { useEffect, useState, useTransition } from "react";
import { X } from "lucide-react";
import { Btn, Pill } from "../../_components/atoms";
import {
  viewVideoSummaryAction,
  type ViewVideoSummaryResult,
} from "../_actions/view-video-summary";
import {
  viewVideoTranscriptAction,
  type ViewVideoTranscriptResult,
} from "../_actions/view-video-transcript";

type Mode = "summary" | "transcript";

interface VideoContentModalProps {
  videoId: string;
  initialMode: Mode;
  videoTitle: string | null;
  channelName: string | null;
  onClose: () => void;
}

interface LoadedContent {
  mode: Mode;
  body: string;
  auditId: string | null;
  auditFailureReason: string | null;
  /** True for transcript mode when videos-table fetch errored. */
  videoFetchFailed: boolean;
}

export function VideoContentModal({
  videoId,
  initialMode,
  videoTitle,
  channelName,
  onClose,
}: VideoContentModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [content, setContent] = useState<LoadedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Fetch content for the current mode. Re-runs when mode changes.
  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      // Reset state at the start of each fetch — done inside the
      // transition body (not the effect body) to satisfy
      // react-hooks/set-state-in-effect. Clear `content` BEFORE the
      // action runs so a failed mode-switch never leaves the previous
      // mode's body visible alongside the new mode's error pill.
      setError(null);
      setContent(null);
      try {
        const result =
          mode === "summary"
            ? ((await viewVideoSummaryAction(videoId)) as ViewVideoSummaryResult)
            : ((await viewVideoTranscriptAction(
                videoId,
              )) as ViewVideoTranscriptResult);
        if (cancelled) return;
        if (!result.ok) {
          setError(humaniseReason(result.reason));
          setContent(null);
          return;
        }
        const body =
          mode === "summary"
            ? (result as Extract<ViewVideoSummaryResult, { ok: true }>).summary
            : ((result as Extract<ViewVideoTranscriptResult, { ok: true }>)
                .transcript ?? "(no transcript)");
        const videoFetchFailed =
          mode === "transcript"
            ? (result as Extract<ViewVideoTranscriptResult, { ok: true }>)
                .videoFetchFailed === true
            : false;
        setContent({
          mode,
          body,
          auditId: result.auditId,
          auditFailureReason: result.auditFailureReason,
          videoFetchFailed,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("[video-content-modal] action threw", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [videoId, mode]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Video content"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
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
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
              {videoTitle ?? "(untitled video)"}
            </h2>
            <div className="text-sm muted" style={{ marginTop: 2 }}>
              {channelName ?? "—"}
            </div>
          </div>
          <div className="row gap-8" style={{ alignItems: "center" }}>
            <Btn
              size="sm"
              kind={mode === "summary" ? "primary" : "ghost"}
              onClick={() => setMode("summary")}
            >
              Summary
            </Btn>
            <Btn
              size="sm"
              kind={mode === "transcript" ? "primary" : "ghost"}
              onClick={() => setMode("transcript")}
            >
              Transcript
            </Btn>
            <Btn size="sm" kind="ghost" onClick={onClose} aria-label="Close">
              <X size={14} />
            </Btn>
          </div>
        </div>

        <div
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {pending && <span className="muted text-sm">Loading…</span>}
          {!pending && error && (
            <Pill tone="warn">Error: {error}</Pill>
          )}
          {!pending && !error && content && (
            content.auditId
              ? <Pill tone="ok">Audited · {content.auditId.slice(0, 8)}…</Pill>
              : <Pill tone="warn">
                  Audit failed: {content.auditFailureReason ?? "unknown"}
                </Pill>
          )}
          {!pending && !error && content?.videoFetchFailed && (
            <Pill tone="warn">Video metadata unavailable</Pill>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 18 }}>
          {content && content.mode === mode && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {content.body}
            </pre>
          )}
        </div>

        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <Btn size="sm" kind="primary" onClick={onClose}>
            Close
          </Btn>
        </div>
      </div>
    </div>
  );
}

function humaniseReason(reason: string): string {
  switch (reason) {
    case "missing_video_id":
      return "Missing video identifier";
    case "invalid_video_id":
      return "Invalid video identifier";
    case "video_not_found":
      return "Video not found";
    case "internal_error":
      // The action returns `internal_error` for both DB failures and
      // data-integrity failures (unknown transcript_source). Either
      // case is operator-actionable, not user-resolvable.
      return "Could not load — check admin logs.";
    default:
      return reason;
  }
}
