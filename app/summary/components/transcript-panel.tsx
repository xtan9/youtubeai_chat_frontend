"use client";

import type { MutableRefObject } from "react";
import type { YouTubePlayer } from "react-youtube";
import { Button } from "@/components/ui/button";
import type { SummaryTranscriptState } from "@/lib/summary-run";
import TranscriptParagraphs from "./transcript-paragraphs";
import { TranscriptTimingNotice } from "./transcript-timing-notice";

export type TranscriptPanelPhase =
  | "processing"
  | "complete"
  | "failed"
  | "cancelled";

interface TranscriptPanelProps {
  readonly phase: TranscriptPanelPhase;
  readonly transcript?: SummaryTranscriptState;
  readonly playerRef: MutableRefObject<YouTubePlayer | null>;
  readonly onRetry: () => void;
  readonly onRevealVideo?: () => void;
}

function TranscriptStateMessage({
  phase,
  onRetry,
}: Pick<TranscriptPanelProps, "phase" | "onRetry">) {
  if (phase === "processing") {
    return (
      <div
        role="status"
        className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-5"
      >
        <h2 className="font-medium text-text-primary">Transcript</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Transcript will appear when processing is complete.
        </p>
      </div>
    );
  }

  const cancelled = phase === "cancelled";
  return (
    <div
      role={cancelled ? "status" : "alert"}
      className="rounded-lg border border-border-subtle bg-surface-raised px-4 py-5"
    >
      <h2 className="font-medium text-text-primary">
        {cancelled ? "Transcript processing was cancelled" : "Transcript unavailable"}
      </h2>
      <p className="mt-1 text-body-sm text-text-secondary">
        {cancelled
          ? "Run the summary again to create the Transcript."
          : "The Transcript could not be produced. Retry the Summary to try again."}
      </p>
      <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
        Retry summary
      </Button>
    </div>
  );
}

export function TranscriptPanel({
  phase,
  transcript,
  playerRef,
  onRetry,
  onRevealVideo,
}: TranscriptPanelProps) {
  if (phase !== "complete") {
    return <TranscriptStateMessage phase={phase} onRetry={onRetry} />;
  }

  if (!transcript) {
    return <TranscriptStateMessage phase="failed" onRetry={onRetry} />;
  }

  if (transcript.status !== "available") {
    return <TranscriptTimingNotice status={transcript.status} />;
  }

  if (transcript.segments.length === 0) {
    return (
      <p
        role="status"
        className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-body-sm text-text-secondary"
      >
        This Transcript does not contain any readable segments.
      </p>
    );
  }

  return (
    <TranscriptParagraphs
      segments={transcript.segments}
      playerRef={playerRef}
      transcriptSource={transcript.source}
      onTimestampActivated={onRevealVideo}
    />
  );
}
