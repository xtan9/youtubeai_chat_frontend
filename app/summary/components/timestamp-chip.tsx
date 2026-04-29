"use client";

import { usePlayerRef } from "@/lib/contexts/player-ref";

interface TimestampChipProps {
  readonly seconds: number;
  readonly raw: string;
}

/**
 * Inline chip rendered for each parsed [mm:ss] / [hh:mm:ss] in an
 * assistant message. Click seeks the embedded YouTube player on the
 * right-hand side of the page (no-op if no player is mounted).
 */
export function TimestampChip({ seconds, raw }: TimestampChipProps) {
  const { seekTo } = usePlayerRef();
  return (
    <button
      type="button"
      onClick={() => seekTo(seconds)}
      className="mx-0.5 inline-flex items-center rounded-md border border-border-default bg-surface-raised px-1.5 py-0 text-body-sm font-medium text-accent-brand hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-state-focus"
      aria-label={`Seek video to ${raw}`}
    >
      {raw}
    </button>
  );
}
