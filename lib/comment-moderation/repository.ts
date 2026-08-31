import "server-only";

import { getServiceRoleClient } from "@/lib/supabase/service-role";
import {
  DEFAULT_REPLY_TEMPLATE,
  type ClassifiedComment,
  type ModerationItem,
  type ModerationSettings,
  type SafeYouTubeConnection,
} from "./contracts";

export class ModerationRepositoryUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModerationRepositoryUnavailableError";
  }
}

export type StoredYouTubeConnection = SafeYouTubeConnection &
  Readonly<{
    userId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    accessTokenExpiresAt: string;
    grantedScopes: readonly string[];
  }>;

type ConnectionRow = {
  user_id: string;
  youtube_channel_id: string;
  youtube_channel_title: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  access_token_expires_at: string;
  granted_scopes: string[] | null;
  auto_reply_enabled: boolean;
  auto_reply_threshold: number | string;
  reply_template: string;
  last_scan_at: string | null;
};

type ItemRow = {
  id: string;
  youtube_comment_id: string;
  youtube_parent_comment_id: string;
  youtube_video_id: string;
  author_display_name: string;
  comment_text: string;
  published_at: string | null;
  source_mode: ModerationItem["source"];
  classification: ModerationItem["classification"];
  confidence: number | string;
  reason_codes: string[] | null;
  suggested_reply: string;
  rendered_reply: string;
  status: ModerationItem["status"];
  youtube_reply_id: string | null;
  error_code: string | null;
  created_at: string;
};

function client() {
  const supabase = getServiceRoleClient();
  if (!supabase) {
    throw new ModerationRepositoryUnavailableError(
      "Supabase service role is not configured",
    );
  }
  return supabase;
}

function mapConnection(row: ConnectionRow): StoredYouTubeConnection {
  return {
    userId: row.user_id,
    channelId: row.youtube_channel_id,
    channelTitle: row.youtube_channel_title,
    encryptedAccessToken: row.encrypted_access_token,
    encryptedRefreshToken: row.encrypted_refresh_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    grantedScopes: row.granted_scopes ?? [],
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyThreshold: Number(row.auto_reply_threshold),
    replyTemplate: row.reply_template,
    lastScanAt: row.last_scan_at,
  };
}

function mapItem(row: ItemRow): ModerationItem {
  return {
    id: row.id,
    youtubeCommentId: row.youtube_comment_id,
    youtubeParentCommentId: row.youtube_parent_comment_id,
    youtubeVideoId: row.youtube_video_id,
    authorDisplayName: row.author_display_name,
    commentText: row.comment_text,
    publishedAt: row.published_at,
    source: row.source_mode,
    classification: row.classification,
    confidence: Number(row.confidence),
    reasonCodes: row.reason_codes ?? [],
    suggestedReply: row.suggested_reply,
    renderedReply: row.rendered_reply,
    status: row.status,
    youtubeReplyId: row.youtube_reply_id,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

export async function getYouTubeConnection(
  userId: string,
): Promise<StoredYouTubeConnection | null> {
  const result = await client()
    .from("youtube_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not load YouTube connection (${result.error.code ?? "unknown"})`,
    );
  }
  return result.data ? mapConnection(result.data as ConnectionRow) : null;
}

export async function saveYouTubeConnection(input: {
  userId: string;
  channelId: string;
  channelTitle: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: string;
  grantedScopes: readonly string[];
}): Promise<void> {
  const result = await client().from("youtube_connections").upsert(
    {
      user_id: input.userId,
      youtube_channel_id: input.channelId,
      youtube_channel_title: input.channelTitle,
      encrypted_access_token: input.encryptedAccessToken,
      encrypted_refresh_token: input.encryptedRefreshToken,
      access_token_expires_at: input.accessTokenExpiresAt,
      granted_scopes: [...input.grantedScopes],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not save YouTube connection (${result.error.code ?? "unknown"})`,
    );
  }
}

export async function refreshStoredAccessToken(input: {
  userId: string;
  encryptedAccessToken: string;
  accessTokenExpiresAt: string;
}): Promise<void> {
  const result = await client()
    .from("youtube_connections")
    .update({
      encrypted_access_token: input.encryptedAccessToken,
      access_token_expires_at: input.accessTokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId);
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not refresh YouTube connection (${result.error.code ?? "unknown"})`,
    );
  }
}

export async function updateModerationSettings(
  userId: string,
  settings: ModerationSettings,
): Promise<SafeYouTubeConnection> {
  const result = await client()
    .from("youtube_connections")
    .update({
      auto_reply_enabled: settings.autoReplyEnabled,
      auto_reply_threshold: settings.autoReplyThreshold,
      reply_template: settings.replyTemplate,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (result.error || !result.data) {
    throw new ModerationRepositoryUnavailableError(
      `Could not update moderation settings (${result.error?.code ?? "missing"})`,
    );
  }
  const connection = mapConnection(result.data as ConnectionRow);
  return {
    channelId: connection.channelId,
    channelTitle: connection.channelTitle,
    autoReplyEnabled: connection.autoReplyEnabled,
    autoReplyThreshold: connection.autoReplyThreshold,
    replyTemplate: connection.replyTemplate,
    lastScanAt: connection.lastScanAt,
  };
}

export async function disconnectYouTube(userId: string): Promise<void> {
  const result = await client()
    .from("youtube_connections")
    .delete()
    .eq("user_id", userId);
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not disconnect YouTube (${result.error.code ?? "unknown"})`,
    );
  }
}

export async function listModerationItems(
  userId: string,
  limit: number = 30,
): Promise<ModerationItem[]> {
  const result = await client()
    .from("youtube_comment_moderation_items")
    .select("*")
    .eq("user_id", userId)
    .neq("classification", "benign")
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not load moderation inbox (${result.error.code ?? "unknown"})`,
    );
  }
  return ((result.data ?? []) as ItemRow[]).map(mapItem);
}

export async function findKnownCommentIds(
  userId: string,
  commentIds: readonly string[],
): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const result = await client()
    .from("youtube_comment_moderation_items")
    .select("youtube_comment_id")
    .eq("user_id", userId)
    .in("youtube_comment_id", [...commentIds]);
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not deduplicate comments (${result.error.code ?? "unknown"})`,
    );
  }
  return new Set(
    (result.data ?? []).map((row) => String(row.youtube_comment_id)),
  );
}

export async function insertClassifiedComment(input: {
  userId: string;
  source: ModerationItem["source"];
  classification: ClassifiedComment;
  renderedReply: string;
}): Promise<ModerationItem | null> {
  const { candidate } = input.classification;
  const result = await client()
    .from("youtube_comment_moderation_items")
    .insert({
      user_id: input.userId,
      youtube_comment_id: candidate.commentId,
      youtube_parent_comment_id: candidate.parentCommentId,
      youtube_video_id: candidate.videoId,
      author_channel_id: candidate.authorChannelId,
      author_display_name: candidate.authorDisplayName,
      comment_text: candidate.text,
      published_at: candidate.publishedAt,
      source_mode: input.source,
      classification: input.classification.classification,
      confidence: input.classification.confidence,
      reason_codes: [...input.classification.reasonCodes],
      suggested_reply: input.classification.suggestedReply,
      rendered_reply: input.renderedReply,
      status:
        input.classification.classification === "benign" ? "ignored" : "draft",
    })
    .select("*")
    .single();
  if (result.error?.code === "23505") return null;
  if (result.error || !result.data) {
    throw new ModerationRepositoryUnavailableError(
      `Could not record moderation item (${result.error?.code ?? "missing"})`,
    );
  }
  return mapItem(result.data as ItemRow);
}

export async function claimModerationItemForReply(
  userId: string,
  itemId: string,
): Promise<ModerationItem | null> {
  const result = await client()
    .from("youtube_comment_moderation_items")
    .update({
      status: "publishing",
      error_code: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
    .eq("user_id", userId)
    .in("status", ["draft", "failed"])
    .select("*")
    .maybeSingle();
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not claim moderation item (${result.error.code ?? "unknown"})`,
    );
  }
  return result.data ? mapItem(result.data as ItemRow) : null;
}

export async function completeModerationReply(input: {
  userId: string;
  itemId: string;
  youtubeReplyId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const result = await client()
    .from("youtube_comment_moderation_items")
    .update({
      status: "replied",
      youtube_reply_id: input.youtubeReplyId,
      replied_at: now,
      updated_at: now,
    })
    .eq("id", input.itemId)
    .eq("user_id", input.userId)
    .eq("status", "publishing");
  if (result.error) {
    throw new ModerationRepositoryUnavailableError(
      `Could not complete moderation reply (${result.error.code ?? "unknown"})`,
    );
  }
}

export async function failModerationReply(input: {
  userId: string;
  itemId: string;
  errorCode: string;
}): Promise<void> {
  await client()
    .from("youtube_comment_moderation_items")
    .update({
      status: "failed",
      error_code: input.errorCode.slice(0, 100),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.itemId)
    .eq("user_id", input.userId)
    .eq("status", "publishing");
}

export async function recordScanCompleted(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await client()
    .from("youtube_connections")
    .update({ last_scan_at: now, updated_at: now })
    .eq("user_id", userId);
}

export function disconnectedConnectionDefaults(): SafeYouTubeConnection {
  return {
    channelId: "",
    channelTitle: "",
    autoReplyEnabled: false,
    autoReplyThreshold: 0.92,
    replyTemplate: DEFAULT_REPLY_TEMPLATE,
    lastScanAt: null,
  };
}
