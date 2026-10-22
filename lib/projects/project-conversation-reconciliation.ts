"use client";
import {
  ProjectGroundedAttemptResolutionSchema,
  type ProjectConversationMessage,
} from "@/lib/projects/project-grounded-answer-contract";
import { logAppEvent } from "@/lib/observability";

type AttemptResponse = { attempt?: unknown; message?: string };

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

export async function reconcileProjectGroundedAttempt(projectId: string, userMessageId: string, conversationId: string | null, isCurrent: () => boolean, signal: AbortSignal, reservationKnown: boolean): Promise<AttemptTerminal | null> {
      let attempt = 0;
      let unknownChecks = 0;
      let loggedErrorName: string | null = null;
      while (isCurrent() && !signal.aborted) {
        await abortableDelay(reconciliationDelay(attempt), signal);
        attempt += 1;
        if (signal.aborted || !isCurrent()) return null;
        try {
          const response = await fetch(
            `/api/projects/${projectId}/conversation/attempt/${userMessageId}${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ""}`,
            { cache: "no-store", signal },
          );
          if (signal.aborted || !isCurrent()) return null;
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
    }
