"use client";
import {useTranslations} from "next-intl";
import Image from "next/image";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  RotateCcw,
  Trash2,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ProjectVideo } from "@/lib/projects/project-source-set-contract";


function failureMessage(t: ReturnType<typeof useTranslations<"project">>, failureCode: string | null): string {
  switch (failureCode) {
    case "summary_quota":
      return t("yourSummaryAllowanceIsExhaustedUpgradeOrRetry");
    case "summary_rate_limit":
      return t("tooManyRequestsWereMadeWaitAMoment");
    case "processing_interrupted":
      return t("processingWasInterruptedBeforeItFinishedRetryTo");
    case "summary_persistence":
      return t("theSummaryCouldNotBeSavedDurablyRetry");
    default:
      return t("thisVideoCouldNotBeProcessedRetryOr");
  }
}

function SourceStatus({ video }: { video: ProjectVideo }) {
  const t = useTranslations("project");
  if (video.status === "ready") {
    return (
      <Badge
        variant="outline"
        className="border-accent-success/40 text-accent-success"
      >
        <CheckCircle2 aria-hidden="true" />
        {t("readyLabel")}
      </Badge>
    );
  }
  if (video.status === "processing") {
    return (
      <Badge
        variant="outline"
        className="border-accent-warning/40 text-accent-warning"
      >
        <Clock3 aria-hidden="true" />
        {t("processing")}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <AlertTriangle aria-hidden="true" />
      {t("failed")}
    </Badge>
  );
}

export function VideoThumbnail({
  youtubeVideoId,
}: {
  youtubeVideoId: string | null;
}) {
  return (
    <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-sunken">
      {youtubeVideoId ? (
        <Image
          src={`https://i.ytimg.com/vi/${youtubeVideoId}/mqdefault.jpg`}
          alt=""
          width={80}
          height={48}
          sizes="80px"
          className="h-full w-full object-cover"
        />
      ) : (
        <Video className="text-text-muted" aria-hidden="true" />
      )}
    </div>
  );
}

export function ProjectSourceList({
  videos,
  compact = false,
  pendingAction,
  processUrl,
  move,
  remove,
}: {
  videos: readonly ProjectVideo[];
  compact?: boolean;
  pendingAction: string | null;
  processUrl: (url: string, retryVideoId?: string) => Promise<void>;
  move: (video: ProjectVideo, direction: -1 | 1) => Promise<void>;
  remove: (video: ProjectVideo) => Promise<void>;
}) {
  const t = useTranslations("project");
  return (
    <ol className="flex flex-col gap-3" aria-label={t("orderedProjectVideos")}>
      {videos.map((video, index) => {
        const title = video.title ?? t("untitledVideo");
        const removing = pendingAction === `remove:${video.videoId}`;
        const retrying =
          pendingAction === `process:${video.videoId}`;
        return (
          <li
            key={video.videoId}
            className={compact ? "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-border-subtle bg-surface-raised p-3" : "grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-border-subtle bg-surface-raised p-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center"}
          >
            <span
              className={compact ? "sr-only" : "flex size-8 items-center justify-center rounded-full bg-surface-inverse text-caption font-semibold text-text-inverse"}
              aria-label={t("position", {value1: index + 1})}
            >
              {index + 1}
            </span>
            <VideoThumbnail youtubeVideoId={video.youtubeVideoId} />
            <div className={compact ? "min-w-0" : "col-span-2 min-w-0 sm:col-span-1"}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/summary?url=${encodeURIComponent(video.youtubeUrl)}`}
                  prefetch={false}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="project-source-title"
                  className={`${compact ? "line-clamp-2 text-body-sm" : "text-body-md"} min-w-0 break-words rounded-sm font-medium text-text-primary underline-offset-4 outline-none hover:text-accent-brand hover:underline focus-visible:ring-2 focus-visible:ring-state-focus`}
                  aria-label={t("readOpensInANewTab", {value1: title})}
                  title={title}
                >
                  {title}
                </Link>
                <SourceStatus video={video} />
              </div>
              {video.channelName ? (
                <p className="truncate text-caption text-text-muted">
                  {video.channelName}
                </p>
              ) : null}
              {video.status === "failed" ? (
                <p className="mt-1 text-caption text-accent-danger">
                  {failureMessage(t, video.failureCode)}
                </p>
              ) : null}
            </div>
            <div className={compact ? "col-span-2 flex items-center justify-end gap-1" : "col-span-2 flex items-center justify-end gap-1 sm:col-span-1"}>
              {video.status === "failed" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void processUrl(video.youtubeUrl, video.videoId)
                  }
                  disabled={Boolean(pendingAction)}
                  aria-label={t("retry", {value1: title})}
                >
                  <RotateCcw aria-hidden="true" />
                  {retrying ? t("retrying") : t("retryLabel")}
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon"
                className={compact ? "size-8 text-text-muted" : undefined}
                variant="ghost"
                onClick={() => void move(video, -1)}
                disabled={index === 0 || Boolean(pendingAction)}
                aria-label={t("moveUp", {value1: title})}
                title={t("moveUp", {value1: title})}
              >
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                className={compact ? "size-8 text-text-muted" : undefined}
                variant="ghost"
                onClick={() => void move(video, 1)}
                disabled={
                  index === videos.length - 1 || Boolean(pendingAction)
                }
                aria-label={t("moveDown", {value1: title})}
                title={t("moveDown", {value1: title})}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                className={compact ? "size-8 text-text-muted" : undefined}
                variant="ghost"
                onClick={() => void remove(video)}
                disabled={Boolean(pendingAction)}
                aria-label={t("removeFromSourceSet", {value1: title})}
                title={t("removeFromSourceSet", {value1: title})}
              >
                <Trash2 aria-hidden="true" />
                {removing ? <span className="sr-only">{t("removing")}</span> : null}
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
