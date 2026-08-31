import "server-only";

import { normalizeYouTubeVideoId } from "@/lib/services/youtube-url";
import { classifyYouTubeComments } from "./classifier";
import { getValidYouTubeAccess } from "./connection-service";
import {
  renderReplyTemplate,
  type ModerationItem,
  type ModerationSource,
} from "./contracts";
import {
  claimModerationItemForReply,
  completeModerationReply,
  failModerationReply,
  findKnownCommentIds,
  insertClassifiedComment,
  listModerationItems,
  recordScanCompleted,
} from "./repository";
import {
  listConsumerReplyCandidates,
  listCreatorCommentCandidates,
  publishYouTubeReply,
  YouTubeApiError,
} from "./youtube-api";

const MAX_CANDIDATES_PER_SCAN = 20;
const MAX_AUTO_REPLIES_PER_SCAN = 3;

export class InvalidModerationRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidModerationRequestError";
  }
}

export class ModerationItemUnavailableError extends Error {
  constructor() {
    super("This moderation item was already handled or is unavailable");
    this.name = "ModerationItemUnavailableError";
  }
}

function safeReplyErrorCode(error: unknown): string {
  if (error instanceof YouTubeApiError) return error.code;
  return "YOUTUBE_REPLY_FAILED";
}

async function publishClaimedItem(input: {
  userId: string;
  item: ModerationItem;
  accessToken: string;
}): Promise<void> {
  let youtubeReplyId: string;
  try {
    youtubeReplyId = await publishYouTubeReply({
      accessToken: input.accessToken,
      parentCommentId: input.item.youtubeParentCommentId,
      text: input.item.renderedReply,
    });
  } catch (error) {
    await failModerationReply({
      userId: input.userId,
      itemId: input.item.id,
      errorCode: safeReplyErrorCode(error),
    });
    throw error;
  }
  // Once YouTube has accepted the public reply, never transition back to a
  // retryable state if the local completion write fails: that could publish a
  // duplicate. Leave the item in `publishing` for operator reconciliation.
  await completeModerationReply({
    userId: input.userId,
    itemId: input.item.id,
    youtubeReplyId,
  });
}

export async function replyToModerationItem(input: {
  userId: string;
  itemId: string;
}): Promise<void> {
  const { accessToken } = await getValidYouTubeAccess({ userId: input.userId });
  const claimed = await claimModerationItemForReply(
    input.userId,
    input.itemId,
  );
  if (!claimed) throw new ModerationItemUnavailableError();
  await publishClaimedItem({
    userId: input.userId,
    item: claimed,
    accessToken,
  });
}

export async function scanYouTubeComments(input: {
  userId: string;
  source: ModerationSource;
  videoUrl?: string;
}): Promise<{
  seen: number;
  analyzed: number;
  flagged: number;
  autoReplied: number;
  items: ModerationItem[];
}> {
  const { connection, accessToken } = await getValidYouTubeAccess({
    userId: input.userId,
  });
  let candidates;
  if (input.source === "creator") {
    candidates = await listCreatorCommentCandidates({
      accessToken,
      channelId: connection.channelId,
      limit: MAX_CANDIDATES_PER_SCAN,
    });
  } else {
    const videoId = input.videoUrl
      ? normalizeYouTubeVideoId(input.videoUrl)
      : null;
    if (!videoId) {
      throw new InvalidModerationRequestError(
        "Paste a valid YouTube video URL.",
      );
    }
    candidates = await listConsumerReplyCandidates({
      accessToken,
      channelId: connection.channelId,
      videoId,
      limit: MAX_CANDIDATES_PER_SCAN,
    });
  }

  const known = await findKnownCommentIds(
    input.userId,
    candidates.map((candidate) => candidate.commentId),
  );
  const unseen = candidates.filter((candidate) => !known.has(candidate.commentId));
  const classifications = await classifyYouTubeComments(unseen);
  const inserted: ModerationItem[] = [];
  for (const classification of classifications) {
    const item = await insertClassifiedComment({
      userId: input.userId,
      source: input.source,
      classification,
      renderedReply: renderReplyTemplate(
        connection.replyTemplate,
        classification.suggestedReply,
      ),
    });
    if (item) inserted.push(item);
  }

  let autoReplied = 0;
  if (connection.autoReplyEnabled) {
    const eligible = inserted
      .filter(
        (item) =>
          item.classification === "hostile" &&
          item.confidence >= connection.autoReplyThreshold,
      )
      .slice(0, MAX_AUTO_REPLIES_PER_SCAN);
    for (const item of eligible) {
      const claimed = await claimModerationItemForReply(input.userId, item.id);
      if (!claimed) continue;
      try {
        await publishClaimedItem({
          userId: input.userId,
          item: claimed,
          accessToken,
        });
        autoReplied++;
      } catch {
        // The failed item stays visible with a retry affordance. One provider
        // failure must not suppress the rest of the scan result.
      }
    }
  }

  await recordScanCompleted(input.userId);
  return {
    seen: candidates.length,
    analyzed: unseen.length,
    flagged: inserted.filter((item) => item.classification !== "benign").length,
    autoReplied,
    items: await listModerationItems(input.userId),
  };
}
