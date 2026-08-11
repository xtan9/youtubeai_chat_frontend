import "server-only";

import { z } from "zod";
import { logAppEvent } from "@/lib/observability";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  appendChatTurn,
  appendChatUserMessage,
  clearChatMessages,
  listChatMessages,
  type ChatMessageRow,
} from "@/lib/services/chat-store";
import type { VideoChatRetainedThread } from "@/lib/services/video-chat-subject";

const HeroDemoMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const HeroDemoHistorySchema = z
  .object({
    outcome: z.literal("ready"),
    messages: z.array(HeroDemoMessageSchema).max(16),
  })
  .strict();
const StoredSchema = z.object({ outcome: z.literal("stored") }).strict();
const ClearedSchema = z
  .object({
    outcome: z.literal("cleared"),
    deletedConversations: z.number().int().min(0).max(1),
  })
  .strict();

function historyUnavailable(operation: string, detail: string): Error {
  logAppEvent("error", "[video-chat-history] durable boundary unavailable", {
    errorId: "VIDEO_CHAT_HISTORY_UNAVAILABLE",
    operation,
    errorClass: detail,
  });
  return new Error("Hero Demo conversation storage unavailable");
}

async function callHeroDemoRpc<T>(input: {
  readonly operation: "load" | "append_turn" | "append_user" | "clear";
  readonly functionName:
    | "load_hero_demo_conversation"
    | "append_hero_demo_chat_turn"
    | "append_hero_demo_chat_user_message"
    | "clear_hero_demo_conversation";
  readonly args: Record<string, string | number>;
  readonly schema: z.ZodType<T>;
}): Promise<T> {
  const serviceRole = getServiceRoleClient();
  if (!serviceRole) throw historyUnavailable(input.operation, "ServiceRoleUnavailable");
  try {
    const result = await serviceRole.rpc(input.functionName, input.args);
    if (result.error) {
      throw historyUnavailable(
        input.operation,
        result.error.code ?? "DatabaseError",
      );
    }
    const parsed = input.schema.safeParse(result.data);
    if (!parsed.success) throw historyUnavailable(input.operation, "SchemaMismatch");
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message.includes("storage unavailable")) {
      throw error;
    }
    throw historyUnavailable(
      input.operation,
      error instanceof Error ? error.name : "AdapterError",
    );
  }
}

export async function listVideoChatMessages(
  userId: string,
  thread: VideoChatRetainedThread,
): Promise<readonly ChatMessageRow[]> {
  if (thread.kind === "database") {
    return listChatMessages(userId, thread.videoId);
  }
  const result = await callHeroDemoRpc({
    operation: "load",
    functionName: "load_hero_demo_conversation",
    args: {
      p_user_id: userId,
      p_youtube_video_id: thread.youtubeVideoId,
      p_message_limit: 16,
    },
    schema: HeroDemoHistorySchema,
  });
  return result.messages;
}

export async function appendVideoChatTurn(input: {
  readonly userId: string;
  readonly thread: VideoChatRetainedThread;
  readonly userMessage: string;
  readonly assistantMessage: string;
}): Promise<void> {
  if (input.thread.kind === "database") {
    await appendChatTurn({
      userId: input.userId,
      videoId: input.thread.videoId,
      userMessage: input.userMessage,
      assistantMessage: input.assistantMessage,
    });
    return;
  }
  await callHeroDemoRpc({
    operation: "append_turn",
    functionName: "append_hero_demo_chat_turn",
    args: {
      p_user_id: input.userId,
      p_youtube_video_id: input.thread.youtubeVideoId,
      p_user_message: input.userMessage,
      p_assistant_message: input.assistantMessage,
    },
    schema: StoredSchema,
  });
}

export async function appendVideoChatUserMessage(
  userId: string,
  thread: VideoChatRetainedThread,
  content: string,
): Promise<void> {
  if (thread.kind === "database") {
    await appendChatUserMessage(userId, thread.videoId, content);
    return;
  }
  await callHeroDemoRpc({
    operation: "append_user",
    functionName: "append_hero_demo_chat_user_message",
    args: {
      p_user_id: userId,
      p_youtube_video_id: thread.youtubeVideoId,
      p_user_message: content,
    },
    schema: StoredSchema,
  });
}

export async function clearVideoChatMessages(
  userId: string,
  thread: VideoChatRetainedThread,
): Promise<void> {
  if (thread.kind === "database") {
    await clearChatMessages(userId, thread.videoId);
    return;
  }
  await callHeroDemoRpc({
    operation: "clear",
    functionName: "clear_hero_demo_conversation",
    args: {
      p_user_id: userId,
      p_youtube_video_id: thread.youtubeVideoId,
    },
    schema: ClearedSchema,
  });
}
