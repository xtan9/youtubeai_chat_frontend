import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ProjectAnswerArtifactsSchema,
  ProjectAnswerCompletionDatabaseResultSchema,
  ProjectConversationDatabaseResultSchema,
  ProjectConversationPageCursorSchema,
  ProjectSourceSetEventPageCursorSchema,
  ProjectSourceSetEventPageDatabaseResultSchema,
  ProjectGroundedAttemptDatabaseResultSchema,
  ProjectQuestionCancellationDatabaseResultSchema,
  ProjectQuestionStartDatabaseResultSchema,
  PROJECT_DEFAULT_CONVERSATION_MODE,
  type ProjectAnswerCompletionResolution,
  type ProjectGroundedAnswerCapability,
  type ProjectGroundedAnswerResolution,
  type ProjectGroundedAttemptResolution,
  type ProjectConversationPageCursor,
  type ProjectSourceSetEventPageCursor,
  type ProjectQuestionCancellationResolution,
  type ProjectQuestionStartResolution,
} from "./project-grounded-answer-contract";

type ProjectGroundedAnswerTarget = Readonly<{
  projectId: string;
  ownerId: string;
}>;

function logGroundedAnswerFailure(
  target: ProjectGroundedAnswerTarget,
  operation:
    | "load"
    | "load_events"
    | "load_attempt"
    | "start"
    | "cancel"
    | "begin_persistence"
    | "complete",
  errorClass: "DatabaseError" | "SchemaMismatch" | "AdapterError" | "NoServiceRole",
  code?: string,
) {
  // Never log the question, Project Goal, prior messages, passage text,
  // generated answer, manifest titles, or citation strings.
  console.error("[project-grounded-answer] operation unavailable", {
    errorId: "PROJECT_GROUNDED_ANSWER_UNAVAILABLE",
    operation,
    projectId: target.projectId,
    ownerId: target.ownerId,
    errorClass,
    code,
  });
}

function unavailableLoad(): ProjectGroundedAnswerResolution {
  return { status: "unavailable" };
}

function unavailableStart(): ProjectQuestionStartResolution {
  return { status: "unavailable" };
}

function unavailableAttempt(): ProjectGroundedAttemptResolution {
  return { status: "unavailable" };
}

function unavailableCancellation(): ProjectQuestionCancellationResolution {
  return { status: "unavailable" };
}

export function encodeProjectConversationCursor(
  cursor: ProjectConversationPageCursor | null,
) {
  return cursor === null
    ? null
    : Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProjectConversationCursor(value: string) {
  if (value.length < 1 || value.length > 512) return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = ProjectConversationPageCursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeProjectSourceSetEventCursor(
  cursor: ProjectSourceSetEventPageCursor | null,
) {
  return cursor === null
    ? null
    : Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProjectSourceSetEventCursor(value: string) {
  if (value.length < 1 || value.length > 512) return null;
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const parsed = ProjectSourceSetEventPageCursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createProjectGroundedAnswerCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  target: ProjectGroundedAnswerTarget,
): ProjectGroundedAnswerCapability {
  return {
    async load(conversationId, cursor = null) {
      try {
        const [result, eventResult] = await Promise.all([
          supabase.rpc("load_project_conversation_page_v2", {
            p_project_id: target.projectId,
            p_conversation_id: conversationId ?? null,
            p_before_created_at: cursor?.createdAt ?? null,
            p_before_user_message_id: cursor?.userMessageId ?? null,
            p_turn_limit: 25,
          }),
          cursor === null
            ? supabase.rpc("load_project_source_set_event_page_v2", {
                p_project_id: target.projectId,
                p_before_created_at: null,
                p_before_event_id: null,
                p_event_limit: 100,
              })
            : Promise.resolve(null),
        ]);
        if (result.error || eventResult?.error) {
          logGroundedAnswerFailure(
            target,
            "load",
            "DatabaseError",
            result.error?.code ?? eventResult?.error?.code,
          );
          return unavailableLoad();
        }
        const parsed = ProjectConversationDatabaseResultSchema.safeParse(
          result.data,
        );
        const parsedEvents = eventResult
          ? ProjectSourceSetEventPageDatabaseResultSchema.safeParse(
              eventResult.data,
            )
          : null;
        if (!parsed.success || (parsedEvents !== null && !parsedEvents.success)) {
          logGroundedAnswerFailure(target, "load", "SchemaMismatch");
          return unavailableLoad();
        }
        if (
          parsed.data.outcome === "missing" ||
          (parsedEvents?.success && parsedEvents.data.outcome === "missing")
        ) {
          return { status: "missing" };
        }
        const eventPage =
          parsedEvents?.success && parsedEvents.data.outcome === "ready"
            ? parsedEvents.data
            : null;
        return {
          status: "ready",
          conversation: {
            conversationId: parsed.data.conversationId,
            messages: parsed.data.messages,
            ...(eventPage
              ? {
                  sourceSetEvents: eventPage.events,
                  nextEventCursor: encodeProjectSourceSetEventCursor(
                    eventPage.nextCursor,
                  ),
                }
              : {}),
            messagesUsed: parsed.data.messagesUsed,
            messagesLimit: parsed.data.messagesLimit,
            tier: parsed.data.tier,
            nextCursor: encodeProjectConversationCursor(parsed.data.nextCursor),
          },
        };
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "load",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableLoad();
      }
    },

    async loadEvents(cursor = null) {
      try {
        const result = await supabase.rpc(
          "load_project_source_set_event_page_v2",
          {
            p_project_id: target.projectId,
            p_before_created_at: cursor?.createdAt ?? null,
            p_before_event_id: cursor?.eventId ?? null,
            p_event_limit: 100,
          },
        );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "load_events",
            "DatabaseError",
            result.error.code,
          );
          return { status: "unavailable" };
        }
        const parsed =
          ProjectSourceSetEventPageDatabaseResultSchema.safeParse(result.data);
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "load_events", "SchemaMismatch");
          return { status: "unavailable" };
        }
        if (parsed.data.outcome === "missing") return { status: "missing" };
        return {
          status: "ready",
          events: parsed.data.events,
          nextCursor: encodeProjectSourceSetEventCursor(parsed.data.nextCursor),
        };
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "load_events",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { status: "unavailable" };
      }
    },

    async loadAttempt(questionId, conversationId) {
      try {
        const result = await supabase.rpc(
          "load_project_grounded_attempt_v2",
          {
            p_project_id: target.projectId,
            p_question_id: questionId,
            p_conversation_id: conversationId ?? null,
          },
        );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "load_attempt",
            "DatabaseError",
            result.error.code,
          );
          return unavailableAttempt();
        }
        const parsed = ProjectGroundedAttemptDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "load_attempt", "SchemaMismatch");
          return unavailableAttempt();
        }
        if (parsed.data.outcome === "missing") return { status: "missing" };
        return {
          status: "ready",
          userMessageId: parsed.data.userMessageId,
          state: parsed.data.state,
          assistant:
            parsed.data.assistant?.role === "assistant"
              ? parsed.data.assistant
              : null,
        };
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "load_attempt",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableAttempt();
      }
    },

    async start(
      questionId,
      question,
      conversationId,
      mode = PROJECT_DEFAULT_CONVERSATION_MODE,
    ) {
      try {
        const result = await supabase.rpc(
          "start_project_grounded_question_v2",
          {
            p_project_id: target.projectId,
            p_question_id: questionId,
             p_conversation_id: conversationId ?? null,
             p_question: question,
             p_mode: mode,
           },
         );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "start",
            "DatabaseError",
            result.error.code,
          );
          return unavailableStart();
        }
        const parsed = ProjectQuestionStartDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "start", "SchemaMismatch");
          return unavailableStart();
        }
        switch (parsed.data.outcome) {
          case "started": {
            return {
              status: "started",
              created: parsed.data.created,
              conversationId: parsed.data.conversationId,
              userMessageId: parsed.data.userMessageId,
              attemptToken: parsed.data.attemptToken,
              completionState: parsed.data.completionState,
              messagesUsed: parsed.data.messagesUsed,
              messagesLimit: parsed.data.messagesLimit,
              tier: parsed.data.tier,
              mode: parsed.data.mode ?? mode,
              history: parsed.data.history,
              goal: parsed.data.goal,
            };
          }
          case "limit_reached":
            return {
              status: "limit_reached",
              messagesUsed: parsed.data.messagesUsed,
              messagesLimit: parsed.data.messagesLimit,
              tier: parsed.data.tier,
            };
          case "invalid":
            return { status: "invalid" };
          case "missing":
            return { status: "missing" };
        }
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "start",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableStart();
      }
    },

    async cancel(reservation) {
      const serviceRole = getServiceRoleClient();
      if (!serviceRole) {
        logGroundedAnswerFailure(target, "cancel", "NoServiceRole");
        return unavailableCancellation();
      }
      try {
        const result = await serviceRole.rpc(
          "cancel_project_grounded_question_v2",
          {
            p_owner_id: target.ownerId,
            p_project_id: target.projectId,
            p_conversation_id: reservation.conversationId,
            p_user_message_id: reservation.userMessageId,
            p_attempt_token: reservation.attemptToken,
          },
        );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "cancel",
            "DatabaseError",
            result.error.code,
          );
          return unavailableCancellation();
        }
        const parsed = ProjectQuestionCancellationDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "cancel", "SchemaMismatch");
          return unavailableCancellation();
        }
        if (parsed.data.outcome === "completed") {
          return {
            status: "completed",
            assistantMessageId: parsed.data.assistantMessageId,
          };
        }
        if (parsed.data.outcome === "cancelled") {
          return { status: "cancelled" };
        }
        if (parsed.data.outcome === "stale") return { status: "stale" };
        return unavailableCancellation();
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "cancel",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableCancellation();
      }
    },

    async beginPersistence(input) {
      const artifacts = ProjectAnswerArtifactsSchema.safeParse(input.artifacts);
      if (
        !artifacts.success ||
        Array.from(input.assistantContent).length < 1 ||
        Array.from(input.assistantContent).length > 20_000
      ) {
        return { outcome: "invalid" };
      }
      const serviceRole = getServiceRoleClient();
      if (!serviceRole) {
        logGroundedAnswerFailure(target, "begin_persistence", "NoServiceRole");
        return { outcome: "unavailable" };
      }
      try {
        const result = await serviceRole.rpc(
          "begin_project_grounded_answer_persistence_v2",
          {
            p_owner_id: target.ownerId,
            p_project_id: target.projectId,
            p_conversation_id: input.reservation.conversationId,
            p_user_message_id: input.reservation.userMessageId,
            p_attempt_token: input.reservation.attemptToken,
            p_assistant_content: input.assistantContent,
            p_answer_classification: input.classification,
            p_mode:
              input.mode ??
              input.reservation.mode ??
              PROJECT_DEFAULT_CONVERSATION_MODE,
            p_source_set_revision:
              artifacts.data.evidenceSnapshot.sourceSetRevision,
            p_source_manifest: artifacts.data.sourceManifest,
            p_source_coverage: artifacts.data.sourceCoverage,
            p_evidence_snapshot: artifacts.data.evidenceSnapshot,
          },
        );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "begin_persistence",
            "DatabaseError",
            result.error.code,
          );
          return { outcome: "unavailable" };
        }
        const parsed = ProjectAnswerCompletionDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "begin_persistence", "SchemaMismatch");
          return { outcome: "unavailable" };
        }
        return parsed.data;
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "begin_persistence",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { outcome: "unavailable" };
      }
    },

    async complete(input): Promise<ProjectAnswerCompletionResolution> {
      const artifacts = ProjectAnswerArtifactsSchema.safeParse(input.artifacts);
      if (
        !artifacts.success ||
        Array.from(input.assistantContent).length < 1 ||
        Array.from(input.assistantContent).length > 20_000
      ) {
        return { outcome: "invalid" };
      }

      const serviceRole = getServiceRoleClient();
      if (!serviceRole) {
        logGroundedAnswerFailure(target, "complete", "NoServiceRole");
        return { outcome: "unavailable" };
      }

      try {
        const mode =
          input.mode ?? input.reservation.mode ?? PROJECT_DEFAULT_CONVERSATION_MODE;
        const result = await serviceRole.rpc(
          "complete_project_grounded_answer_v2",
          {
            p_owner_id: target.ownerId,
            p_project_id: target.projectId,
            p_conversation_id: input.reservation.conversationId,
            p_user_message_id: input.reservation.userMessageId,
            p_attempt_token: input.reservation.attemptToken,
            p_assistant_content: input.assistantContent,
            p_answer_classification: input.classification,
            p_mode: mode,
            p_source_set_revision:
              artifacts.data.evidenceSnapshot.sourceSetRevision,
            p_source_manifest: artifacts.data.sourceManifest,
            p_source_coverage: artifacts.data.sourceCoverage,
            p_evidence_snapshot: artifacts.data.evidenceSnapshot,
          },
        );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "complete",
            "DatabaseError",
            result.error.code,
          );
          return { outcome: "unavailable" };
        }
        const parsed = ProjectAnswerCompletionDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "complete", "SchemaMismatch");
          return { outcome: "unavailable" };
        }
        return parsed.data;
      } catch (error) {
        logGroundedAnswerFailure(
          target,
          "complete",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return { outcome: "unavailable" };
      }
    },
  };
}
