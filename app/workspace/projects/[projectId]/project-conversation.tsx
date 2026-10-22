"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Pencil, Plus, Send, Square, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSubscriptionDiscovery } from "@/lib/analytics/use-subscription-discovery";
import { buildAttributedPricingHref } from "@/lib/analytics/subscription-discovery-navigation";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { useProjectGroundedConversation } from "@/lib/hooks/useProjectGroundedConversation";
import {
  PROJECT_QUESTION_MAX_LENGTH,
  PROJECT_QUESTION_MIN_LENGTH,
  projectGroundedQuestionCodePointLength,
  type ProjectConversation,
  type ProjectConversationSummary,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  PROJECT_GUIDED_ACTIONS,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";
import {
  SourceSetChangeEvent,
  ModeBadge,
  AssistantAnswer,
  ConversationMessage,
} from "./project-conversation-messages";

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
