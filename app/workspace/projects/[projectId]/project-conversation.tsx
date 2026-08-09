"use client";

import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Send, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useProjectGroundedConversation } from "@/lib/hooks/useProjectGroundedConversation";
import { parseProjectCitations } from "@/lib/projects/project-grounded-citations";
import type {
  ProjectAnswerClassification,
  ProjectAnswerCoverage,
  ProjectAnswerSourceManifest,
  ProjectCitationDiagnostic,
  ProjectConversation,
  ProjectConversationMessage,
} from "@/lib/projects/project-grounded-answer-contract";

function CoverageLedger({ coverage }: { coverage: ProjectAnswerCoverage }) {
  const metrics = [
    ["Total", coverage.totalVideos],
    ["Ready", coverage.readyVideos],
    ["Used", coverage.usedVideos],
    ["Unavailable", coverage.unavailableVideos.length],
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

function AssistantAnswer({
  content,
  manifest,
  coverage,
  classification,
  diagnostics,
}: {
  content: string;
  manifest: ProjectAnswerSourceManifest;
  coverage: ProjectAnswerCoverage;
  classification: ProjectAnswerClassification | null;
  diagnostics: readonly ProjectCitationDiagnostic[];
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border-subtle bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm font-medium text-text-secondary">
          Grounded Answer
        </p>
        <ClassificationBadge classification={classification} />
      </div>
      <SourceManifest manifest={manifest} />
      <CoverageLedger coverage={coverage} />
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
    />
  );
}

export function ProjectConversation({
  projectId,
  initialConversation,
}: {
  projectId: string;
  initialConversation: ProjectConversation;
}) {
  const [question, setQuestion] = useState("");
  const conversation = useProjectGroundedConversation({
    projectId,
    initialConversation,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuestion = question.trim();
    if (nextQuestion.length < 2 || conversation.streaming) return;
    setQuestion("");
    void conversation.send(nextQuestion);
  }

  const atCap =
    conversation.upgradeError !== null ||
    (conversation.conversation.messagesLimit === 5 &&
      conversation.conversation.messagesUsed >= 5);
  const hasMessages = conversation.conversation.messages.length > 0;

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
              </div>
            ) : null}

            {conversation.conversation.messages.map((message) => (
              <ConversationMessage key={message.id} message={message} />
            ))}

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
            <p role="alert" className="text-body-sm text-accent-danger">
              {conversation.error}
            </p>
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
                <Textarea
                  id="project-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={200}
                  rows={3}
                  disabled={conversation.streaming}
                  aria-describedby="project-question-help"
                  placeholder="What do these sources say about…"
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
