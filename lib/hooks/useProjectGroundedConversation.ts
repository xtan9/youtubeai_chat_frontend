"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PROJECT_QUESTION_MESSAGE_ID_HEADER,
  ProjectConversationSchema,
  ProjectConversationSummarySchema,
  ProjectGroundedAttemptResolutionSchema,
  ProjectGroundedQuestionRequestSchema,
  ProjectGroundedSseEventSchema,
  ProjectSourceSetEventPageSchema,
  type ProjectAnswerClassification,
  type ProjectAnswerCoverage,
  type ProjectAnswerSourceManifest,
  type ProjectCitationDiagnostic,
  type ProjectConversation,
  type ProjectConversationSummary,
  type ProjectConversationMessage,
} from "@/lib/projects/project-grounded-answer-contract";
import {
  PROJECT_DEFAULT_CONVERSATION_MODE,
  type ProjectConversationMode,
} from "@/lib/projects/project-grounded-synthesis";
import { UpgradeRequiredError } from "@/lib/errors/upgrade-required";
import { logAppEvent } from "@/lib/observability";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { classifyProjectActionHttpFailure } from "@/lib/analytics/project-activity";

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
type AttemptResponse = { attempt?: unknown; message?: string };
type EventPageResponse = { eventPage?: unknown; message?: string };
type AssistantMessage = Extract<
  ProjectConversationMessage,
  { role: "assistant" }
>;
type AttemptTerminal =
  | { readonly state: "absent" }
  | { readonly state: "cancelled" }
  | { readonly state: "completed"; readonly assistant: AssistantMessage };

const UNKNOWN_ATTEMPT_SETTLEMENT_CHECKS = 8;

function reconciliationDelay(attempt: number) {
  if (attempt === 0) return 0;
  return Math.min(1_000, 25 * 2 ** Math.min(attempt - 1, 6));
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted || milliseconds === 0) {
      resolve();
      return;
    }
    const timeout = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

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

function captureCompletion(input: {
  readonly projectId: string;
  readonly classification: ProjectAnswerClassification;
  readonly mode?: ProjectConversationMode;
  readonly manifest: ProjectAnswerSourceManifest;
  readonly coverage: ProjectAnswerCoverage;
  readonly diagnosticCount: number;
}) {
  captureAnalyticsEvent("project_grounded_answer_completed", {
    project_id: input.projectId,
    classification: input.classification,
    ...(input.mode === undefined || input.mode === PROJECT_DEFAULT_CONVERSATION_MODE
      ? {}
      : { mode: input.mode }),
    source_set_revision: input.manifest.sourceSetRevision,
    total_videos: input.coverage.totalVideos,
    ready_videos: input.coverage.readyVideos,
    used_videos: input.coverage.usedVideos,
    unavailable_videos: input.coverage.unavailableVideos.length,
    passages_examined: input.coverage.passagesExamined,
    passages_used: input.coverage.passagesUsed,
    citation_diagnostics: input.diagnosticCount,
  });
}

function completionAnnouncement(classification: ProjectAnswerClassification) {
  if (classification === "supported") {
    return "Grounded Answer complete. Evidence supported.";
  }
  if (classification === "abstained") {
    return "Grounded Answer complete. Abstained.";
  }
  return "Grounded Answer complete. Unsupported by sources.";
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
  const [persistenceStarted, setPersistenceStarted] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] =
    useState<UpgradeRequiredError | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [loadingEarlierActivity, setLoadingEarlierActivity] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const reconciliationAbortRef = useRef<AbortController | null>(null);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const messagePageAbortRef = useRef<AbortController | null>(null);
  const activityPageAbortRef = useRef<AbortController | null>(null);
  const lastQuestionRef = useRef<LastQuestionIntent | null>(null);
  const persistenceStartedRef = useRef(false);
  const sendEpochRef = useRef(0);
  const selectionEpochRef = useRef(0);

  useEffect(() => {
    return () => {
      selectionEpochRef.current += 1;
      sendEpochRef.current += 1;
      selectionAbortRef.current?.abort();
      messagePageAbortRef.current?.abort();
      activityPageAbortRef.current?.abort();
      reconciliationAbortRef.current?.abort();
      abortRef.current?.abort();
    };
  }, []);

  const persistConversationUrl = useCallback((conversationId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("conversationId", conversationId);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const reload = useCallback(
    async (
      conversationId = activeConversationId,
      options?: {
        readonly signal?: AbortSignal;
        readonly shouldCommit?: () => boolean;
      },
    ) => {
      const query = conversationId
        ? `?conversationId=${encodeURIComponent(conversationId)}`
        : "";
      const response = await fetch(
        `/api/projects/${args.projectId}/conversation${query}`,
        { cache: "no-store", signal: options?.signal },
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
      if (options?.shouldCommit && !options.shouldCommit()) return parsed.data;
      setConversation(parsed.data);
      if (parsed.data.conversationId) {
        setActiveConversationId(parsed.data.conversationId);
        setConversations((current) => {
          const existing = current.find(
            (item) => item.conversationId === parsed.data.conversationId,
          );
          if (!existing) {
            const timestamp = new Date().toISOString();
            return [
              {
                conversationId: parsed.data.conversationId!,
                name: "Project Conversation",
                createdAt: timestamp,
                updatedAt: timestamp,
                messageCount: parsed.data.messages.length,
              },
              ...current,
            ];
          }
          return current.map((item) =>
            item.conversationId === parsed.data.conversationId
              ? {
                  ...item,
                  messageCount: Math.max(
                    item.messageCount,
                    parsed.data.messages.length,
                  ),
                }
              : item,
          );
        });
      }
      return parsed.data;
    },
    [activeConversationId, args.projectId],
  );

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
      selectionAbortRef.current?.abort();
      messagePageAbortRef.current?.abort();
      activityPageAbortRef.current?.abort();
      setLoadingEarlier(false);
      setLoadingEarlierActivity(false);
      const controller = new AbortController();
      const selectionEpoch = selectionEpochRef.current + 1;
      selectionEpochRef.current = selectionEpoch;
      selectionAbortRef.current = controller;
      setConversationLoading(true);
      setError(null);
      try {
        await reload(conversationId, {
          signal: controller.signal,
          shouldCommit: () =>
            !controller.signal.aborted &&
            selectionEpochRef.current === selectionEpoch,
        });
        if (!controller.signal.aborted && selectionEpochRef.current === selectionEpoch) {
          persistConversationUrl(conversationId);
        }
      } catch (caught) {
        if (!controller.signal.aborted && selectionEpochRef.current === selectionEpoch) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not load the Project Conversation.",
          );
        }
      } finally {
        if (selectionEpochRef.current === selectionEpoch) {
          selectionAbortRef.current = null;
          setConversationLoading(false);
        }
      }
    },
    [
      abortRef,
      activeConversationId,
      conversation.conversationId,
      persistConversationUrl,
      reload,
    ],
  );

  const createConversation = useCallback(
    async (name?: string) => {
      if (abortRef.current) return null;
      selectionEpochRef.current += 1;
      selectionAbortRef.current?.abort();
      messagePageAbortRef.current?.abort();
      activityPageAbortRef.current?.abort();
      setLoadingEarlier(false);
      setLoadingEarlierActivity(false);
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
        persistConversationUrl(parsed.data.conversationId);
        setConversation({
          conversationId: parsed.data.conversationId,
          messages: [],
          // Source Set events belong to the Project, not to one thread. Keep
          // the already-loaded timeline visible while the new thread is empty.
          sourceSetEvents: conversation.sourceSetEvents,
          nextCursor: null,
          nextEventCursor: conversation.nextEventCursor ?? null,
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
      conversation.nextEventCursor,
      conversation.sourceSetEvents,
      conversation.tier,
      persistConversationUrl,
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

  const reconcileAttempt = useCallback(
    async (
      userMessageId: string,
      conversationId: string | null,
      epoch: number,
      signal: AbortSignal,
      reservationKnown: boolean,
    ): Promise<AttemptTerminal | null> => {
      let attempt = 0;
      let unknownChecks = 0;
      let loggedErrorName: string | null = null;
      while (sendEpochRef.current === epoch && !signal.aborted) {
        await abortableDelay(reconciliationDelay(attempt), signal);
        attempt += 1;
        if (signal.aborted || sendEpochRef.current !== epoch) return null;
        try {
          const response = await fetch(
            `/api/projects/${args.projectId}/conversation/attempt/${userMessageId}${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`,
            { cache: "no-store", signal },
          );
          if (signal.aborted || sendEpochRef.current !== epoch) return null;
          if (response.status === 404) {
            if (
              !reservationKnown &&
              ++unknownChecks >= UNKNOWN_ATTEMPT_SETTLEMENT_CHECKS
            ) {
              return { state: "absent" };
            }
            continue;
          }
          const payload = (await response.json()) as AttemptResponse;
          if (!response.ok) {
            throw new Error(
              payload.message ?? "Could not check the Grounded Answer.",
            );
          }
          const parsed = ProjectGroundedAttemptResolutionSchema.safeParse(
            payload.attempt,
          );
          if (!parsed.success || parsed.data.status !== "ready") {
            throw new Error("Grounded Answer attempt response was not valid.");
          }
          reservationKnown = true;
          if (parsed.data.state === "cancelled") {
            return { state: "cancelled" };
          }
          if (
            parsed.data.state === "completed" &&
            parsed.data.assistant
          ) {
            return {
              state: "completed",
              assistant: parsed.data.assistant,
            };
          }
        } catch (caught) {
          if (signal.aborted) return null;
          if (
            !reservationKnown &&
            ++unknownChecks >= UNKNOWN_ATTEMPT_SETTLEMENT_CHECKS
          ) {
            return { state: "absent" };
          }
          const errorName = caught instanceof Error ? caught.name : typeof caught;
          if (errorName !== loggedErrorName) {
            loggedErrorName = errorName;
            logAppEvent("error", "[project-conversation] reconciliation failed", {
              errorId: "PROJECT_CONVERSATION_RECONCILIATION_FAILED",
              errorName,
            });
          }
        }
      }
      return null;
    },
    [args.projectId],
  );

  const clearConversation = useCallback(
    async (conversationId: string) => {
      messagePageAbortRef.current?.abort();
      selectionEpochRef.current += 1;
      setLoadingEarlier(false);
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

  const abort = useCallback(() => {
    if (!persistenceStartedRef.current && abortRef.current) {
      setReconciling(true);
      setAnnouncement("Checking whether the Grounded Answer was saved.");
      abortRef.current.abort();
    }
  }, []);

  const loadEarlier = useCallback(async () => {
    const cursor = conversation.nextCursor;
    if (!cursor || loadingEarlier) return;
    messagePageAbortRef.current?.abort();
    const controller = new AbortController();
    const conversationIdAtLoad = activeConversationId;
    const selectionEpoch = selectionEpochRef.current;
    messagePageAbortRef.current = controller;
    setLoadingEarlier(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${args.projectId}/conversation?${new URLSearchParams({
          cursor,
          ...(conversationIdAtLoad
            ? { conversationId: conversationIdAtLoad }
            : {}),
        }).toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload = (await response.json()) as ConversationResponse;
      if (!response.ok) {
        throw new Error(
          payload.message ?? "Could not load earlier Project messages.",
        );
      }
      const parsed = ProjectConversationSchema.safeParse(payload.conversation);
      if (!parsed.success) {
        throw new Error("Project Conversation response was not valid.");
      }
      if (
        controller.signal.aborted ||
        selectionEpochRef.current !== selectionEpoch
      ) return;
      setConversation((current) => {
        if (current.conversationId !== conversationIdAtLoad) return current;
        const known = new Set(current.messages.map((message) => message.id));
        return {
          ...current,
          ...parsed.data,
          sourceSetEvents: current.sourceSetEvents,
          nextEventCursor: current.nextEventCursor,
          messages: [
            ...parsed.data.messages.filter((message) => !known.has(message.id)),
            ...current.messages,
          ],
        };
      });
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load earlier Project messages.",
        );
      }
    } finally {
      if (messagePageAbortRef.current === controller) {
        messagePageAbortRef.current = null;
        setLoadingEarlier(false);
      }
    }
  }, [
    activeConversationId,
    args.projectId,
    conversation.nextCursor,
    loadingEarlier,
  ]);

  const loadEarlierActivity = useCallback(async () => {
    const eventCursor = conversation.nextEventCursor;
    if (!eventCursor || loadingEarlierActivity) return;
    activityPageAbortRef.current?.abort();
    const controller = new AbortController();
    const conversationIdAtLoad = activeConversationId;
    const selectionEpoch = selectionEpochRef.current;
    activityPageAbortRef.current = controller;
    setLoadingEarlierActivity(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${args.projectId}/conversation?${new URLSearchParams({
          eventCursor,
        }).toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      const payload = (await response.json()) as EventPageResponse;
      if (!response.ok) {
        throw new Error(
          payload.message ?? "Could not load earlier Source Set activity.",
        );
      }
      const parsed = ProjectSourceSetEventPageSchema.safeParse(
        payload.eventPage,
      );
      if (!parsed.success) {
        throw new Error("Source Set activity response was not valid.");
      }
      if (
        controller.signal.aborted ||
        selectionEpochRef.current !== selectionEpoch
      ) return;
      setConversation((current) => {
        if (current.conversationId !== conversationIdAtLoad) return current;
        const known = new Set(
          (current.sourceSetEvents ?? []).map((event) => event.eventId),
        );
        return {
          ...current,
          sourceSetEvents: [
            ...parsed.data.events.filter((event) => !known.has(event.eventId)),
            ...(current.sourceSetEvents ?? []),
          ],
          nextEventCursor: parsed.data.nextCursor,
        };
      });
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not load earlier Source Set activity.",
        );
      }
    } finally {
      if (activityPageAbortRef.current === controller) {
        activityPageAbortRef.current = null;
        setLoadingEarlierActivity(false);
      }
    }
  }, [
    activeConversationId,
    args.projectId,
    conversation.nextEventCursor,
    loadingEarlierActivity,
  ]);

  const send = useCallback(
    async (
      rawQuestion: string,
      mode: ProjectConversationMode = PROJECT_DEFAULT_CONVERSATION_MODE,
    ) => {
      const parsedQuestion = ProjectGroundedQuestionRequestSchema.safeParse({
        questionId: crypto.randomUUID(),
        question: rawQuestion,
        mode,
      });
      if (!parsedQuestion.success || abortRef.current) return;
      const question = parsedQuestion.data.question;
      const questionId = parsedQuestion.data.questionId;
      lastQuestionRef.current = { question, mode };
      const controller = new AbortController();
      const reconciliationController = new AbortController();
      const conversationIdAtSend = activeConversationId;
      const epoch = sendEpochRef.current + 1;
      sendEpochRef.current = epoch;
      abortRef.current = controller;
      reconciliationAbortRef.current = reconciliationController;
      persistenceStartedRef.current = false;
      setStreaming(true);
      setPersistenceStarted(false);
      setReconciling(false);
      setError(null);
      setUpgradeError(null);
      setAnnouncement("Examining bounded Project passages.");
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
      let shouldReconcile = true;
      let reservationKnown = false;
      let failureCaptured = false;
      const captureMessageFailure = (
        errorClass:
          | ReturnType<typeof classifyProjectActionHttpFailure>
          | "network"
          | "processing"
          | "protocol"
          | "interrupted",
        httpStatus?: number,
      ) => {
        if (failureCaptured) return;
        failureCaptured = true;
        captureAnalyticsEvent("project_action_failed", {
          project_id: args.projectId,
          action_kind: "message",
          error_class: errorClass,
          ...(httpStatus !== undefined && httpStatus >= 400 && httpStatus <= 599
            ? { http_status: httpStatus }
            : {}),
        });
      };

      try {
        const response = await fetch(
          `/api/projects/${args.projectId}/conversation/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionId,
              question,
              ...(conversationIdAtSend
                ? { conversationId: conversationIdAtSend }
                : {}),
              ...(mode === PROJECT_DEFAULT_CONVERSATION_MODE ? {} : { mode }),
            }),
            signal: controller.signal,
          },
        );
        reservationKnown =
          response.headers.get(PROJECT_QUESTION_MESSAGE_ID_HEADER) === questionId;
        if (!response.ok) {
          captureMessageFailure(
            classifyProjectActionHttpFailure(response.status),
            response.status,
          );
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
          const existingAttempt =
            response.status === 409 &&
            payload.errorCode === "project_question_exists";
          reservationKnown ||= existingAttempt;
          shouldReconcile = existingAttempt || response.status >= 500;
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
        if (!response.body) {
          captureMessageFailure("protocol");
          throw new Error("Empty response from server.");
        }

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
            if (sendEpochRef.current !== epoch) continue;
            const event = parseEvent(line);
            if (!event) continue;
            switch (event.type) {
              case "question_reserved":
                if (event.userMessageId !== questionId) {
                  captureMessageFailure("protocol");
                  throw new Error("Grounded Answer reservation did not match.");
                }
                reservationKnown = true;
                break;
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
                setAnnouncement("Writing the Grounded Answer.");
                break;
              case "delta":
                currentDraft = {
                  ...currentDraft,
                  assistant: currentDraft.assistant + event.text,
                };
                break;
              case "persistence_started":
                persistenceStartedRef.current = true;
                setPersistenceStarted(true);
                setAnnouncement("Saving the Grounded Answer.");
                break;
              case "citation_diagnostics":
                currentDraft = {
                  ...currentDraft,
                  diagnostics: event.diagnostics,
                };
                break;
              case "done":
                completed = true;
                setAnnouncement(
                  completionAnnouncement(
                    currentDraft.classification ?? "unsupported",
                  ),
                );
                if (
                  currentDraft.manifest &&
                  currentDraft.coverage &&
                  currentDraft.classification
                ) {
                  captureCompletion({
                    projectId: args.projectId,
                    classification: currentDraft.classification,
                    mode: currentDraft.mode,
                    manifest: currentDraft.manifest,
                    coverage: currentDraft.coverage,
                    diagnosticCount: currentDraft.diagnostics.length,
                  });
                }
                break;
              case "error":
                captureMessageFailure("processing");
                throw new Error(event.message);
            }
            setDraft(currentDraft);
          }
        }
        if (!completed) {
          captureMessageFailure("interrupted");
          throw new Error("The answer stream ended early.");
        }
      } catch (caught) {
        aborted =
          controller.signal.aborted ||
          (caught instanceof DOMException && caught.name === "AbortError");
        if (!aborted && !completed && !failureCaptured) {
          captureMessageFailure("network");
        }
        if (sendEpochRef.current === epoch) setDraft(null);
        if (aborted && sendEpochRef.current === epoch) {
          setAnnouncement("Checking whether the Grounded Answer was saved.");
        }
        if (!aborted && sendEpochRef.current === epoch) {
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
        try {
          if (!completed && shouldReconcile && !upgradeWasRequired) {
            if (sendEpochRef.current === epoch) setReconciling(true);
            const terminal = await reconcileAttempt(
              questionId,
              conversationIdAtSend,
              epoch,
              reconciliationController.signal,
              reservationKnown,
            );
            if (terminal?.state === "completed") {
              if (sendEpochRef.current === epoch) {
                setError(null);
                setAnnouncement(
                  completionAnnouncement(
                    terminal.assistant.answerClassification,
                  ),
                );
              }
              captureCompletion({
                projectId: args.projectId,
                classification: terminal.assistant.answerClassification,
                mode: terminal.assistant.mode,
                manifest: terminal.assistant.sourceManifest,
                coverage: terminal.assistant.sourceCoverage,
                diagnosticCount:
                  terminal.assistant.citationDiagnostics.length,
              });
            } else if (terminal?.state === "cancelled") {
              if (sendEpochRef.current === epoch) {
                setAnnouncement("Generation stopped. Your question was saved.");
              }
            } else if (terminal?.state === "absent") {
              if (sendEpochRef.current === epoch) {
                setAnnouncement("Generation stopped before your question was saved.");
              }
            }
          }
          if (sendEpochRef.current === epoch) {
            await reload(conversationIdAtSend);
          }
        } catch (reloadError) {
          logAppEvent("error", "[project-conversation] reload failed", {
            errorId: "PROJECT_CONVERSATION_RELOAD_FAILED",
            errorName:
              reloadError instanceof Error
                ? reloadError.name
                : typeof reloadError,
          });
          if (!upgradeWasRequired && sendEpochRef.current === epoch) {
            setError((current) =>
              current ?? "Could not reload the Project Conversation.",
            );
          }
        }
        if (sendEpochRef.current === epoch) {
          reconciliationController.abort();
          reconciliationAbortRef.current = null;
          setDraft(null);
          setStreaming(false);
          setPersistenceStarted(false);
          setReconciling(false);
          abortRef.current = null;
          persistenceStartedRef.current = false;
        }
      }
    },
    [
      activeConversationId,
      args.projectId,
      reconcileAttempt,
      reload,
    ],
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
    persistenceStarted,
    reconciling,
    error,
    upgradeError,
    announcement,
    loadingEarlier,
    loadingEarlierActivity,
    loadEarlier,
    loadEarlierActivity,
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
