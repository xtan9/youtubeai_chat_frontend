import "server-only";
import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/service-role";

export type ChatRole = "user" | "assistant";

export interface ChatMessageRow {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: string;
}

const ChatMessageRowSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  created_at: z.string(),
});

export interface AppendChatTurnParams {
  readonly userId: string;
  readonly videoId: string;
  readonly userMessage: string;
  readonly assistantMessage: string;
}

class ServiceRoleUnavailableError extends Error {
  constructor() {
    super("[chat-store] service-role client unavailable");
    this.name = "ServiceRoleUnavailableError";
  }
}

/**
 * Read the full chat thread for a (user, video) pair, oldest → newest.
 *
 * Throws on infra failures so callers can decide policy. Routes typically
 * surface a 503; the dashboard / inline chat surfaces fall back to "empty
 * thread" and a banner — never silently render half a conversation.
 *
 * Validates rows via zod so a stale `role` enum surfaces as a loud error
 * rather than a silently typed `unknown`.
 */
export async function listChatMessages(
  userId: string,
  videoId: string
): Promise<readonly ChatMessageRow[]> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new ServiceRoleUnavailableError();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("user_id", userId)
    .eq("video_id", videoId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[chat-store] list failed", {
      errorId: "CHAT_LIST_FAILED",
      userId,
      videoId,
      error,
    });
    throw error;
  }

  const rows: ChatMessageRow[] = [];
  for (const raw of data ?? []) {
    const parsed = ChatMessageRowSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[chat-store] row schema mismatch — dropping row", {
        errorId: "CHAT_ROW_SCHEMA_MISMATCH",
        userId,
        videoId,
        issues: parsed.error.issues,
      });
      continue;
    }
    rows.push({
      id: parsed.data.id,
      role: parsed.data.role,
      content: parsed.data.content,
      createdAt: parsed.data.created_at,
    });
  }
  return rows;
}

/**
 * Persist a (user, assistant) turn in a single insert call. Either both
 * rows land or neither does — no half-turn states for the reload path.
 */
export async function appendChatTurn(
  params: AppendChatTurnParams
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new ServiceRoleUnavailableError();

  const { error } = await supabase.from("chat_messages").insert([
    {
      user_id: params.userId,
      video_id: params.videoId,
      role: "user",
      content: params.userMessage,
    },
    {
      user_id: params.userId,
      video_id: params.videoId,
      role: "assistant",
      content: params.assistantMessage,
    },
  ]);
  if (error) {
    console.error("[chat-store] append turn failed", {
      errorId: "CHAT_APPEND_TURN_FAILED",
      userId: params.userId,
      videoId: params.videoId,
      error,
    });
    throw error;
  }
}

/**
 * Persist only the user's message — used on the caller-abort path so the
 * question survives a torn-down stream. Mirrors the summary route's
 * "preserve user intent on abort" discipline.
 */
export async function appendChatUserMessage(
  userId: string,
  videoId: string,
  content: string
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new ServiceRoleUnavailableError();

  const { error } = await supabase.from("chat_messages").insert({
    user_id: userId,
    video_id: videoId,
    role: "user",
    content,
  });
  if (error) {
    console.error("[chat-store] append user-only failed", {
      errorId: "CHAT_APPEND_USER_FAILED",
      userId,
      videoId,
      error,
    });
    throw error;
  }
}

/** Clear the entire thread for (user, video). Idempotent. */
export async function clearChatMessages(
  userId: string,
  videoId: string
): Promise<void> {
  const supabase = getServiceRoleClient();
  if (!supabase) throw new ServiceRoleUnavailableError();

  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("user_id", userId)
    .eq("video_id", videoId);
  if (error) {
    console.error("[chat-store] clear failed", {
      errorId: "CHAT_CLEAR_FAILED",
      userId,
      videoId,
      error,
    });
    throw error;
  }
}
