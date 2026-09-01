import Link from "next/link";
import { MessageCircle, Video } from "lucide-react";
import type { HistoryRow as HistoryRowType } from "@/lib/services/user-history";
import { formatRelativeTime } from "@/lib/utils/relative-time";
import { cn } from "@/lib/utils";
import { buildChannelHubVideoHref } from "@/lib/channel-hub/links";

type HistoryRowProps = {
  row: HistoryRowType;
  now?: number;
  variant?: "default" | "compact";
  /** Total chat messages this user has on this video. Hidden when 0 / undefined. */
  chatCount?: number;
};

export function HistoryRow({
  row,
  now,
  variant = "default",
  chatCount,
}: HistoryRowProps) {
  const title = row.title ?? "Untitled";
  const summaryHref = `/summary?url=${encodeURIComponent(row.youtubeUrl)}`;
  const channelHref = buildChannelHubVideoHref(row.videoId);
  const dateLabel = formatRelativeTime(row.viewedAt, now);
  const showChatBadge = typeof chatCount === "number" && chatCount > 0;
  const isCompact = variant === "compact";

  return (
    <li className="list-none">
      <div
        className={cn(
          "items-center gap-3 transition-colors duration-fast hover:bg-state-hover",
          isCompact
            ? "flex border-b border-border-subtle px-2 py-3"
            : "flex rounded-md border border-border-subtle bg-surface-raised px-3 py-2",
        )}
      >
        <Link
          href={summaryHref}
          aria-label={`View summary of ${title}`}
          className={cn(
            "group min-w-0 flex-1 items-center gap-3 transition-colors duration-fast focus-visible:bg-state-focus focus-visible:outline-none",
            isCompact
              ? "grid grid-cols-[5rem_minmax(0,1fr)_auto]"
              : "flex",
          )}
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
          <div className="flex shrink-0 items-center gap-3">
            {showChatBadge ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-caption text-text-secondary",
                  !isCompact && "rounded-full bg-surface-sunken px-2 py-0.5",
                )}
                aria-label={`${chatCount} chat message${chatCount === 1 ? "" : "s"}`}
                data-testid="chat-count-badge"
              >
                <MessageCircle className="h-3 w-3" aria-hidden="true" />
                {chatCount}
              </span>
            ) : null}
            <span className="text-caption text-text-muted">{dateLabel}</span>
          </div>
        </Link>
        {channelHref ? (
          <Link
            href={channelHref}
            aria-label={`Open ${title} in Channel Hub`}
            className="ml-3 shrink-0 rounded-md px-2 py-2 text-caption font-medium text-accent-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
          >
            Channel
          </Link>
        ) : null}
      </div>
    </li>
  );
}
