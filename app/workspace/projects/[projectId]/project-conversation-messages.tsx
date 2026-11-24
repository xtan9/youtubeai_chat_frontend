"use client";
import {projectNotice} from "@/i18n/project-notice";
import {useTranslations} from "next-intl";
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

  type ProjectSourceSetEvent,
} from "@/lib/projects/project-source-set-audit";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  getProjectGuidedAction,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";

function CoverageLedger({ coverage }: { coverage: ProjectAnswerCoverage }) {
  const t = useTranslations("project");
  const metrics = [
    [t("projectVideos"), coverage.totalVideos],
    [t("readyVideos"), coverage.readyVideos],
    [t("used"), coverage.usedVideos],
    [t("unavailableVideos"), coverage.unavailableVideos.length],
    [t("passagesExamined"), coverage.passagesExamined],
    [t("passagesSelected"), coverage.passagesUsed],
  ] as const;
  return (
    <div className="flex flex-col gap-3 border-y border-border-subtle py-3">
      <dl
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
        aria-label={t("sourceCoverage")}
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
        <div className="flex flex-col gap-2" aria-label={t("unavailableProjectVideos")}>
          <p className="text-caption font-medium text-text-secondary">{t("unavailableFromThisAnswer")}</p>
          <ul className="flex flex-col gap-2">
            {coverage.unavailableVideos.map((video) => (
              <li
                key={video.videoId}
                className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0 break-words text-body-sm text-text-primary">
                  {video.title ?? t("untitledVideo")}
                </span>
                <Badge variant="outline" className="shrink-0">
                  {video.status === "processing"
                    ? t("processing")
                    : video.status === "failed"
                      ? t("failed")
                      : t("unavailable")}
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
  const t = useTranslations("project");
  return (
    <div className="flex flex-wrap gap-2" aria-label={t("answerSourceManifest")}>
      {manifest.sources.length === 0 ? (
        <Badge variant="outline">{t("noPassagesSelected")}</Badge>
      ) : (
        manifest.sources.map((source) => (
          <Badge
            key={source.sourceId}
            variant="secondary"
            className="max-w-full whitespace-normal text-left"
          >
            {source.sourceId} · {source.title ?? t("untitledVideo")}
          </Badge>
        ))
      )}
    </div>
  );
}

function renderAnswer(t: ReturnType<typeof useTranslations<"project">>,
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
        aria-label={t("openAtThisTimestamp", {value1: part.raw, value2: part.title})}
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
  const t = useTranslations("project");
  if (diagnostics.length === 0) return null;
  return (
    <p role="note" className="text-caption text-text-muted">
      {t("unlinkedCitations", {count: diagnostics.length})}</p>
  );
}

function EvidenceSnapshotLedger({
  snapshot,
}: {
  snapshot?: ProjectEvidenceSnapshot;
}) {
  const t = useTranslations("project");
  if (!snapshot) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3" aria-label={t("immutableEvidenceSnapshot")}>
      <p className="text-caption text-text-muted">{t("evidenceSnapshotSourceSetRevision")} {snapshot.sourceSetRevision} ·{" "}
        {snapshot.passages.length} {snapshot.passages.length === 1 ? t("passage") : t("passages")}
      </p>
      {snapshot.passages.map((passage, index) => {
        const title = passage.title ?? t("untitledVideo");
        const start = formatTimestamp(passage.startSeconds);
        const timestamp = passage.endSeconds === null
          ? start
          : `${start}–${formatTimestamp(passage.endSeconds)}`;
        const href = `https://www.youtube.com/watch?v=${passage.youtubeVideoId}&t=${Math.floor(passage.startSeconds)}s`;
        return (
          <details key={passage.passageId} className="min-w-0 rounded-lg border border-border-subtle bg-surface-base px-3 py-2">
            <summary className="cursor-pointer break-words rounded-sm text-body-sm font-medium text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">{t("passageLabel")} {index + 1} · {title} · {timestamp}
            </summary>
            <div className="mt-3 flex min-w-0 flex-col gap-3">
              <blockquote className="whitespace-pre-wrap break-words border-l-2 border-border-default pl-3 text-body-sm text-text-secondary">
                {passage.text}
              </blockquote>
              {passage.truncatedStart || passage.truncatedEnd ? (
                <p className="text-caption text-text-muted">{t("thisExcerptStartsOrEndsWithinATranscript")}</p>
              ) : null}
              <a href={href} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 rounded-sm text-body-sm font-medium text-accent-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-state-focus" aria-label={t("watchAt", {value1: title, value2: start})}>{t("watchAtLabel")} {start}<ExternalLink aria-hidden="true" className="size-3" />
              </a>
            </div>
          </details>
        );
      })}
    </div>
  );
}

export function SourceSetChangeEvent({ event }: { event: ProjectSourceSetEvent }) {
  const t = useTranslations("project");
  return (
    <div
      role="status"
      aria-label={t("sourceSetChangeRevision", {value1: event.revision})}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed border-border-default bg-surface-sunken px-3 py-2 text-body-sm text-text-secondary"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text-primary">{t("sourceSetChange")} {t(`event_${event.kind}`, {title: event.videoTitle ?? t("untitledVideo"), from: t(`status_${event.fromStatus ?? "unknown"}`), to: t(`status_${event.toStatus ?? "unknown"}`)})}
        </span>
        <Badge variant="outline">{t("revision")} {event.revision}</Badge>
      </div>

    </div>
  );
}

export function SourceSetChangeGroup({ events }: { events: readonly ProjectSourceSetEvent[] }) {
  const t = useTranslations("project");
  if (events.length === 1) return <SourceSetChangeEvent event={events[0]} />;
  const latest = events[events.length - 1];
  return (
    <details className="rounded-lg border border-dashed border-border-default bg-surface-sunken px-3 py-2">
      <summary className="cursor-pointer rounded-sm text-caption font-medium text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">
        {events.length} {t("sourceUpdatesRevision")} {latest.revision}
      </summary>
      <div className="mt-3 flex flex-col gap-2" aria-label={t("sourceUpdateHistory")}>
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
  const t = useTranslations("project");
  if (classification === null) {
    return <Badge variant="outline">{t("preparingAnswer")}</Badge>;
  }
  const label =
    classification === "unsupported" && noMatchingPassages
      ? t("noMatchingPassages")
      : classification === "supported"
      ? t("evidenceSupported")
      : classification === "abstained"
        ? t("abstained")
        : t("unsupportedBySources");
  return <Badge variant="outline">{label}</Badge>;
}

export function ModeBadge({ mode }: { mode?: ProjectConversationMode }) {
  const t = useTranslations("project");
  if (!mode || mode === PROJECT_DEFAULT_CONVERSATION_MODE) return null;
  const action = getProjectGuidedAction(mode);
  return action ? <Badge variant="secondary">{t(`${action.mode}Label`)}</Badge> : null;
}

function ModeTrustBoundary({ mode }: { mode?: ProjectConversationMode }) {
  const t = useTranslations("project");
  if (mode === "find_gaps") {
    return (
      <p role="note" className="text-caption text-text-muted">{t("sourceSupportedObservationsAreKeptSeparateFromProposed")}</p>
    );
  }
  if (mode === "project_assessment") {
    return (
      <p role="note" className="text-caption text-text-muted">{t("projectAssessmentJudgesSupportWithinThisProjectIt")}</p>
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
  const t = useTranslations("project");
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
        throw new Error(t("feedbackUnavailable"));
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
        throw new Error(t("feedbackUnavailable"));
      }
      setFeedback(durableRating);
    } catch {
      captureFailure("network");
      setFeedbackError("couldnTRecordFeedbackTryAgain");
    } finally {
      setFeedbackPending(false);
    }
  }

  return (
    <article className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm font-medium text-text-secondary">{t("groundedAnswer")}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ModeBadge mode={mode} />
          <ClassificationBadge classification={classification} noMatchingPassages={coverage.passagesUsed === 0} />
        </div>
      </div>
      <ModeTrustBoundary mode={mode} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-secondary" aria-label={t("answerCoverageSummary")}>
        <span>{coverage.usedVideos} {t("of")} {coverage.totalVideos} {t("videosUsed")}</span>
        <span>{coverage.passagesUsed} {t("evidence")} {coverage.passagesUsed === 1 ? t("passage") : t("passages")}</span>
        {coverage.unavailableVideos.length > 0 ? <span className="text-accent-warning">{coverage.unavailableVideos.length} {t("unavailableLabel")}</span> : null}
      </div>
      <details className="rounded-lg bg-surface-sunken px-3 py-2">
        <summary className="cursor-pointer rounded-sm text-caption font-medium text-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-state-focus">{t("viewSourcesAndRetrievalDetails")}</summary>
        <div className="mt-3 flex flex-col gap-3">
          <SourceManifest manifest={manifest} />
          <CoverageLedger coverage={coverage} />
          <EvidenceSnapshotLedger snapshot={evidenceSnapshot} />
        </div>
      </details>
      <p className="whitespace-pre-wrap text-body-md text-text-primary">
        {renderAnswer(t,
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
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-body-sm text-text-secondary">{t("noRelevantPassagesWereFoundForThisQuestion")}</p>
      ) : null}
      <DiagnosticNote diagnostics={diagnostics} />
      {analyticsIdentity ? (
        <div className="flex flex-wrap items-center gap-2" aria-label={t("answerFeedback")}>
          <span className="text-caption text-text-muted">{t("wasThisGroundedAnswerUseful")}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={feedback === "helpful"}
            disabled={feedback !== null || feedbackPending}
            onClick={() => void submitFeedback("helpful")}
          >{t("useful")}</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={feedback === "not_helpful"}
            disabled={feedback !== null || feedbackPending}
            onClick={() => void submitFeedback("not_helpful")}
          >{t("notUseful")}</Button>
          {feedback ? (
            <span role="status" className="text-caption text-text-muted">{t("feedbackRecorded")}</span>
          ) : feedbackError ? (
            <span role="alert" className="text-caption text-status-error">
              {projectNotice(t, feedbackError)}
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
