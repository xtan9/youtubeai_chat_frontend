"use client";

import {projectNotice} from "@/i18n/project-notice";
import {useTranslations} from "next-intl";
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

function unavailableStatus(t: ReturnType<typeof useTranslations<"project">>, video: ProjectUnavailableVideo) {
  switch (video.status) {
    case "processing":
      return t("processing");
    case "failed":
      return t("failed");
    case "unavailable":
      return t("evidenceUnavailable");
  }
}

function CoverageNotice({ coverage }: { coverage: ProjectSearchCoverage }) {
  const t = useTranslations("project");
  if (coverage.unavailableVideos.length === 0) return null;

  return (
    <Alert role="note">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>
        {t("readySearched", {ready: coverage.readyVideos, total: coverage.totalVideos})}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>{t("onlyReadyTranscriptsContributeExactPassagesTheseVideos")}</p>
        <ul className="flex flex-col gap-1" aria-label={t("unavailableSearchCoverage")}>
          {coverage.unavailableVideos.map((video) => (
            <li key={video.videoId} className="flex flex-wrap items-center gap-2">
              <span>{video.title ?? t("untitledVideo")}</span>
              <Badge variant="secondary">{unavailableStatus(t, video)}</Badge>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function SearchResults({ search }: { search: DisplayedSearch }) {
  const t = useTranslations("project");
  if (search.status === "not_ready") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t("noReadyProjectTranscripts")}</AlertTitle>
          <AlertDescription>{t("addAProcessedHistoryVideoOrWaitFor")}</AlertDescription>
        </Alert>
        <CoverageNotice coverage={search.coverage} />
      </div>
    );
  }

  if (search.status === "no_results") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border-subtle bg-surface-sunken px-4 py-6">
          <p className="text-body-md font-medium text-text-primary">{t("noMatchingTranscriptPassages")}</p>
          <p className="mt-1 text-body-sm text-text-secondary">
            {search.coverage.unavailableVideos.length > 0
              ? t("noReadyTranscriptMatchedReviewTheUnavailableCoverage")
              : t("allSearched", {count: search.coverage.readyVideos})}
          </p>
        </div>
        <CoverageNotice coverage={search.coverage} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-body-sm text-text-secondary">
        {t("searchMatchCount", {count: search.passages.length, videos: search.coverage.readyVideos})}
      </p>
      <CoverageNotice coverage={search.coverage} />
      <ol className="flex flex-col gap-4" aria-label={t("projectSearchResults")}>
        {search.passages.map((passage) => {
          const title = passage.title ?? t("untitledVideo");
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
                    aria-label={t("openAt", {value1: title, value2: formatTimestamp(passage.startSeconds)})}
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
              <p className="mt-3 text-caption text-text-muted">{t("exactTranscriptExcerpt")} {passage.language}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ProjectSearch({ projectId }: { projectId: string }) {
  const t = useTranslations("project");
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
      setError("enter2To200CharactersToSearchProject");
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
          setError("projectSearchReturnedAnInvalidResponseTryAgain");
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
            "projectSearchIsUnavailableCheckYourConnectionAnd",
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
        setError("projectSearchReturnedAnInvalidResponseTryAgain");
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
        "projectSearchIsUnavailableCheckYourConnectionAnd",
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
            >{t("projectSearch")}</h2>
            <p className="max-w-prose text-body-sm text-text-secondary">{t("findRankedExactPassagesAcrossEveryReadyProject")}</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-6">
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Label htmlFor="project-transcript-search">{t("searchExactTranscriptPassages")}</Label>
              <Input
                id="project-transcript-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                minLength={PROJECT_PASSAGE_SEARCH_QUERY_MIN_LENGTH}
                required
                placeholder={t("conceptClaimOrPhrase")}
                aria-describedby="project-transcript-search-help"
              />
              <p
                id="project-transcript-search-help"
                className="text-caption text-text-muted"
              >{t("queriesStayInThisRequestAndAreNever")}</p>
            </div>
            <Button type="submit" disabled={pending}>
              <Search aria-hidden="true" />
              {pending ? t("searching") : t("searchTranscripts")}
            </Button>
          </form>

          {pending ? (
            <p role="status" className="text-body-sm text-text-secondary">{t("searchingReadyProjectTranscripts")}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-body-sm text-accent-danger">
              {projectNotice(t, error)}
            </p>
          ) : null}
          {!pending && search ? <SearchResults search={search} /> : null}
        </CardContent>
      </Card>
    </section>
  );
}
