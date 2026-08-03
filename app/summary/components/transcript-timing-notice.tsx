"use client";

import type { SummaryTranscriptState } from "@/lib/summary-run";

export type TranscriptTimingStatus = SummaryTranscriptState["status"];
type UnavailableTranscriptTimingStatus = Exclude<
  TranscriptTimingStatus,
  "available"
>;

interface TranscriptTimingNoticeProps {
  readonly status: UnavailableTranscriptTimingStatus;
  readonly testId?: string;
}

const NOTICE_COPY: Record<UnavailableTranscriptTimingStatus, string> = {
  unavailable:
    "Transcript timing is unavailable, so timestamp seeking is unavailable.",
  not_requested:
    "Transcript timing was not requested, so timestamp seeking is unavailable.",
};

export function TranscriptTimingNotice({
  status,
  testId = "transcript-timing-notice",
}: TranscriptTimingNoticeProps) {
  return (
    <p
      role="status"
      data-testid={testId}
      data-transcript-status={status}
      className="rounded-md border border-border-subtle bg-surface-raised px-3 py-2 text-body-sm text-text-secondary"
    >
      {NOTICE_COPY[status]}
    </p>
  );
}
