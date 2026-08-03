"use client";

import { usePlayerRef } from "@/lib/contexts/player-ref";
import type { TranscriptTimingStatus } from "./transcript-timing-notice";

interface TimestampChipProps {
  readonly seconds: number;
  readonly raw: string;
  readonly transcriptTimingStatus?: TranscriptTimingStatus;
}

/**
 * Inline chip rendered for each parsed [mm:ss] / [hh:mm:ss] in an
 * assistant message. Click seeks the embedded YouTube player on the
 * right-hand side of the page (no-op if no player is mounted).
 */
export function TimestampChip({
  seconds,
  raw,
  transcriptTimingStatus = "available",
}: TimestampChipProps) {
  const { seekTo } = usePlayerRef();
  const timingAvailable = transcriptTimingStatus === "available";
  const ariaLabel = timingAvailable
    ? `Seek video to ${raw}`
    : `Timestamp ${raw}; Transcript timing ${
        transcriptTimingStatus === "not_requested"
          ? "not requested"
          : "unavailable"
      }`;
  return (
    <button
      type="button"
      onClick={() => {
        if (timingAvailable) seekTo(seconds);
      }}
      disabled={!timingAvailable}
      aria-disabled={!timingAvailable}
      title={timingAvailable ? undefined : "Timestamp seeking is unavailable"}
      className="mx-0.5 inline-flex items-center rounded-md border border-border-default bg-surface-raised px-1.5 py-0 text-body-sm font-medium text-accent-brand hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-state-focus disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={ariaLabel}
    >
      {raw}
    </button>
  );
}
