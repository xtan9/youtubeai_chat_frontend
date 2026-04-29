"use client";

import { useEffect, useRef } from "react";
import { X, Download, ChevronDown } from "lucide-react";
import { Btn, Pill } from "./atoms";
import { useAdmin } from "./admin-context";
import type { TranscriptSummary } from "@/lib/admin/types";

interface TranscriptModalProps {
  summary: TranscriptSummary;
  onClose: () => void;
}

export function TranscriptModal({ summary: s, onClose }: TranscriptModalProps) {
  const { email: adminEmail } = useAdmin();
  const closeRef = useRef<HTMLButtonElement>(null);
  const ts = new Date().toISOString().replace("T", " ").slice(11, 19);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
        style={{ width: "min(820px, 92vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="banner-audit">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="dot" />
            <strong>You are viewing as admin · this view will be logged</strong>
            <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
              · {adminEmail} · {ts} UTC
            </span>
          </div>
          <span className="mono text-xs" style={{ color: "var(--text-3)" }}>
            mock data · audit-write pending
          </span>
        </div>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
                {s.title}
              </h2>
              <div className="text-sm muted" style={{ marginTop: 4 }}>
                {s.channel} · created Apr 21, 2026 09:14 UTC
              </div>
            </div>
            <Btn ref={closeRef} size="sm" kind="ghost" onClick={onClose} aria-label="Close">
              <X size={14} />
            </Btn>
          </div>
          <div className="row gap-6" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <Pill mono>youtube.com/watch?v=…aQF</Pill>
            <Pill>{s.lang}</Pill>
            <Pill tone={s.source === "whisper" ? "warn" : "ok"}>{s.source}</Pill>
            <Pill mono>{s.model}</Pill>
            <Pill>{s.time}s</Pill>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: "14px 20px", borderRight: "1px solid var(--border)", overflow: "auto" }}>
            <div
              className="text-xs muted"
              style={{ textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}
            >
              Summary
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text)" }}>
              <p style={{ margin: "0 0 10px" }}>
                Sutton&apos;s central claim: the methods that scale with computation, end up winning. Hand-engineered shortcuts feel productive in the short term but consistently lose to general approaches that absorb compute.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                Three running examples: chess (Deep Blue → AlphaZero), speech recognition (HMMs → end-to-end neural), and computer vision (hand-crafted features → ConvNets). In each case, the lesson was learned painfully late.
              </p>
              <p style={{ margin: 0 }}>
                The talk closes on the implication for current ML practice: stop trying to bake in the structure of human cognition. It&apos;s the bitter pill, but it&apos;s also the only one that has worked.
              </p>
            </div>
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
              }}
            >
              <div
                className="text-xs"
                style={{
                  color: "var(--text-2)",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                }}
              >
                <span>Thinking · 4,128 tokens</span>
                <ChevronDown size={12} />
              </div>
            </div>
          </div>

          <div style={{ padding: "14px 20px", overflow: "auto" }}>
            <div
              className="text-xs muted"
              style={{ textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}
            >
              Transcript · 12,402 chars
            </div>
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.65,
                color: "var(--text-2)",
                fontFamily: "var(--mono)",
              }}
            >
              <p style={{ margin: "0 0 10px" }}>
                <span style={{ color: "var(--text-3)" }}>[00:00:14]</span> So I want to talk today about a pattern that I keep seeing in machine learning research, and that I think is the single most important thing for anyone working in the field to internalize…
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <span style={{ color: "var(--text-3)" }}>[00:01:32]</span> The bitter lesson is that general methods that leverage computation are ultimately the most effective, and by a large margin. The two methods that seem to scale arbitrarily in this way are search and learning…
              </p>
              <p style={{ margin: 0 }}>
                <span style={{ color: "var(--text-3)" }}>[00:03:08]</span> Consider chess. In 1997, the methods that defeated the world champion were largely based on massive deep search. At the time, this was looked upon with dismay by the majority of researchers who…
              </p>
            </div>
          </div>
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
            Reason logged: <strong style={{ color: "var(--text-2)" }}>abuse review · ticket #4821</strong>
          </div>
          <div className="row gap-6">
            <Btn size="sm" kind="ghost">
              <Download size={12} /> Download .txt
            </Btn>
            <Btn size="sm" kind="ghost">Copy link</Btn>
            <Btn size="sm" kind="primary" onClick={onClose}>
              Close
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
