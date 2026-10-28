"use client";
import { Fragment, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { classifyProjectActionHttpFailure } from "@/lib/analytics/project-activity";
import { parseProjectCitations } from "@/lib/projects/project-grounded-citations";
import { formatTimestamp } from "@/lib/utils/timestamp-citations";
import {
  type ProjectAnswerClassification,
  type ProjectAnswerCoverage,
  type ProjectEvidenceSnapshot,
  type ProjectAnswerSourceManifest,
  type ProjectCitationDiagnostic,
  type ProjectConversationMessage,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  projectSourceSetEventLabel,
  type ProjectSourceSetEvent,
} from "@/lib/projects/project-source-set-audit";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  getProjectGuidedAction,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";

function CoverageLedger({ coverage }: { coverage: ProjectAnswerCoverage }) {
  const metrics = [
    ["Project Videos", coverage.totalVideos],
    ["Ready Videos", coverage.readyVideos],
    ["Used", coverage.usedVideos],
    ["Unavailable Videos", coverage.unavailableVideos.length],
    ["Passages examined", coverage.passagesExamined],
    ["Passages selected", coverage.passagesUsed],
  ] as const;
  return (
    <div className="flex flex-col gap-3 border-y border-border-subtle py-3">
      <dl
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Source Coverage"
      >
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-caption text-text-muted">{label}</dt>
            <dd className="text-body-sm font-semibold text-text-primary">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {coverage.unavailableVideos.length > 0 ? (
        <div className="flex flex-col gap-2" aria-label="Unavailable Project Videos">
          <p className="text-caption font-medium text-text-secondary">
            Unavailable from this answer
          </p>
          <ul className="flex flex-col gap-2">
            {coverage.unavailableVideos.map((video) => (
              <li
                key={video.videoId}
                className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0 break-words text-body-sm text-text-primary">
                  {video.title ?? "Untitled Video"}
                </span>
                <Badge variant="outline" className="shrink-0">
                  {video.status === "processing"
                    ? "Processing"
                    : video.status === "failed"
                      ? "Failed"
                      : "Unavailable"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SourceManifest({ manifest }: { manifest: ProjectAnswerSourceManifest }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Answer source manifest">
      {manifest.sources.length === 0 ? (
        <Badge variant="outline">No passages selected</Badge>
      ) : (
        manifest.sources.map((source) => (
          <Badge
            key={source.sourceId}
            variant="secondary"
            className="max-w-full whitespace-normal text-left"
          >
            {source.sourceId} · {source.title ?? "Untitled Video"}
          </Badge>
        ))
      )}
    </div>
  );
}

function renderAnswer(
  content: string,
  manifest: ProjectAnswerSourceManifest,
  onCitationClick?: (input: {
    citationOrdinal: number;
    sourceOrdinal: number;
    timestampSeconds: number;
  }) => void,
): ReactNode {
  let citationOrdinal = 0;
  return parseProjectCitations(content, manifest).map((part, index) => {
    if (part.type === "text") {
      return <Fragment key={`text-${index}`}>{part.value}</Fragment>;
    }
    citationOrdinal += 1;
    const currentCitationOrdinal = citationOrdinal;
    return (
      <a
        key={`citation-${index}`}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md font-medium text-accent-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
        aria-label={`${part.raw}, open ${part.title} at this timestamp`}
        onClick={() =>
          onCitationClick?.({
            citationOrdinal: currentCitationOrdinal,
            sourceOrdinal: Number.parseInt(part.sourceId.slice(1), 10),
            timestampSeconds: part.seconds,
          })
        }
      >
        {part.raw}
        <ExternalLink aria-hidden="true" className="size-3" />
      </a>
    );
  });
}

function DiagnosticNote({
  diagnostics,
}: {
  diagnostics: readonly ProjectCitationDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;
  return (
    <p role="note" className="text-caption text-text-muted">
      {diagnostics.length} citation{diagnostics.length === 1 ? "" : "s"} could
      not be linked because the source or timestamp was not in this Evidence
      Snapshot.
    </p>
  );
}

function EvidenceSnapshotLedger({
  snapshot,
}: {
  snapshot?: ProjectEvidenceSnapshot;
}) {
  if (!snapshot) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-label="Immutable Evidence Snapshot">
      <p className="text-caption text-text-muted">
        Evidence Snapshot · Source Set revision {snapshot.sourceSetRevision} ·{" "}
        {snapshot.passages.length} {snapshot.passages.length === 1 ? "passage" : "passages"}
      </p>
      {snapshot.passages.map((passage, index) => {
        const title = passage.title ?? "Untitled Video";
        const start = formatTimestamp(passage.startSeconds);
        const timestamp = passage.endSeconds === null
          ? start
          : `${start}–${formatTimestamp(passage.endSeconds)}`;
        const href = `https://www.youtube.com/watch?v=${passage.youtubeVideoId}&t=${Math.floor(passage.startSeconds)}s`;
        return (
          <details key={passage.passageId} className="min-w-0 rounded-lg border border-border-subtle bg-surface-base px-3 py-2">
            <summary className="cursor-pointer break-words rounded-sm text-body-sm font-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">
              Passage {index + 1} · {title} · {timestamp}
            </summary>
            <div className="mt-3 flex min-w-0 flex-col gap-3">
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border-default pl-3 text-body-sm text-text-secondary">
                {passage.text}
              </blockquote>
              {passage.truncatedStart || passage.truncatedEnd ? (
                <p className="text-caption text-text-muted">This excerpt starts or ends within a transcript segment.</p>
              ) : null}
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 rounded-sm text-body-sm font-medium text-accent-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-state-focus" aria-label={`Watch ${title} at ${start}`}>
                Watch at {start}<ExternalLink aria-hidden="true" className="size-3" />
              </a>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function SourceSetChangeEvent({ event }: { event: ProjectSourceSetEvent }) {
  return (
    <div
      role="status"
      aria-label={`Source Set change revision ${event.revision}`}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed border-border-default bg-surface-sunken px-3 py-2 text-body-sm text-text-secondary"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text-primary">
          Source Set change · {projectSourceSetEventLabel(event)}
        </span>
        <Badge variant="outline">Revision {event.revision}</Badge>
      </div>

    </div>
  );
}

export function SourceSetChangeGroup({ events }: { events: readonly ProjectSourceSetEvent[] }) {
  if (events.length === 1) return <SourceSetChangeEvent event={events[0]} />;
  const latest = events[events.length - 1];
  return (
    <details className="rounded-lg border border-dashed border-border-default bg-surface-sunken px-3 py-2">
      <summary className="cursor-pointer rounded-sm text-caption font-medium text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">
        {events.length} source updates · revision {latest.revision}
      </summary>
      <div className="mt-3 flex flex-col gap-2" aria-label="Source update history">
        {events.map((event) => <SourceSetChangeEvent key={event.eventId} event={event} />)}
      </div>
    </details>
  );
}

function ClassificationBadge({
  classification,
  noMatchingPassages,
}: {
  classification: ProjectAnswerClassification | null;
  noMatchingPassages: boolean;
}) {
  if (classification === null) {
    return <Badge variant="outline">Preparing answer</Badge>;
  }
  const label =
    classification === "unsupported" && noMatchingPassages
      ? "No matching passages"
      : classification === "supported"
      ? "Evidence supported"
      : classification === "abstained"
        ? "Abstained"
        : "Unsupported by sources";
  return <Badge variant="outline">{label}</Badge>;
}

export function ModeBadge({ mode }: { mode?: ProjectConversationMode }) {
  if (!mode || mode === PROJECT_DEFAULT_CONVERSATION_MODE) return null;
  const action = getProjectGuidedAction(mode);
  return action ? <Badge variant="secondary">{action.label}</Badge> : null;
}

function ModeTrustBoundary({ mode }: { mode?: ProjectConversationMode }) {
  if (mode === "find_gaps") {
    return (
      <p role="note" className="text-caption text-text-muted">
        Source-supported observations are kept separate from proposed questions
        and creative opportunities.
      </p>
    );
  }
  if (mode === "project_assessment") {
    return (
      <p role="note" className="text-caption text-text-muted">
        Project Assessment judges support within this Project; it is not
        externally verified truth.
      </p>
    );
  }
  return null;
}

export function AssistantAnswer({
  content,
  manifest,
  coverage,
  classification,
  diagnostics,
  evidenceSnapshot,
  mode,
  projectId,
  answerId,
  messageOrdinal,
  initialFeedback,
}: {
  content: string;
  manifest: ProjectAnswerSourceManifest;
  coverage: ProjectAnswerCoverage;
  classification: ProjectAnswerClassification | null;
  diagnostics: readonly ProjectCitationDiagnostic[];
  evidenceSnapshot?: ProjectEvidenceSnapshot;
  mode?: ProjectConversationMode;
  projectId?: string;
  answerId?: string;
  messageOrdinal?: number;
  initialFeedback?: "helpful" | "not_helpful";
}) {
  const [feedback, setFeedback] = useState<"helpful" | "not_helpful" | null>(
    initialFeedback ?? null,
  );
  const [feedbackPending, setFeedbackPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const analyticsIdentity =
    projectId && answerId && messageOrdinal
      ? { projectId, answerId, messageOrdinal }
      : null;

  async function submitFeedback(rating: "helpful" | "not_helpful") {
    if (!analyticsIdentity || feedback || feedbackPending) return;
    setFeedbackPending(true);
    setFeedbackError(null);
    let failureCaptured = false;
    const captureFailure = (
      errorClass:
        | ReturnType<typeof classifyProjectActionHttpFailure>
        | "network"
        | "protocol",
      httpStatus?: number,
    ) => {
      if (failureCaptured) return;
      failureCaptured = true;
      captureAnalyticsEvent("project_action_failed", {
        project_id: analyticsIdentity.projectId,
        action_kind: "feedback",
        error_class: errorClass,
        ...(httpStatus !== undefined ? { http_status: httpStatus } : {}),
      });
    };
    try {
      const response = await fetch(
        `/api/projects/${analyticsIdentity.projectId}/conversation/feedback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answerId: analyticsIdentity.answerId,
            rating,
          }),
        },
      );
      let result: unknown;
      try {
        result = await response.json();
      } catch {
        captureFailure(
          response.ok
            ? "protocol"
            : classifyProjectActionHttpFailure(response.status),
          response.ok ? undefined : response.status,
        );
        throw new Error("feedback unavailable");
      }
      const durableRating =
        result &&
        typeof result === "object" &&
        "rating" in result &&
        (result.rating === "helpful" || result.rating === "not_helpful")
          ? result.rating
          : null;
      if ((!response.ok && response.status !== 409) || !durableRating) {
        captureFailure(
          response.ok
            ? "protocol"
            : classifyProjectActionHttpFailure(response.status),
          response.ok ? undefined : response.status,
        );
        throw new Error("feedback unavailable");
      }
      setFeedback(durableRating);
    } catch {
      captureFailure("network");
      setFeedbackError("Couldn’t record feedback. Try again.");
    } finally {
      setFeedbackPending(false);
    }
  }

  return (
    <article className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm font-medium text-text-secondary">
          Grounded Answer
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ModeBadge mode={mode} />
          <ClassificationBadge classification={classification} noMatchingPassages={coverage.passagesUsed === 0} />
        </div>
      </div>
      <ModeTrustBoundary mode={mode} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-secondary" aria-label="Answer coverage summary">
        <span>{coverage.usedVideos} of {coverage.totalVideos} videos used</span>
        <span>{coverage.passagesUsed} evidence {coverage.passagesUsed === 1 ? "passage" : "passages"}</span>
        {coverage.unavailableVideos.length > 0 ? <span className="text-accent-warning">{coverage.unavailableVideos.length} unavailable</span> : null}
      </div>
      <details className="rounded-lg bg-surface-sunken px-3 py-2">
        <summary className="cursor-pointer rounded-sm text-caption font-medium text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">View sources and retrieval details</summary>
        <div className="mt-3 flex flex-col gap-3">
          <SourceManifest manifest={manifest} />
          <CoverageLedger coverage={coverage} />
          <EvidenceSnapshotLedger snapshot={evidenceSnapshot} />
        </div>
      </details>
      <p className="whitespace-pre-wrap text-body-md text-text-primary">
        {renderAnswer(
          content,
          manifest,
          analyticsIdentity
            ? ({ citationOrdinal, sourceOrdinal, timestampSeconds }) =>
                captureAnalyticsEvent("project_citation_clicked", {
                  project_id: analyticsIdentity.projectId,
                  citation_context: "grounded_answer",
                  answer_id: analyticsIdentity.answerId,
                  message_ordinal: analyticsIdentity.messageOrdinal,
                  citation_ordinal: citationOrdinal,
                  source_ordinal: sourceOrdinal,
                  timestamp_seconds: timestampSeconds,
                })
            : undefined,
        )}
      </p>
      {classification === "unsupported" && coverage.passagesUsed === 0 && coverage.readyVideos > 0 ? (
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-body-sm text-text-secondary">
          No relevant passages were found for this question. This does not establish whether the claim is true or false. Try naming the specific claim, or use Search to inspect the transcript.
        </p>
      ) : null}
      <DiagnosticNote diagnostics={diagnostics} />
      {analyticsIdentity ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Answer feedback">
          <span className="text-caption text-text-muted">Was this grounded answer useful?</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={feedback === "helpful"}
            disabled={feedback !== null || feedbackPending}
            onClick={() => void submitFeedback("helpful")}
          >
            Useful
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={feedback === "not_helpful"}
            disabled={feedback !== null || feedbackPending}
            onClick={() => void submitFeedback("not_helpful")}
          >
            Not useful
          </Button>
          {feedback ? (
            <span role="status" className="text-caption text-text-muted">
              Feedback recorded.
            </span>
          ) : feedbackError ? (
            <span role="alert" className="text-caption text-status-error">
              {feedbackError}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ConversationMessage({
  message,
  projectId,
  messageOrdinal,
}: {
  message: ProjectConversationMessage;
  projectId: string;
  messageOrdinal?: number;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent-brand px-4 py-3 text-body-md text-text-inverse">
          {message.content}
        </p>
      </div>
    );
  }
  return (
    <AssistantAnswer
      content={message.content}
      manifest={message.sourceManifest}
      coverage={message.sourceCoverage}
      classification={message.answerClassification}
      diagnostics={message.citationDiagnostics}
      evidenceSnapshot={message.evidenceSnapshot}
      mode={message.mode}
      projectId={projectId}
      answerId={message.id}
      messageOrdinal={messageOrdinal}
      initialFeedback={message.feedbackRating}
    />
  );
}
