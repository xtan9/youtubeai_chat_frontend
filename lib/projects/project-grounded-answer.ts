import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ProjectAnswerArtifactsSchema,
  ProjectAnswerCompletionDatabaseResultSchema,
  ProjectCitationDiagnosticSchema,
  ProjectConversationDatabaseResultSchema,
  ProjectQuestionCancellationDatabaseResultSchema,
  ProjectQuestionStartDatabaseResultSchema,
  type ProjectAnswerCompletionResolution,
  type ProjectGroundedAnswerCapability,
  type ProjectGroundedAnswerResolution,
  type ProjectQuestionCancellationResolution,
  type ProjectQuestionStartResolution,
} from "./project-grounded-answer-contract";

type ProjectGroundedAnswerTarget = Readonly<{
  projectId: string;
  ownerId: string;
}>;

function logGroundedAnswerFailure(
  target: ProjectGroundedAnswerTarget,
  operation: "load" | "start" | "cancel" | "complete",
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

function unavailableCancellation(): ProjectQuestionCancellationResolution {
  return { status: "unavailable" };
}

export function createProjectGroundedAnswerCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  target: ProjectGroundedAnswerTarget,
): ProjectGroundedAnswerCapability {
  return {
    async load(conversationId) {
      try {
        const result = await supabase.rpc(
          conversationId
            ? "load_project_conversation"
            : "load_default_project_conversation",
          conversationId
            ? {
                p_project_id: target.projectId,
                p_conversation_id: conversationId,
              }
            : { p_project_id: target.projectId },
        );
        if (result.error) {
          logGroundedAnswerFailure(
            target,
            "load",
            "DatabaseError",
            result.error.code,
          );
          return unavailableLoad();
        }
        const parsed = ProjectConversationDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logGroundedAnswerFailure(target, "load", "SchemaMismatch");
          return unavailableLoad();
        }
        if (parsed.data.outcome === "missing") return { status: "missing" };
        return {
          status: "ready",
          conversation: {
            conversationId: parsed.data.conversationId,
            messages: parsed.data.messages,
            sourceSetEvents: parsed.data.sourceSetEvents,
            messagesUsed: parsed.data.messagesUsed,
            messagesLimit: parsed.data.messagesLimit,
            tier: parsed.data.tier,
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

    async start(question, conversationId) {
      try {
        const result = await supabase.rpc(
          "start_project_grounded_question",
          conversationId
            ? {
                p_project_id: target.projectId,
                p_question: question,
                p_conversation_id: conversationId,
              }
            : {
                p_project_id: target.projectId,
                p_question: question,
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
              conversationId: parsed.data.conversationId,
              userMessageId: parsed.data.userMessageId,
              attemptToken: parsed.data.attemptToken,
              messagesUsed: parsed.data.messagesUsed,
              messagesLimit: parsed.data.messagesLimit,
              tier: parsed.data.tier,
              history: parsed.data.history,
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
          case "missing":
            return { status: parsed.data.outcome };
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

    async cancel(userMessageId) {
      try {
        const result = await supabase.rpc("cancel_project_grounded_question", {
          p_project_id: target.projectId,
          p_user_message_id: userMessageId,
        });
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
        return { status: parsed.data.outcome };
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

    async complete(input): Promise<ProjectAnswerCompletionResolution> {
      const artifacts = ProjectAnswerArtifactsSchema.safeParse(input.artifacts);
      const diagnostics = ProjectCitationDiagnosticSchema.array()
        .max(20)
        .safeParse(input.citationDiagnostics);
      if (
        !artifacts.success ||
        !diagnostics.success ||
        input.assistantContent.length < 1 ||
        input.assistantContent.length > 20_000
      ) {
        return { outcome: "invalid" };
      }

      const serviceRole = getServiceRoleClient();
      if (!serviceRole) {
        logGroundedAnswerFailure(target, "complete", "NoServiceRole");
        return { outcome: "unavailable" };
      }

      try {
        const result = await serviceRole.rpc(
          "complete_project_grounded_answer",
          {
            p_owner_id: target.ownerId,
            p_project_id: target.projectId,
            p_conversation_id: input.reservation.conversationId,
            p_user_message_id: input.reservation.userMessageId,
            p_attempt_token: input.reservation.attemptToken,
            p_assistant_content: input.assistantContent,
            p_answer_classification: input.classification,
            p_source_set_revision:
              artifacts.data.evidenceSnapshot.sourceSetRevision,
            p_source_manifest: artifacts.data.sourceManifest,
            p_source_coverage: artifacts.data.sourceCoverage,
            p_evidence_snapshot: artifacts.data.evidenceSnapshot,
            p_citation_diagnostics: diagnostics.data,
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
