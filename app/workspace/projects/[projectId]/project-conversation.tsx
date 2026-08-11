"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Check, ExternalLink, Pencil, Plus, Send, Square, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { buildAttributedPricingHref } from "@/lib/analytics/subscription-discovery-navigation";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { classifyProjectActionHttpFailure } from "@/lib/analytics/project-activity";
import { useProjectGroundedConversation } from "@/lib/hooks/useProjectGroundedConversation";
import { parseProjectCitations } from "@/lib/projects/project-grounded-citations";
import {
  PROJECT_QUESTION_MAX_LENGTH,
  PROJECT_QUESTION_MIN_LENGTH,
  projectGroundedQuestionCodePointLength,
  type ProjectAnswerClassification,
  type ProjectAnswerCoverage,
  type ProjectEvidenceSnapshot,
  type ProjectAnswerSourceManifest,
  type ProjectCitationDiagnostic,
  type ProjectConversation,
  type ProjectConversationMessage,
  type ProjectConversationSummary,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  projectSourceSetEventLabel,
  type ProjectSourceSetEvent,
} from "@/lib/projects/project-source-set-audit";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  PROJECT_GUIDED_ACTIONS,
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
    <p
      className="text-caption text-text-muted"
      aria-label="Immutable Evidence Snapshot"
    >
      Evidence Snapshot · Source Set revision {snapshot.sourceSetRevision} ·{" "}
      {snapshot.passages.length} {snapshot.passages.length === 1 ? "passage" : "passages"}
    </p>
  );
}

function SourceSetChangeEvent({ event }: { event: ProjectSourceSetEvent }) {
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
      <span className="text-caption text-text-muted">
        This boundary keeps answers grounded in the Source Set that existed when they were created.
      </span>
    </div>
  );
}

function ClassificationBadge({
  classification,
}: {
  classification: ProjectAnswerClassification | null;
}) {
  if (classification === null) {
    return <Badge variant="outline">Preparing answer</Badge>;
  }
  const label =
    classification === "supported"
      ? "Evidence supported"
      : classification === "abstained"
        ? "Abstained"
        : "Unsupported by sources";
  return <Badge variant="outline">{label}</Badge>;
}

function ModeBadge({ mode }: { mode?: ProjectConversationMode }) {
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

function AssistantAnswer({
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
          <ClassificationBadge classification={classification} />
        </div>
      </div>
      <ModeTrustBoundary mode={mode} />
      <SourceManifest manifest={manifest} />
      <CoverageLedger coverage={coverage} />
      <EvidenceSnapshotLedger snapshot={evidenceSnapshot} />
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

function ConversationMessage({
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

export function ProjectConversation({
  projectId,
  initialConversation,
  initialConversations = [],
}: {
  projectId: string;
  initialConversation: ProjectConversation;
  initialConversations?: readonly ProjectConversationSummary[];
}) {
  const [question, setQuestion] = useState("");
  const [questionMode, setQuestionMode] = useState<ProjectConversationMode>(
    PROJECT_DEFAULT_CONVERSATION_MODE,
  );
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const paywallCapturedRef = useRef(false);
  const conversation = useProjectGroundedConversation({
    projectId,
    initialConversation,
    initialConversations,
  });

  const visibleConversations = useMemo(() => {
    if (
      conversation.conversation.conversationId &&
      !conversation.conversations.some(
        (item) => item.conversationId === conversation.conversation.conversationId,
      )
    ) {
      return [
        {
          conversationId: conversation.conversation.conversationId,
          name: "Project Conversation",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messageCount: conversation.conversation.messages.length,
        },
        ...conversation.conversations,
      ];
    }
    return conversation.conversations;
  }, [conversation.conversation, conversation.conversations]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (!questionIsValid || conversation.streaming) return;
    setQuestion("");
    void conversation.send(nextQuestion, questionMode);
  }

  const atCap =
    conversation.upgradeError !== null ||
    (conversation.conversation.messagesLimit === 5 &&
      conversation.conversation.messagesUsed >= 5);
  const subscriptionDiscovery = useSubscriptionDiscovery({
    sourceSurface: "project_chat_limit",
    presentationState: "upgrade_to_pro",
    authenticationState: "registered",
    enabled: atCap,
  });
  useEffect(() => {
    if (!atCap || paywallCapturedRef.current) return;
    paywallCapturedRef.current = true;
    captureAnalyticsEvent("project_paywall_viewed", {
      project_id: projectId,
      paywall_kind: "conversation",
      tier: "free",
      used: Math.max(5, conversation.conversation.messagesUsed),
      limit: 5,
    });
  }, [atCap, conversation.conversation.messagesUsed, projectId]);
  const hasMessages = conversation.conversation.messages.length > 0;
  const timeline = useMemo(
    () =>
      [
        ...conversation.conversation.messages.map((message) => ({
          kind: "message" as const,
          createdAt: message.createdAt,
          message,
        })),
        ...(conversation.conversation.sourceSetEvents ?? []).map((event) => ({
          kind: "source_set_event" as const,
          createdAt: event.createdAt,
          event,
        })),
      ].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          (left.kind === right.kind ? 0 : left.kind === "source_set_event" ? -1 : 1),
      ),
    [conversation.conversation.messages, conversation.conversation.sourceSetEvents],
  );
  const normalizedQuestion = question.trim();
  const questionLength = projectGroundedQuestionCodePointLength(
    normalizedQuestion,
  );
  const questionIsValid =
    questionLength >= PROJECT_QUESTION_MIN_LENGTH &&
    questionLength <= PROJECT_QUESTION_MAX_LENGTH;

  return (
    <section
      aria-labelledby="project-conversation-heading"
      className="ph-no-capture"
      data-ph-no-autocapture
    >
      <Card>
        <CardHeader className="border-b border-border-subtle">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2
                id="project-conversation-heading"
                className="text-h4 font-semibold text-text-primary"
              >
                Project Conversation
              </h2>
              <p className="text-body-sm text-text-secondary">
                Ask across ready Videos. Every answer shows its Evidence
                Snapshot coverage before the response.
              </p>
            </div>
            {conversation.conversation.messagesLimit === 5 ? (
              <Badge
                variant="outline"
                role="status"
                aria-label={`${conversation.conversation.messagesUsed} of 5 free Project messages used`}
              >
                {conversation.conversation.messagesUsed}/5 free messages
              </Badge>
            ) : (
              <Badge variant="outline">Pro · unlimited</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <section
            aria-labelledby="project-conversation-list-heading"
            className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-sunken p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="project-conversation-list-heading"
                className="text-body-sm font-semibold text-text-primary"
              >
                Conversation threads
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void conversation.createConversation()}
                disabled={conversation.streaming || conversation.conversationLoading}
              >
                <Plus aria-hidden="true" />
                New conversation
              </Button>
            </div>
            {visibleConversations.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Project Conversations">
                {visibleConversations.map((item) => {
                  const active =
                    item.conversationId === conversation.activeConversationId;
                  const editing = item.conversationId === editingConversationId;
                  return (
                    <li
                      key={item.conversationId}
                      className="flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border-subtle bg-surface-raised p-1"
                    >
                      {editing ? (
                        <form
                          className="flex min-w-0 items-center gap-1"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void conversation
                              .renameConversation(item.conversationId, editingName)
                              .then(() => setEditingConversationId(null));
                          }}
                        >
                          <Label htmlFor={`conversation-name-${item.conversationId}`} className="sr-only">
                            Conversation name
                          </Label>
                          <Input
                            id={`conversation-name-${item.conversationId}`}
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            maxLength={120}
                            autoFocus
                            className="h-8 w-40"
                          />
                          <Button type="submit" size="icon" variant="ghost" aria-label="Save conversation name">
                            <Check aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label="Cancel renaming conversation"
                            onClick={() => setEditingConversationId(null)}
                          >
                            <X aria-hidden="true" />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="min-w-0 max-w-full rounded px-2 py-1 text-left text-body-sm font-medium text-text-primary outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-state-focus"
                            aria-pressed={active}
                            onClick={() => void conversation.selectConversation(item.conversationId)}
                          >
                            <span className="block max-w-48 truncate">{item.name}</span>
                            <span className="block text-caption text-text-muted">
                              {item.messageCount} {item.messageCount === 1 ? "message" : "messages"}
                            </span>
                          </button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Rename ${item.name}`}
                            onClick={() => {
                              setEditingConversationId(item.conversationId);
                              setEditingName(item.name);
                            }}
                            disabled={conversation.streaming}
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                          {active ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Clear ${item.name}`}
                              onClick={() => void conversation.clearConversation(item.conversationId)}
                              disabled={conversation.streaming || conversation.conversationLoading}
                            >
                              <Trash2 aria-hidden="true" />
                            </Button>
                          ) : null}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-body-sm text-text-secondary">
                No saved conversations yet. Start a question or create a new thread.
              </p>
            )}
            {conversation.conversationLoading ? (
              <p role="status" className="text-caption text-text-muted">
                Loading conversation history…
              </p>
            ) : null}
          </section>

          <div
            className="flex flex-col gap-4"
            role="log"
            aria-live="off"
            aria-relevant="additions"
            aria-label="Project Conversation messages"
          >
            {conversation.conversation.nextEventCursor ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={conversation.loadingEarlierActivity}
                  onClick={() => void conversation.loadEarlierActivity()}
                >
                  {conversation.loadingEarlierActivity
                    ? "Loading activity…"
                    : "Load earlier activity"}
                </Button>
              </div>
            ) : null}
            {conversation.conversation.nextCursor ? (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={conversation.loadingEarlier}
                  onClick={() => void conversation.loadEarlier()}
                >
                  {conversation.loadingEarlier ? "Loading…" : "Load earlier"}
                </Button>
              </div>
            ) : null}
            {!hasMessages && !conversation.draft ? (
              <div className="rounded-lg border border-dashed border-border-default bg-surface-sunken p-6 text-center">
                <p className="text-body-md font-medium text-text-primary">
                  Ask your first Project question
                </p>
                <p className="mt-1 text-body-sm text-text-secondary">
                  Answers use bounded Transcript passages only. Project Goals
                  guide relevance but are never evidence.
                </p>
                <div
                  className="mt-4 flex flex-col gap-2 text-left"
                  aria-label="Guided Project Conversation actions"
                >
                  <p className="text-caption font-medium text-text-secondary">
                    Start with a guided exploration
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PROJECT_GUIDED_ACTIONS.map((action) => (
                      <Button
                        key={action.mode}
                        type="button"
                        variant="outline"
                        className="h-auto min-h-14 justify-start whitespace-normal text-left"
                        aria-label={action.label}
                        onClick={() => {
                          setQuestion(action.question);
                          setQuestionMode(action.mode);
                        }}
                        disabled={conversation.streaming}
                      >
                        <span className="flex min-w-0 flex-col items-start gap-0.5">
                          <span>{action.label}</span>
                          <span className="text-caption font-normal text-text-muted">
                            {action.description}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {timeline.map((entry) =>
              entry.kind === "source_set_event" ? (
                <SourceSetChangeEvent
                  key={`source-set-event-${entry.event.eventId}`}
                  event={entry.event}
                />
              ) : (
                <ConversationMessage
                  key={entry.message.id}
                  message={entry.message}
                  projectId={projectId}
                  messageOrdinal={entry.message.messageOrdinal}
                />
              ),
            )}

            {conversation.draft ? (
              <>
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent-brand px-4 py-3 text-body-md text-text-inverse">
                    {conversation.draft.user}
                  </p>
                </div>
                {conversation.draft.manifest && conversation.draft.coverage ? (
                  <AssistantAnswer
                    content={conversation.draft.assistant}
                    manifest={conversation.draft.manifest}
                    coverage={conversation.draft.coverage}
                    classification={conversation.draft.classification}
                    diagnostics={conversation.draft.diagnostics}
                    mode={conversation.draft.mode}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          {conversation.announcement ? (
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="text-body-sm text-text-secondary"
            >
              {conversation.announcement}
            </p>
          ) : null}
          {conversation.error ? (
            <div className="flex flex-wrap items-center gap-3" role="alert">
              <p className="text-body-sm text-accent-danger">{conversation.error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void conversation.retry()}
                disabled={conversation.streaming || conversation.conversationLoading}
              >
                Try again
              </Button>
            </div>
          ) : null}

          {atCap ? (
            <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4 text-center">
              <p className="text-body-md font-medium text-text-primary">
                You’ve used 5/5 free messages in this Project.
              </p>
              <p className="mt-1 text-body-sm text-text-secondary">
                Upgrade to Pro for unlimited Project questions within technical
                limits.
              </p>
              <Button asChild size="sm" className="mt-3">
                <Link
                  href={buildAttributedPricingHref("project_chat_limit")}
                  onClick={subscriptionDiscovery.captureClick}
                >
                  View Pro plans
                </Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="project-question">Ask the Project</Label>
                {questionMode !== PROJECT_DEFAULT_CONVERSATION_MODE ? (
                  <div className="flex flex-wrap items-center gap-2" role="status">
                    <ModeBadge mode={questionMode} />
                    <span className="text-caption text-text-muted">
                      Edit this question before sending; the selected grounded action will be preserved.
                    </span>
                  </div>
                ) : null}
                <Textarea
                  id="project-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  rows={3}
                  disabled={conversation.streaming}
                  aria-describedby="project-question-help"
                  aria-invalid={question.length > 0 && !questionIsValid}
                  placeholder="What do these Project Videos say about…"
                />
                <p id="project-question-help" className="text-caption text-text-muted">
                  {questionLength}/200 characters. Free includes five user
                  messages per Project.
                </p>
              </div>
              <div className="flex justify-end">
                {conversation.streaming ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={conversation.abort}
                    disabled={
                      conversation.persistenceStarted || conversation.reconciling
                    }
                  >
                    {conversation.persistenceStarted || conversation.reconciling ? null : (
                      <Square aria-hidden="true" />
                    )}
                    {conversation.reconciling
                      ? "Reconciling..."
                      : conversation.persistenceStarted
                        ? "Saving..."
                        : "Stop"}
                  </Button>
                ) : (
                  <Button type="submit" disabled={!questionIsValid}>
                    <Send aria-hidden="true" />
                    Ask Project
                  </Button>
                )}
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
