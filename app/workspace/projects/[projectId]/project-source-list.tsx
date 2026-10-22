"use client";
import Image from "next/image";
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

const STATUS_LABELS = {
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
} as const;

function failureMessage(failureCode: string | null): string {
  switch (failureCode) {
    case "summary_quota":
      return "Your Summary allowance is exhausted. Upgrade or retry after it resets.";
    case "summary_rate_limit":
      return "Too many requests were made. Wait a moment, then retry.";
    case "processing_interrupted":
      return "Processing was interrupted before it finished. Retry to continue.";
    case "summary_persistence":
      return "The Summary could not be saved durably. Retry to continue.";
    default:
      return "This Video could not be processed. Retry or remove it.";
  }
}

function SourceStatus({ video }: { video: ProjectVideo }) {
  if (video.status === "ready") {
    return (
      <Badge
        variant="outline"
        className="border-accent-success/40 text-accent-success"
      >
        <CheckCircle2 aria-hidden="true" />
        {STATUS_LABELS.ready}
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
        {STATUS_LABELS.processing}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <AlertTriangle aria-hidden="true" />
      {STATUS_LABELS.failed}
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
  pendingAction,
  processUrl,
  move,
  remove,
}: {
  videos: readonly ProjectVideo[];
  pendingAction: string | null;
  processUrl: (url: string, retryVideoId?: string) => Promise<void>;
  move: (video: ProjectVideo, direction: -1 | 1) => Promise<void>;
  remove: (video: ProjectVideo) => Promise<void>;
}) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Ordered Project Videos">
      {videos.map((video, index) => {
        const title = video.title ?? "Untitled Video";
        const removing = pendingAction === `remove:${video.videoId}`;
        const retrying =
          pendingAction === `process:${video.videoId}`;
        return (
          <li
            key={video.videoId}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-md border border-border-subtle bg-surface-raised p-3 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] sm:items-center"
          >
            <span
              className="flex size-8 items-center justify-center rounded-full bg-surface-inverse text-caption font-semibold text-text-inverse"
              aria-label={`Position ${index + 1}`}
            >
              {index + 1}
            </span>
            <VideoThumbnail youtubeVideoId={video.youtubeVideoId} />
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  data-testid="project-source-title"
                  className="truncate text-body-md font-medium text-text-primary"
                >
                  {title}
                </p>
                <SourceStatus video={video} />
              </div>
              {video.channelName ? (
                <p className="truncate text-caption text-text-muted">
                  {video.channelName}
                </p>
              ) : null}
              {video.status === "failed" ? (
                <p className="mt-1 text-caption text-accent-danger">
                  {failureMessage(video.failureCode)}
                </p>
              ) : null}
            </div>
            <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
              {video.status === "failed" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void processUrl(video.youtubeUrl, video.videoId)
                  }
                  disabled={Boolean(pendingAction)}
                  aria-label={`Retry ${title}`}
                >
                  <RotateCcw aria-hidden="true" />
                  {retrying ? "Retrying…" : "Retry"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => void move(video, -1)}
                disabled={index === 0 || Boolean(pendingAction)}
                aria-label={`Move ${title} up`}
                title={`Move ${title} up`}
              >
                <ChevronUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => void move(video, 1)}
                disabled={
                  index === videos.length - 1 || Boolean(pendingAction)
                }
                aria-label={`Move ${title} down`}
                title={`Move ${title} down`}
              >
                <ChevronDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => void remove(video)}
                disabled={Boolean(pendingAction)}
                aria-label={`Remove ${title} from Source Set`}
                title={`Remove ${title} from Source Set`}
              >
                <Trash2 aria-hidden="true" />
                {removing ? <span className="sr-only">Removing</span> : null}
              </Button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
