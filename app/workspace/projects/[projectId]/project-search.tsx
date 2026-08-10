"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, ExternalLink, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { classifyProjectActionHttpFailure } from "@/lib/analytics/project-activity";
import {
  PROJECT_PASSAGE_SEARCH_QUERY_MAX_LENGTH,
  PROJECT_PASSAGE_SEARCH_QUERY_MIN_LENGTH,
  ProjectPassageSearchResponseSchema,
  projectPassageSearchCodePointLength,
  type ProjectPassageSearchResolution,
  type ProjectSearchCoverage,
  type ProjectTranscriptPassage,
  type ProjectUnavailableVideo,
} from "@/lib/projects/project-passage-search-contract";
import { formatTimestamp } from "@/lib/utils/timestamp-citations";

type DisplayedSearch = Extract<
  ProjectPassageSearchResolution,
  { status: "ready" | "no_results" | "not_ready" }
>;

function watchAtTimestampHref(passage: ProjectTranscriptPassage) {
  const timestamp = Math.max(0, Math.floor(passage.startSeconds));
  return `https://www.youtube.com/watch?v=${passage.youtubeVideoId}&t=${timestamp}s`;
}

function passageTimestamp(passage: ProjectTranscriptPassage) {
  const start = formatTimestamp(passage.startSeconds);
  if (passage.endSeconds === null) return start;
  return `${start}–${formatTimestamp(passage.endSeconds)}`;
}

function unavailableStatus(video: ProjectUnavailableVideo) {
  switch (video.status) {
    case "processing":
      return "Processing";
    case "failed":
      return "Failed";
    case "unavailable":
      return "Evidence unavailable";
  }
}

function CoverageNotice({ coverage }: { coverage: ProjectSearchCoverage }) {
  if (coverage.unavailableVideos.length === 0) return null;

  return (
    <Alert role="note">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>
        {coverage.readyVideos} of {coverage.totalVideos} Project Videos searched
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>
          Only ready Transcripts contribute exact passages. These Videos were
          excluded from this search:
        </p>
        <ul className="flex flex-col gap-1" aria-label="Unavailable search coverage">
          {coverage.unavailableVideos.map((video) => (
            <li key={video.videoId} className="flex flex-wrap items-center gap-2">
              <span>{video.title ?? "Untitled Video"}</span>
              <Badge variant="secondary">{unavailableStatus(video)}</Badge>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function SearchResults({ search }: { search: DisplayedSearch }) {
  if (search.status === "not_ready") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>No ready Project Transcripts</AlertTitle>
          <AlertDescription>
            Add a processed History Video or wait for processing to finish.
            Project Search never includes processing or failed Videos silently.
          </AlertDescription>
        </Alert>
        <CoverageNotice coverage={search.coverage} />
      </div>
    );
  }

  if (search.status === "no_results") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border-subtle bg-surface-sunken px-4 py-6">
          <p className="text-body-md font-medium text-text-primary">
            No matching Transcript passages
          </p>
          <p className="mt-1 text-body-sm text-text-secondary">
            {search.coverage.unavailableVideos.length > 0
              ? "No ready Transcript matched. Review the unavailable coverage below or try different terms."
              : `All ${search.coverage.readyVideos} ready Project ${search.coverage.readyVideos === 1 ? "Transcript was" : "Transcripts were"} searched. Try a related term or shorter phrase.`}
          </p>
        </div>
        <CoverageNotice coverage={search.coverage} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body-sm text-text-secondary">
        {search.passages.length} exact Transcript
        {search.passages.length === 1 ? " passage" : " passages"} found across{" "}
        {search.coverage.readyVideos} ready
        {search.coverage.readyVideos === 1 ? " Video" : " Videos"}.
      </p>
      <CoverageNotice coverage={search.coverage} />
      <ol className="flex flex-col gap-4" aria-label="Project Search results">
        {search.passages.map((passage) => {
          const title = passage.title ?? "Untitled Video";
          return (
            <li
              key={passage.passageId}
              className="rounded-md border border-border-subtle bg-surface-raised p-4"
            >
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-body-sm font-medium text-text-primary">
                    {title}
                  </p>
                  {passage.channelName ? (
                    <p className="truncate text-caption text-text-muted">
                      {passage.channelName}
                    </p>
                  ) : null}
                </div>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={watchAtTimestampHref(passage)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${title} at ${formatTimestamp(passage.startSeconds)}`}
                  >
                    {passageTimestamp(passage)}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              </div>
              <blockquote className="border-l-2 border-border-strong pl-4 text-body-md text-text-primary">
                {passage.truncatedStart ? <span aria-hidden="true">…</span> : null}
                <span data-testid="project-search-passage">{passage.text}</span>
                {passage.truncatedEnd ? <span aria-hidden="true">…</span> : null}
              </blockquote>
              <p className="mt-3 text-caption text-text-muted">
                Exact Transcript excerpt · {passage.language}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ProjectSearch({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<DisplayedSearch | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const normalizedQuery = query.trim();
    const queryLength = projectPassageSearchCodePointLength(normalizedQuery);
    if (
      queryLength < PROJECT_PASSAGE_SEARCH_QUERY_MIN_LENGTH ||
      queryLength > PROJECT_PASSAGE_SEARCH_QUERY_MAX_LENGTH
    ) {
      setError("Enter 2 to 200 characters to search Project Transcripts.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: normalizedQuery }),
      });
      let payload: { search?: unknown; message?: string } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        if (response.ok) {
          captureAnalyticsEvent("project_action_failed", {
            project_id: projectId,
            action_kind: "search",
            error_class: "protocol",
          });
          setSearch(null);
          setError("Project Search returned an invalid response. Try again.");
          return;
        }
      }
      if (!response.ok) {
        captureAnalyticsEvent("project_action_failed", {
          project_id: projectId,
          action_kind: "search",
          error_class: classifyProjectActionHttpFailure(response.status),
          ...(response.status >= 400 && response.status <= 599
            ? { http_status: response.status }
            : {}),
        });
        setSearch(null);
        setError(
          payload.message ??
            "Project Search is unavailable. Check your connection and try again.",
        );
        return;
      }

      const parsed = ProjectPassageSearchResponseSchema.safeParse(payload.search);
      if (!parsed.success) {
        captureAnalyticsEvent("project_action_failed", {
          project_id: projectId,
          action_kind: "search",
          error_class: "protocol",
        });
        setSearch(null);
        setError("Project Search returned an invalid response. Try again.");
        return;
      }

      setSearch(parsed.data);
      captureAnalyticsEvent("project_search_completed", {
        project_id: projectId,
        source_set_revision: parsed.data.sourceSetRevision,
        outcome: parsed.data.status,
        result_count: parsed.data.passages.length,
        total_videos: parsed.data.coverage.totalVideos,
        ready_videos: parsed.data.coverage.readyVideos,
        unavailable_videos: parsed.data.coverage.unavailableVideos.length,
        passages_examined: parsed.data.coverage.passagesExamined,
      });
    } catch {
      captureAnalyticsEvent("project_action_failed", {
        project_id: projectId,
        action_kind: "search",
        error_class: "network",
      });
      setSearch(null);
      setError(
        "Project Search is unavailable. Check your connection and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="project-search-heading"
      className="ph-no-capture"
      data-ph-no-autocapture
    >
      <Card>
        <CardHeader className="border-b border-border-subtle bg-surface-sunken/50">
          <div className="flex flex-col gap-2">
            <h2
              id="project-search-heading"
              className="text-h4 font-semibold text-text-primary"
            >
              Project Search
            </h2>
            <p className="max-w-prose text-body-sm text-text-secondary">
              Find ranked, exact passages across every ready Project Transcript.
              Search is direct evidence retrieval—it never uses AI generation or
              a message allowance.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-6">
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor="project-transcript-search">
                Search exact Transcript passages
              </Label>
              <Input
                id="project-transcript-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                minLength={PROJECT_PASSAGE_SEARCH_QUERY_MIN_LENGTH}
                required
                placeholder="Concept, claim, or phrase"
                aria-describedby="project-transcript-search-help"
              />
              <p
                id="project-transcript-search-help"
                className="text-caption text-text-muted"
              >
                Queries stay in this request and are never sent to product analytics.
              </p>
            </div>
            <Button type="submit" disabled={pending}>
              <Search aria-hidden="true" />
              {pending ? "Searching…" : "Search Transcripts"}
            </Button>
          </form>

          {pending ? (
            <p role="status" className="text-body-sm text-text-secondary">
              Searching ready Project Transcripts…
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-body-sm text-accent-danger">
              {error}
            </p>
          ) : null}
          {!pending && search ? <SearchResults search={search} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}
