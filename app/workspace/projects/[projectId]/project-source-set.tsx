"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROJECT_VIDEO_LIMIT,
  type ProjectHistoryCandidate,
  type ProjectHistoryCandidatePage,
  type ProjectSourceSet as ProjectSourceSetValue,
  type ProjectVideo,
} from "@/lib/projects/project-source-set-contract";

type ProjectSourceSetProps = {
  projectId: string;
  initialSourceSet: ProjectSourceSetValue;
  initialCandidatePage: ProjectHistoryCandidatePage | null;
};

type SourceSetPayload = {
  outcome?: string;
  message?: string;
  sourceSet?: ProjectSourceSetValue;
  upgradeUrl?: string;
};

type CandidatePayload = {
  candidatePage?: ProjectHistoryCandidatePage;
  message?: string;
};

async function readSourceSetPayload(
  response: Response,
): Promise<SourceSetPayload> {
  try {
    return (await response.json()) as SourceSetPayload;
  } catch {
    return {};
  }
}

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

function VideoThumbnail({
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

export function ProjectSourceSet({
  projectId,
  initialSourceSet,
  initialCandidatePage,
}: ProjectSourceSetProps) {
  const [sourceSet, setSourceSet] = useState(initialSourceSet);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidatePage, setCandidatePage] = useState(initialCandidatePage);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(initialCandidatePage?.search ?? "");
  const [appliedSearch, setAppliedSearch] = useState(
    initialCandidatePage?.search ?? "",
  );

  const memberIds = useMemo(
    () => new Set(sourceSet.videos.map((video) => video.videoId)),
    [sourceSet.videos],
  );
  const availableHistory = (candidatePage?.candidates ?? []).filter(
    (candidate) => !memberIds.has(candidate.videoId),
  );
  const atLimit = sourceSet.videos.length >= PROJECT_VIDEO_LIMIT;
  const readyCount = sourceSet.videos.filter(
    (video) => video.status === "ready",
  ).length;
  const unavailableCount = sourceSet.videos.length - readyCount;
  const processingCount = sourceSet.videos.filter(
    (video) => video.status === "processing",
  ).length;
  const candidateCountLabel =
    candidatePage && candidatePage.total > 0
      ? `History search results: ${candidatePage.total} processed ${candidatePage.total === 1 ? "Video" : "Videos"} available${appliedSearch ? ` for ${appliedSearch}` : ""}`
      : null;

  function acceptLatest(next: ProjectSourceSetValue | undefined) {
    if (!next) return;
    setSourceSet((current) => (next.revision >= current.revision ? next : current));
  }

  useEffect(() => {
    if (processingCount === 0) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/source-set`, {
          cache: "no-store",
        });
        const payload = await readSourceSetPayload(response);
        if (!disposed && response.ok && payload.sourceSet) {
          const next = payload.sourceSet;
          setSourceSet((current) =>
            next.revision >= current.revision ? next : current,
          );
        }
      } catch {
        // A later poll or explicit retry remains available. Keep the last
        // durable snapshot rather than replacing it with a transport error.
      } finally {
        if (!disposed) timer = setTimeout(poll, 1_500);
      }
    };

    timer = setTimeout(poll, 750);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [processingCount, projectId]);

  async function refreshSourceSet() {
    try {
      const response = await fetch(`/api/projects/${projectId}/source-set`, {
        cache: "no-store",
      });
      const payload = await readSourceSetPayload(response);
      if (response.ok) acceptLatest(payload.sourceSet);
    } catch {
      // Preserve the current durable snapshot; a later poll or retry can heal.
    }
  }

  async function processUrl(url: string, actionId = "new") {
    if (pendingAction) return;
    setPendingAction(`process:${actionId}`);
    setError(null);
    setNotice(null);
    setUpgradeUrl(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/source-set/process`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            youtubeUrl: url,
            expectedRevision: sourceSet.revision,
          }),
        },
      );
      const payload = await readSourceSetPayload(response);
      acceptLatest(payload.sourceSet);
      if (!response.ok) {
        setError(payload.message ?? "Couldn’t process that Video. Try again.");
        setUpgradeUrl(payload.upgradeUrl ?? null);
        await refreshSourceSet();
        return;
      }

      if (payload.outcome === "already_ready") {
        setNotice("That Video is already ready in this Project.");
      } else if (payload.outcome === "already_processing") {
        setNotice("That Video is already processing. Its status will update here.");
      } else {
        setNotice("Video accepted. Processing will continue if you leave this page.");
      }
      setYoutubeUrl("");
      if (!payload.sourceSet) await refreshSourceSet();
    } catch {
      setError("Couldn’t process that Video. Check your connection and try again.");
      await refreshSourceSet();
    } finally {
      setPendingAction(null);
    }
  }

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!youtubeUrl.trim() || atLimit) return;
    void processUrl(youtubeUrl.trim());
  }

  async function loadCandidates(page: number, search: string) {
    setCandidateLoading(true);
    setCandidateError(null);
    const normalizedSearch = search.trim();
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (normalizedSearch) params.set("search", normalizedSearch);
      const response = await fetch(
        `/api/projects/${projectId}/source-set/candidates?${params.toString()}`,
      );
      let payload: CandidatePayload = {};
      try {
        payload = (await response.json()) as CandidatePayload;
      } catch {
        // The actionable fallback below is more useful than a parse detail.
      }
      if (!response.ok || !payload.candidatePage) {
        setCandidateError(
          payload.message ??
            "Couldn’t load processed History Videos. Check your connection and try again.",
        );
        return;
      }
      setCandidatePage(payload.candidatePage);
      setAppliedSearch(normalizedSearch);
    } catch {
      setCandidateError(
        "Couldn’t load processed History Videos. Check your connection and try again.",
      );
    } finally {
      setCandidateLoading(false);
    }
  }

  function changePickerOpen(open: boolean) {
    setPickerOpen(open);
    if (open) {
      setError(null);
      void loadCandidates(1, searchInput);
    }
  }

  function searchCandidates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadCandidates(1, searchInput);
  }

  async function add(candidate: ProjectHistoryCandidate) {
    const action = `add:${candidate.videoId}`;
    if (pendingAction || atLimit) return;
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/source-set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: candidate.videoId,
          expectedRevision: sourceSet.revision,
        }),
      });
      const payload = await readSourceSetPayload(response);
      acceptLatest(payload.sourceSet);
      if (!response.ok) {
        setError(payload.message ?? "Couldn’t add that History Video. Try again.");
        setPickerOpen(false);
        return;
      }
      setNotice(`Added ${candidate.title ?? "Untitled Video"}.`);
      setSearchInput("");
      setAppliedSearch("");
      setPickerOpen(false);
    } catch {
      setError("Couldn’t add that History Video. Check your connection and try again.");
      setPickerOpen(false);
    } finally {
      setPendingAction(null);
    }
  }

  async function remove(video: ProjectVideo) {
    const action = `remove:${video.videoId}`;
    if (pendingAction) return;
    setPendingAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/source-set/${video.videoId}?revision=${sourceSet.revision}`,
        { method: "DELETE" },
      );
      const payload = await readSourceSetPayload(response);
      acceptLatest(payload.sourceSet);
      if (!response.ok) {
        setError(payload.message ?? "Couldn’t remove that Video. Try again.");
        return;
      }
      setNotice(`Removed ${video.title ?? "Untitled Video"}.`);
    } catch {
      setError("Couldn’t remove that Video. Check your connection and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function move(video: ProjectVideo, direction: -1 | 1) {
    if (pendingAction) return;
    const currentIndex = sourceSet.videos.findIndex(
      (candidate) => candidate.videoId === video.videoId,
    );
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sourceSet.videos.length) {
      return;
    }

    const reordered = sourceSet.videos.map((candidate) => candidate.videoId);
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];
    setPendingAction(`move:${video.videoId}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/source-set`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: reordered,
          expectedRevision: sourceSet.revision,
        }),
      });
      const payload = await readSourceSetPayload(response);
      acceptLatest(payload.sourceSet);
      if (!response.ok) {
        setError(payload.message ?? "Couldn’t reorder the Source Set. Try again.");
        return;
      }
      setNotice("Source order updated.");
    } catch {
      setError("Couldn’t reorder the Source Set. Check your connection and try again.");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section aria-labelledby="source-set-heading">
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border-subtle bg-surface-sunken/50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="source-set-heading" className="text-h4 font-semibold text-text-primary">
                  Source Set
                </h2>
                <Badge
                  variant="secondary"
                  role="status"
                  aria-label={`${sourceSet.videos.length} of ${PROJECT_VIDEO_LIMIT} Project Videos`}
                >
                  <span aria-hidden="true">
                    {sourceSet.videos.length} of {PROJECT_VIDEO_LIMIT}
                  </span>
                </Badge>
              </div>
              <p className="max-w-prose text-body-sm text-text-secondary">
                Order the canonical Videos this Project can use as evidence.
              </p>
            </div>

            <Dialog open={pickerOpen} onOpenChange={changePickerOpen}>
              <DialogTrigger asChild>
                <Button disabled={atLimit || Boolean(pendingAction)}>
                  <Plus aria-hidden="true" />
                  Add from History
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add a History Video</DialogTitle>
                  <DialogDescription>
                    Choose a processed canonical Video whose Transcript and Summary are ready. Project membership reuses that evidence without copying it.
                  </DialogDescription>
                </DialogHeader>

                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={searchCandidates}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Label htmlFor="project-history-search">Search History</Label>
                    <Input
                      id="project-history-search"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder="Video title or channel"
                      maxLength={100}
                    />
                  </div>
                  <Button type="submit" variant="outline" disabled={candidateLoading}>
                    <Search aria-hidden="true" />
                    Search
                  </Button>
                </form>

                {candidateLoading ? (
                  <p role="status" className="text-body-sm text-text-secondary">
                    Loading processed History Videos…
                  </p>
                ) : candidateError ? (
                  <Alert>
                    <AlertTriangle aria-hidden="true" />
                    <AlertTitle>Processed History is unavailable</AlertTitle>
                    <AlertDescription>
                      {candidateError}
                    </AlertDescription>
                  </Alert>
                ) : !candidatePage || candidatePage.total === 0 ? (
                  <p className="rounded-md border border-border-subtle bg-surface-sunken px-4 py-6 text-body-sm text-text-secondary">
                    {appliedSearch
                      ? `No processed History Videos match “${appliedSearch}”. Try another title or channel.`
                      : "No processed History Videos are available. A Video appears here only after its canonical Transcript and Summary are ready."}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p
                      className="text-caption text-text-muted"
                      role="status"
                      aria-label={candidateCountLabel ?? undefined}
                    >
                      {candidatePage.total} processed {candidatePage.total === 1 ? "Video" : "Videos"} available
                      {appliedSearch ? ` for “${appliedSearch}”` : ""}.
                    </p>
                    {availableHistory.length === 0 ? (
                      <p className="rounded-md border border-border-subtle bg-surface-sunken px-4 py-6 text-body-sm text-text-secondary">
                        This page no longer has available Videos. Move to another page or search again.
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2" aria-label="Processed History Videos">
                        {availableHistory.map((candidate) => {
                          const title = candidate.title ?? "Untitled Video";
                          const adding = pendingAction === `add:${candidate.videoId}`;
                          return (
                            <li
                              key={candidate.videoId}
                              className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-raised p-3 sm:flex-row sm:items-center"
                            >
                              <VideoThumbnail youtubeVideoId={candidate.youtubeVideoId} />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-body-sm font-medium text-text-primary">
                                  {title}
                                </p>
                                {candidate.channelName ? (
                                  <p className="truncate text-caption text-text-muted">
                                    {candidate.channelName}
                                  </p>
                                ) : null}
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void add(candidate)}
                                disabled={Boolean(pendingAction)}
                                aria-label={`Add ${title} to Source Set`}
                              >
                                <Plus aria-hidden="true" />
                                {adding ? "Adding…" : "Add"}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={candidatePage.page <= 1 || candidateLoading}
                        onClick={() =>
                          void loadCandidates(candidatePage.page - 1, appliedSearch)
                        }
                      >
                        <ChevronLeft aria-hidden="true" />
                        Previous
                      </Button>
                      <span className="text-caption text-text-muted">
                        Page {candidatePage.page} of {candidatePage.totalPages}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          candidatePage.page >= candidatePage.totalPages ||
                          candidateLoading
                        }
                        onClick={() =>
                          void loadCandidates(candidatePage.page + 1, appliedSearch)
                        }
                      >
                        Next
                        <ChevronRight aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 pt-6">
          <p className="text-body-sm text-text-secondary">
            Five Videos is the grounding limit for every plan. A bounded Source Set keeps retrieval and Source Coverage honest.
          </p>

          <form
            className="rounded-md border border-border-subtle bg-surface-sunken p-4"
            onSubmit={submitUrl}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="project-youtube-url">YouTube Video URL</Label>
                <Input
                  id="project-youtube-url"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  disabled={atLimit || Boolean(pendingAction)}
                  required
                  aria-describedby="project-youtube-url-description"
                />
                <p
                  id="project-youtube-url-description"
                  className="text-caption text-text-muted"
                >
                  Paste one Video. Its canonical Transcript and Summary will be reused when available.
                </p>
              </div>
              <Button
                type="submit"
                disabled={
                  atLimit || Boolean(pendingAction) || !youtubeUrl.trim()
                }
              >
                <Plus aria-hidden="true" />
                {pendingAction === "process:new" ? "Processing…" : "Add Video"}
              </Button>
            </div>
          </form>

          {atLimit ? (
            <Alert role="note">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Source Set limit reached</AlertTitle>
              <AlertDescription>
                Remove a Video before adding another; upgrading does not increase this grounding limit.
              </AlertDescription>
            </Alert>
          ) : null}

          {unavailableCount > 0 ? (
            <Alert role="note">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>
                {unavailableCount} of {sourceSet.videos.length} Project Videos unavailable
              </AlertTitle>
              <AlertDescription>
                Grounded actions will use only the {readyCount} ready {readyCount === 1 ? "Video" : "Videos"}; processing and failed sources are never silently included.
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <div className="flex flex-wrap items-center gap-3" role="alert">
              <p className="text-body-sm text-accent-danger">{error}</p>
              {upgradeUrl ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={upgradeUrl}>View plans</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
          {notice ? (
            <p role="status" className="text-body-sm text-accent-success">
              {notice}
            </p>
          ) : null}
          {processingCount > 0 ? (
            <p role="status" className="sr-only">
              {processingCount} Project {processingCount === 1 ? "Video is" : "Videos are"} processing.
            </p>
          ) : null}

          {sourceSet.videos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-default bg-surface-sunken px-6 py-10 text-center">
              <Video className="text-text-muted" aria-hidden="true" />
              <div className="flex flex-col gap-1">
                <p className="text-body-md font-medium text-text-primary">
                  Add your first source
                </p>
                <p className="text-body-sm text-text-muted">
                  Paste a YouTube URL above or choose a processed Video from History.
                </p>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-3" aria-label="Ordered Project Videos">
              {sourceSet.videos.map((video, index) => {
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
                          index === sourceSet.videos.length - 1 || Boolean(pendingAction)
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
          )}
        </CardContent>
      </Card>
    </section>
  );
}
