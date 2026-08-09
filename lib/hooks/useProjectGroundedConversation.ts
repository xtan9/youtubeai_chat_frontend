"use client";

import { useCallback, useRef, useState } from "react";
import {
  ProjectConversationSchema,
  ProjectConversationSummarySchema,
  ProjectGroundedSseEventSchema,
  PROJECT_QUESTION_MESSAGE_ID_HEADER,
  type ProjectAnswerClassification,
  type ProjectAnswerCoverage,
  type ProjectAnswerSourceManifest,
  type ProjectCitationDiagnostic,
  type ProjectConversation,
  type ProjectConversationSummary,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";
import { UpgradeRequiredError } from "@/lib/errors/upgrade-required";
import { logAppEvent } from "@/lib/observability";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

export type ProjectConversationDraft = Readonly<{
  user: string;
  mode: ProjectConversationMode;
  assistant: string;
  manifest: ProjectAnswerSourceManifest | null;
  coverage: ProjectAnswerCoverage | null;
  classification: ProjectAnswerClassification | null;
  diagnostics: readonly ProjectCitationDiagnostic[];
}>;

type ConversationResponse = { conversation?: unknown; message?: string };
type ConversationListResponse = {
  conversations?: unknown;
  messagesUsed?: number;
  messagesLimit?: 5 | null;
  tier?: "free" | "pro";
  message?: string;
};

type LastQuestionIntent = Readonly<{
  question: string;
  mode: ProjectConversationMode;
}>;

function parseEvent(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  try {
    const parsed = ProjectGroundedSseEventSchema.safeParse(
      JSON.parse(trimmed.slice(5).trim()),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function useProjectGroundedConversation(args: {
  readonly projectId: string;
  readonly initialConversation: ProjectConversation;
  readonly initialConversations?: readonly ProjectConversationSummary[];
}) {
  const [conversation, setConversation] = useState(args.initialConversation);
  const [conversations, setConversations] = useState<
    readonly ProjectConversationSummary[]
  >(args.initialConversations ?? []);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    args.initialConversation.conversationId ??
      args.initialConversations?.[0]?.conversationId ??
      null,
  );
  const [draft, setDraft] = useState<ProjectConversationDraft | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] =
    useState<UpgradeRequiredError | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<LastQuestionIntent | null>(null);

  const reload = useCallback(async (conversationId = activeConversationId) => {
    const query = conversationId
      ? `?conversationId=${encodeURIComponent(conversationId)}`
      : "";
    const response = await fetch(
      `/api/projects/${args.projectId}/conversation${query}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as ConversationResponse;
    if (!response.ok) {
      throw new Error(
        payload.message ?? "Could not reload the Project Conversation.",
      );
    }
    const parsed = ProjectConversationSchema.safeParse(payload.conversation);
    if (!parsed.success) {
      throw new Error("Project Conversation response was not valid.");
    }
    setConversation(parsed.data);
    if (parsed.data.conversationId) {
      setActiveConversationId(parsed.data.conversationId);
      setConversations((current) =>
        current.map((item) =>
          item.conversationId === parsed.data.conversationId
            ? { ...item, messageCount: parsed.data.messages.length }
            : item,
        ),
      );
    }
  }, [activeConversationId, args.projectId]);

  const refreshConversations = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${args.projectId}/conversations`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as ConversationListResponse;
    if (!response.ok) {
      throw new Error(
        payload.message ?? "Could not load Project Conversations.",
      );
    }
    const parsed = ProjectConversationSummarySchema.array().safeParse(
      payload.conversations,
    );
    if (!parsed.success) throw new Error("Project Conversations response was not valid.");
    setConversations(parsed.data);
    return parsed.data;
  }, [args.projectId]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (conversationId === activeConversationId && conversation.conversationId) {
        return;
      }
      if (abortRef.current) return;
      setConversationLoading(true);
      setError(null);
      try {
        await reload(conversationId);
        setActiveConversationId(conversationId);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load the Project Conversation.",
        );
      } finally {
        setConversationLoading(false);
      }
    },
    [abortRef, activeConversationId, conversation.conversationId, reload],
  );

  const createConversation = useCallback(
    async (name?: string) => {
      if (abortRef.current) return null;
      setConversationLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/projects/${args.projectId}/conversations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(name ? { name } : {}),
          },
        );
        const payload = (await response.json()) as {
          conversation?: unknown;
          message?: string;
        };
        if (!response.ok) {
          throw new Error(payload.message ?? "Could not create a Project Conversation.");
        }
        const parsed = ProjectConversationSummarySchema.safeParse(
          payload.conversation,
        );
        if (!parsed.success) throw new Error("Project Conversation response was not valid.");
        setConversations((current) => [parsed.data, ...current]);
        setActiveConversationId(parsed.data.conversationId);
        setConversation({
          conversationId: parsed.data.conversationId,
          messages: [],
          // Source Set events belong to the Project, not to one thread. Keep
          // the already-loaded timeline visible while the new thread is empty.
          sourceSetEvents: conversation.sourceSetEvents,
          messagesUsed: conversation.messagesUsed,
          messagesLimit: conversation.messagesLimit,
          tier: conversation.tier,
        });
        return parsed.data;
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not create a Project Conversation.",
        );
        return null;
      } finally {
        setConversationLoading(false);
      }
    },
    [
      abortRef,
      args.projectId,
      conversation.messagesLimit,
      conversation.messagesUsed,
      conversation.sourceSetEvents,
      conversation.tier,
    ],
  );

  const renameConversation = useCallback(
    async (conversationId: string, name: string) => {
      try {
        const response = await fetch(
          `/api/projects/${args.projectId}/conversations/${conversationId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          },
        );
        const payload = (await response.json()) as { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Could not rename the Project Conversation.");
        }
        setConversations((current) =>
          current.map((item) =>
            item.conversationId === conversationId
              ? { ...item, name: name.trim() }
              : item,
          ),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not rename the Project Conversation.",
        );
      }
    },
    [args.projectId],
  );

  const clearConversation = useCallback(
    async (conversationId: string) => {
      try {
        const response = await fetch(
          `/api/projects/${args.projectId}/conversations/${conversationId}`,
          { method: "DELETE" },
        );
        const payload = (await response.json()) as { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Could not clear the Project Conversation.");
        }
        if (conversationId === activeConversationId) {
          await reload(conversationId);
        }
        setConversations((current) =>
          current.map((item) =>
            item.conversationId === conversationId
              ? { ...item, messageCount: 0, updatedAt: new Date().toISOString() }
              : item,
          ),
        );
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not clear the Project Conversation.",
        );
      }
    },
    [activeConversationId, args.projectId, reload],
  );

  const abort = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(
    async (
      rawQuestion: string,
      mode: ProjectConversationMode = PROJECT_DEFAULT_CONVERSATION_MODE,
    ) => {
      const question = rawQuestion.trim();
      if (!question || abortRef.current) return;
      lastQuestionRef.current = { question, mode };
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setError(null);
      setUpgradeError(null);
      let upgradeWasRequired = false;
      let currentDraft: ProjectConversationDraft = {
        user: question,
        mode,
        assistant: "",
        manifest: null,
        coverage: null,
        classification: null,
        diagnostics: [],
      };
      setDraft(currentDraft);
      let completed = false;
      let aborted = false;
      let reservedUserMessageId: string | null = null;

      try {
        const response = await fetch(
          `/api/projects/${args.projectId}/conversation/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question,
              ...(activeConversationId
                ? { conversationId: activeConversationId }
                : {}),
              ...(mode === PROJECT_DEFAULT_CONVERSATION_MODE ? {} : { mode }),
            }),
            signal: controller.signal,
          },
        );
        reservedUserMessageId = response.headers.get(
          PROJECT_QUESTION_MESSAGE_ID_HEADER,
        );
        if (!response.ok) {
          let payload: {
            message?: string;
            errorCode?: string;
            tier?: string;
            upgradeUrl?: string;
          } = {};
          try {
            payload = (await response.json()) as typeof payload;
          } catch {
            // Keep the stable generic fallback for non-JSON infrastructure errors.
          }
          if (response.status === 402) {
            throw new UpgradeRequiredError({
              errorCode: "free_chat_exceeded",
              tier: "free",
              upgradeUrl: payload.upgradeUrl ?? "/pricing",
              message: payload.message ?? "Upgrade required",
            });
          }
          throw new Error(payload.message ?? "Could not send the question.");
        }
        if (!response.body) throw new Error("Empty response from server.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const event = parseEvent(line);
            if (!event) continue;
            switch (event.type) {
              case "source_manifest":
                currentDraft = { ...currentDraft, manifest: event.manifest };
                break;
              case "source_coverage":
                currentDraft = { ...currentDraft, coverage: event.coverage };
                break;
              case "answer_start":
                currentDraft = {
                  ...currentDraft,
                  classification: event.classification,
                  mode: event.mode ?? currentDraft.mode,
                };
                break;
              case "delta":
                currentDraft = {
                  ...currentDraft,
                  assistant: currentDraft.assistant + event.text,
                };
                break;
              case "citation_diagnostics":
                currentDraft = {
                  ...currentDraft,
                  diagnostics: event.diagnostics,
                };
                break;
              case "done":
                completed = true;
                if (
                  currentDraft.manifest &&
                  currentDraft.coverage &&
                  currentDraft.classification
                ) {
                  captureAnalyticsEvent("project_grounded_answer_completed", {
                    classification: currentDraft.classification,
                    ...(currentDraft.mode === PROJECT_DEFAULT_CONVERSATION_MODE
                      ? {}
                      : { mode: currentDraft.mode }),
                    source_set_revision:
                      currentDraft.manifest.sourceSetRevision,
                    total_videos: currentDraft.coverage.totalVideos,
                    ready_videos: currentDraft.coverage.readyVideos,
                    evidence_videos: currentDraft.coverage.evidenceVideos,
                    unavailable_videos:
                      currentDraft.coverage.unavailableVideos.length,
                    passages_examined:
                      currentDraft.coverage.passagesExamined,
                    evidence_passages:
                      currentDraft.coverage.evidencePassages,
                    citation_diagnostics: currentDraft.diagnostics.length,
                  });
                }
                break;
              case "error":
                throw new Error(event.message);
            }
            setDraft(currentDraft);
          }
        }
        if (!completed) throw new Error("The answer stream ended early.");
      } catch (caught) {
        aborted =
          controller.signal.aborted ||
          (caught instanceof DOMException && caught.name === "AbortError");
        // Partial assistant output is never retained after abort/failure. The
        // subsequent reload keeps the already-reserved user message only.
        setDraft(null);
        if (!aborted) {
          if (caught instanceof UpgradeRequiredError) {
            upgradeWasRequired = true;
            setUpgradeError(caught);
          } else {
            setError(
              caught instanceof Error
                ? caught.message
                : "Could not send the question.",
            );
          }
        }
      } finally {
        if (aborted && reservedUserMessageId) {
          try {
            const cancellation = await fetch(
              `/api/projects/${args.projectId}/conversation/cancel`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userMessageId: reservedUserMessageId,
                }),
              },
            );
            if (!cancellation.ok) {
              throw new Error("Project question cancellation was not confirmed.");
            }
          } catch (cancellationError) {
            logAppEvent("error", "[project-conversation] cancellation failed", {
              errorId: "PROJECT_CONVERSATION_CANCELLATION_FAILED",
              errorName:
                cancellationError instanceof Error
                  ? cancellationError.name
                  : typeof cancellationError,
            });
            setError("Could not confirm that the answer was stopped. Reload the Project.");
          }
        }
        try {
          await reload();
        } catch (reloadError) {
          logAppEvent("error", "[project-conversation] reload failed", {
            errorId: "PROJECT_CONVERSATION_RELOAD_FAILED",
            errorName:
              reloadError instanceof Error
                ? reloadError.name
                : typeof reloadError,
          });
          if (!upgradeWasRequired) {
            setError((current) =>
              current ?? "Could not reload the Project Conversation.",
            );
          }
        }
        setDraft(null);
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [activeConversationId, args.projectId, reload],
  );

  const retry = useCallback(() => {
    // A retry is a fresh durable user turn. The failed turn remains visible
    // under the Project's existing durability rule, so the server's shared
    // Free quota intentionally counts the new attempt as another question.
    if (lastQuestionRef.current) {
      return send(
        lastQuestionRef.current.question,
        lastQuestionRef.current.mode,
      );
    }
    return Promise.resolve();
  }, [send]);

  return {
    conversation,
    conversations,
    activeConversationId,
    draft,
    streaming,
    conversationLoading,
    error,
    upgradeError,
    send,
    retry,
    abort,
    selectConversation,
    createConversation,
    renameConversation,
    clearConversation,
    refreshConversations,
  } as const;
}
