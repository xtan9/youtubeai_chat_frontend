import {
  authorizeChannelAction,
  type ChannelAccessContext,
  type ChannelAccessDecision,
  type ConnectedChannelReference,
} from "./access";
import type { ChannelWorkBinding } from "./records";

export type ChannelPublicationPreflight = Readonly<{
  access: ChannelAccessContext;
  activeConnectedChannel: ConnectedChannelReference | null;
  work: ChannelWorkBinding;
  currentComment: Readonly<{
    commentId: string;
    commentHash: string;
  }> | null;
  finalTextValidated: boolean;
  remainingDailyPublications: number | null;
  exclusiveItemClaimed: boolean;
}>;

type PublicationDeniedReason =
  | "active_connected_channel_required"
  | "active_connected_channel_mismatch"
  | "publishing_authorization_mismatch"
  | "current_comment_unavailable"
  | "current_comment_changed"
  | "final_text_not_validated"
  | "publication_allowance_unavailable"
  | "exclusive_item_claim_required";

type ChannelAccessDenied = Extract<
  ChannelAccessDecision,
  { allowed: false }
>;

export type ChannelPublicationDeniedReason =
  | PublicationDeniedReason
  | ChannelAccessDenied["reason"];

export type ChannelPublicationDecision =
  | Readonly<{ allowed: true; action: "publication" }>
  | Readonly<{
      allowed: false;
      action: "publication";
      reason: ChannelPublicationDeniedReason;
    }>;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function denied(
  reason: PublicationDeniedReason,
): ChannelPublicationDecision {
  return { allowed: false, action: "publication", reason };
}

/**
 * Check all local publication preconditions before a caller attempts the one
 * provider write. In particular, the work binding is compared to the active
 * Connected Channel before any current-user identity can be substituted.
 */
export function authorizeChannelPublication(
  input: ChannelPublicationPreflight,
): ChannelPublicationDecision {
  const active = input.activeConnectedChannel;
  if (!active) return denied("active_connected_channel_required");

  const work = input.work;
  if (
    !hasText(active.ownerId) ||
    !hasText(active.channelId) ||
    !hasText(active.connectedChannelId) ||
    !hasText(active.grantId) ||
    !hasText(work.ownerId) ||
    !hasText(work.channelId) ||
    !hasText(work.connectedChannelId) ||
    !hasText(work.grantId) ||
    active.ownerId !== work.ownerId ||
    active.channelId !== work.channelId ||
    active.connectedChannelId !== work.connectedChannelId ||
    active.grantId !== work.grantId
  ) {
    return denied("active_connected_channel_mismatch");
  }

  const writeAuthorization = input.access.publishingAuthorization;
  if (
    writeAuthorization &&
    writeAuthorization.grantId !== active.grantId
  ) {
    return denied("publishing_authorization_mismatch");
  }

  const access = authorizeChannelAction("publication", {
    ...input.access,
    connectedChannel: active,
  });
  if (!access.allowed) {
    return {
      allowed: false,
      action: "publication",
      reason: access.reason,
    };
  }

  const currentComment = input.currentComment;
  if (!currentComment || !hasText(currentComment.commentId)) {
    return denied("current_comment_unavailable");
  }
  if (
    currentComment.commentId !== work.commentId ||
    !hasText(currentComment.commentHash) ||
    currentComment.commentHash !== work.commentHash
  ) {
    return denied("current_comment_changed");
  }

  if (input.finalTextValidated !== true) {
    return denied("final_text_not_validated");
  }
  const remainingDailyPublications = input.remainingDailyPublications;
  if (
    typeof remainingDailyPublications !== "number" ||
    !Number.isInteger(remainingDailyPublications) ||
    remainingDailyPublications < 1
  ) {
    return denied("publication_allowance_unavailable");
  }
  if (input.exclusiveItemClaimed !== true) {
    return denied("exclusive_item_claim_required");
  }

  return { allowed: true, action: "publication" };
}
