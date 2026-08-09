"use client";

import { useCallback, useRef, useState } from "react";
import {
  ProjectConversationSchema,
  ProjectGroundedSseEventSchema,
  type ProjectAnswerClassification,
  type ProjectAnswerCoverage,
  type ProjectAnswerSourceManifest,
  type ProjectCitationDiagnostic,
  type ProjectConversation,
} from "@/lib/projects/project-grounded-answer-contract";
import { UpgradeRequiredError } from "@/lib/errors/upgrade-required";
import { logAppEvent } from "@/lib/observability";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

export type ProjectConversationDraft = Readonly<{
  user: string;
  assistant: string;
  manifest: ProjectAnswerSourceManifest | null;
  coverage: ProjectAnswerCoverage | null;
  classification: ProjectAnswerClassification | null;
  diagnostics: readonly ProjectCitationDiagnostic[];
}>;

type ConversationResponse = { conversation?: unknown; message?: string };

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
}) {
  const [conversation, setConversation] = useState(args.initialConversation);
  const [draft, setDraft] = useState<ProjectConversationDraft | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeError, setUpgradeError] =
    useState<UpgradeRequiredError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    const response = await fetch(
      `/api/projects/${args.projectId}/conversation`,
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
  }, [args.projectId]);

  const abort = useCallback(() => abortRef.current?.abort(), []);

  const send = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      setError(null);
      setUpgradeError(null);
      let upgradeWasRequired = false;
      let currentDraft: ProjectConversationDraft = {
        user: question,
        assistant: "",
        manifest: null,
        coverage: null,
        classification: null,
        diagnostics: [],
      };
      setDraft(currentDraft);
      let completed = false;

      try {
        const response = await fetch(
          `/api/projects/${args.projectId}/conversation/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
            signal: controller.signal,
          },
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
                    source_set_revision:
                      currentDraft.manifest.sourceSetRevision,
                    total_videos: currentDraft.coverage.totalVideos,
                    ready_videos: currentDraft.coverage.readyVideos,
                    used_videos: currentDraft.coverage.usedVideos,
                    unavailable_videos:
                      currentDraft.coverage.unavailableVideos.length,
                    passages_examined:
                      currentDraft.coverage.passagesExamined,
                    passages_used: currentDraft.coverage.passagesUsed,
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
        const aborted =
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
        setStreaming(false);
        abortRef.current = null;
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
      }
    },
    [args.projectId, reload],
  );

  return {
    conversation,
    draft,
    streaming,
    error,
    upgradeError,
    send,
    abort,
  } as const;
}
