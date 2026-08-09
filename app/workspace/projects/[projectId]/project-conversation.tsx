"use client";

import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, ExternalLink, Pencil, Plus, Send, Square, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectGroundedConversation } from "@/lib/hooks/useProjectGroundedConversation";
import { parseProjectCitations } from "@/lib/projects/project-grounded-citations";
import type {
  ProjectAnswerClassification,
  ProjectAnswerCoverage,
  ProjectEvidenceSnapshot,
  ProjectAnswerSourceManifest,
  ProjectCitationDiagnostic,
  ProjectConversation,
  ProjectConversationMessage,
  ProjectConversationSummary,
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
    ["Evidence Snapshot Videos", coverage.evidenceVideos],
    ["Unavailable Videos", coverage.unavailableVideos.length],
    ["Passages examined", coverage.passagesExamined],
    ["Evidence Snapshot passages", coverage.evidencePassages],
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
): ReactNode {
  return parseProjectCitations(content, manifest).map((part, index) => {
    if (part.type === "text") {
      return <Fragment key={`text-${index}`}>{part.value}</Fragment>;
    }
    return (
      <a
        key={`citation-${index}`}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md font-medium text-accent-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
        aria-label={`${part.raw}, open ${part.title} at this timestamp`}
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
}: {
  content: string;
  manifest: ProjectAnswerSourceManifest;
  coverage: ProjectAnswerCoverage;
  classification: ProjectAnswerClassification | null;
  diagnostics: readonly ProjectCitationDiagnostic[];
  evidenceSnapshot?: ProjectEvidenceSnapshot;
  mode?: ProjectConversationMode;
}) {
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
        {renderAnswer(content, manifest)}
      </p>
      <DiagnosticNote diagnostics={diagnostics} />
    </article>
  );
}

function ConversationMessage({ message }: { message: ProjectConversationMessage }) {
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
    if (nextQuestion.length < 2 || conversation.streaming) return;
    setQuestion("");
    void conversation.send(nextQuestion, questionMode);
  }

  const atCap =
    conversation.upgradeError !== null ||
    (conversation.conversation.messagesLimit === 5 &&
      conversation.conversation.messagesUsed >= 5);
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
            aria-label="Project Conversation messages"
          >
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

          {conversation.streaming ? (
            <p role="status" aria-live="polite" className="text-body-sm text-text-secondary">
              {conversation.draft?.classification
                ? "Writing the Grounded Answer…"
                : "Examining bounded Project passages…"}
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
                <Link href="/pricing?source_surface=project_chat_limit">
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
                  maxLength={200}
                  rows={3}
                  disabled={conversation.streaming}
                  aria-describedby="project-question-help"
                  placeholder="What do these Project Videos say about…"
                />
                <p id="project-question-help" className="text-caption text-text-muted">
                  2–200 characters. Free includes five user messages per Project.
                </p>
              </div>
              <div className="flex justify-end">
                {conversation.streaming ? (
                  <Button type="button" variant="outline" onClick={conversation.abort}>
                    <Square aria-hidden="true" />
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" disabled={question.trim().length < 2}>
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
