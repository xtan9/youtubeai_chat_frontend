import Link from "next/link";
import { Video } from "lucide-react";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";
import { formatRelativeTime } from "@/lib/utils/relative-time";

type HistoryRowProps = {
  row: HistoryRowType;
  now?: number;
};

export function HistoryRow({ row, now }: HistoryRowProps) {
  const title = row.title ?? "Untitled";
  const summaryHref = `/summary?url=${encodeURIComponent(row.youtubeUrl)}`;
  const dateLabel = formatRelativeTime(row.viewedAt, now);

  return (
    <li className="list-none">
      <Link
        href={summaryHref}
        aria-label={`View summary of ${title}`}
        className="group flex items-center gap-3 rounded-md border border-border-subtle bg-surface-raised px-3 py-2 transition-colors duration-fast hover:bg-state-hover focus-visible:bg-state-focus focus-visible:outline-none"
      >
        <div className="flex h-[45px] w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-sunken">
          {row.youtubeVideoId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://i.ytimg.com/vi/${row.youtubeVideoId}/mqdefault.jpg`}
              alt=""
              loading="lazy"
              width={80}
              height={45}
              className="h-full w-full object-cover"
            />
          ) : (
            <Video className="h-5 w-5 text-text-muted" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-md font-medium text-text-primary">
            {title}
          </p>
          {row.channelName ? (
            <p className="truncate text-caption text-text-muted">
              {row.channelName}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-caption text-text-muted">
          {dateLabel}
        </span>
      </Link>
    </li>
  );
}
