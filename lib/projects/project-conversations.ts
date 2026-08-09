import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ProjectConversationDatabaseListResultSchema,
  ProjectConversationDatabaseSummarySchema,
  ProjectConversationMutationDatabaseResultSchema,
  ProjectConversationNameSchema,
  ProjectConversationSummarySchema,
  type ProjectConversationListResolution,
  type ProjectConversationManagementCapability,
  type ProjectConversationMutationResolution,
} from "./project-grounded-answer-contract";

type ProjectConversationTarget = Readonly<{
  projectId: string;
  ownerId: string;
}>;

const DEFAULT_CONVERSATION_NAME = "New conversation";

function logFailure(
  target: ProjectConversationTarget,
  operation: string,
  errorClass: string,
  code?: string,
) {
  // Conversation names and message content are intentionally excluded from
  // logs. Stable IDs and error classes are sufficient for diagnosis.
  console.error("[project-conversations] operation unavailable", {
    errorId: "PROJECT_CONVERSATIONS_UNAVAILABLE",
    operation,
    projectId: target.projectId,
    ownerId: target.ownerId,
    errorClass,
    code,
  });
}

function mapSummary(raw: z.infer<typeof ProjectConversationDatabaseSummarySchema>) {
  return ProjectConversationSummarySchema.parse({
    conversationId: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    messageCount: raw.messageCount,
  });
}

function unavailableList(): ProjectConversationListResolution {
  return { status: "unavailable" };
}

function unavailableMutation(): ProjectConversationMutationResolution {
  return { status: "unavailable" };
}

export function createProjectConversationCapability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  target: ProjectConversationTarget,
): ProjectConversationManagementCapability {
  return {
    async list() {
      try {
        const result = await supabase.rpc("list_project_conversations", {
          p_project_id: target.projectId,
        });
        if (result.error) {
          logFailure(target, "list", "DatabaseError", result.error.code);
          return unavailableList();
        }
        const parsed = ProjectConversationDatabaseListResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "list", "SchemaMismatch");
          return unavailableList();
        }
        if (parsed.data.outcome === "missing") return { status: "missing" };
        return {
          status: "ready",
          conversations: parsed.data.conversations.map(mapSummary),
          messagesUsed: parsed.data.messagesUsed,
          messagesLimit: parsed.data.messagesLimit,
          tier: parsed.data.tier,
        };
      } catch (error) {
        logFailure(
          target,
          "list",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableList();
      }
    },

    async create(name) {
      const parsedName = ProjectConversationNameSchema.safeParse(
        name ?? DEFAULT_CONVERSATION_NAME,
      );
      if (!parsedName.success) return { status: "invalid" };
      try {
        const result = await supabase.rpc("create_project_conversation", {
          p_project_id: target.projectId,
          p_name: parsedName.data,
        });
        if (result.error) {
          logFailure(target, "create", "DatabaseError", result.error.code);
          return unavailableMutation();
        }
        const parsed = ProjectConversationMutationDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "create", "SchemaMismatch");
          return unavailableMutation();
        }
        if (parsed.data.outcome === "created") {
          return { status: "created", conversation: mapSummary(parsed.data.conversation) };
        }
        if (parsed.data.outcome === "missing" || parsed.data.outcome === "invalid") {
          return { status: parsed.data.outcome };
        }
        logFailure(target, "create", "SchemaMismatch");
        return unavailableMutation();
      } catch (error) {
        logFailure(
          target,
          "create",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableMutation();
      }
    },

    async rename(conversationId, name) {
      const parsedName = ProjectConversationNameSchema.safeParse(name);
      if (!parsedName.success || !z.uuid().safeParse(conversationId).success) {
        return { status: "invalid" };
      }
      try {
        const result = await supabase.rpc("rename_project_conversation", {
          p_project_id: target.projectId,
          p_conversation_id: conversationId,
          p_name: parsedName.data,
        });
        if (result.error) {
          logFailure(target, "rename", "DatabaseError", result.error.code);
          return unavailableMutation();
        }
        const parsed = ProjectConversationMutationDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "rename", "SchemaMismatch");
          return unavailableMutation();
        }
        if (
          parsed.data.outcome === "renamed" ||
          parsed.data.outcome === "missing" ||
          parsed.data.outcome === "invalid"
        ) {
          return { status: parsed.data.outcome };
        }
        logFailure(target, "rename", "SchemaMismatch");
        return unavailableMutation();
      } catch (error) {
        logFailure(
          target,
          "rename",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableMutation();
      }
    },

    async clear(conversationId) {
      if (!z.uuid().safeParse(conversationId).success) return { status: "invalid" };
      try {
        const result = await supabase.rpc("clear_project_conversation", {
          p_project_id: target.projectId,
          p_conversation_id: conversationId,
        });
        if (result.error) {
          logFailure(target, "clear", "DatabaseError", result.error.code);
          return unavailableMutation();
        }
        const parsed = ProjectConversationMutationDatabaseResultSchema.safeParse(
          result.data,
        );
        if (!parsed.success) {
          logFailure(target, "clear", "SchemaMismatch");
          return unavailableMutation();
        }
        if (
          parsed.data.outcome === "cleared" ||
          parsed.data.outcome === "missing" ||
          parsed.data.outcome === "invalid"
        ) {
          return { status: parsed.data.outcome };
        }
        logFailure(target, "clear", "SchemaMismatch");
        return unavailableMutation();
      } catch (error) {
        logFailure(
          target,
          "clear",
          "AdapterError",
          error instanceof Error ? error.name : typeof error,
        );
        return unavailableMutation();
      }
    },
  };
}
