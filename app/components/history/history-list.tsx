import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";
import { HistoryRow } from "./history-row";
import { EmptyHistoryState } from "./empty-history-state";

type HistoryListProps = {
  rows: HistoryRowType[];
  now?: number;
};

export function HistoryList({ rows, now }: HistoryListProps) {
  if (rows.length === 0) {
    return <EmptyHistoryState />;
  }
  return (
    <ol className="flex flex-col gap-2 p-0">
      {rows.map((row) => (
        <HistoryRow key={row.videoId} row={row} now={now} />
      ))}
    </ol>
  );
}
