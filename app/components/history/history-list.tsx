import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";
import { HistoryRow } from "./history-row";
import { EmptyHistoryState } from "./empty-history-state";

type HistoryListProps = {
  rows: HistoryRowType[];
  now?: number;
  variant?: "default" | "compact";
  /**
   * Per-video chat-message count keyed by `videoId`. Optional — pages
   * that don't fetch counts (or want to render without badges) may omit
   * this; the row hides the badge when no count is present or count is 0.
   */
  chatCounts?: ReadonlyMap<string, number>;
};

export function HistoryList({
  rows,
  now,
  variant = "default",
  chatCounts,
}: HistoryListProps) {
  if (rows.length === 0) {
    return <EmptyHistoryState />;
  }
  return (
    <ol
      className={
        variant === "compact"
          ? "flex flex-col p-0"
          : "flex flex-col gap-2 p-0"
      }
    >
      {rows.map((row) => (
        <HistoryRow
          key={row.videoId}
          row={row}
          now={now}
          variant={variant}
          chatCount={chatCounts?.get(row.videoId)}
        />
      ))}
    </ol>
  );
}
