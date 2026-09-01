export const CHANNEL_HUB_SCREEN_STATES = [
  "disconnected",
  "free_discovery",
  "pro_onboarding",
  "connected",
  "scanning",
  "review",
  "grace_period",
  "deletion",
  "deleted",
] as const;

export type ChannelHubScreenState =
  (typeof CHANNEL_HUB_SCREEN_STATES)[number];

export const REVIEW_ITEM_STATUSES = [
  "reviewable",
  "actionable",
  "safety_flag",
  "dismissed",
  "marked_criticism",
  "draft_requested",
  "draft_ready",
  "stale",
  "publishing",
  "failed",
  "published",
  "publication_uncertain",
  "deleted",
] as const;

export type HubReviewStatus = (typeof REVIEW_ITEM_STATUSES)[number];

export type HubReviewClassification =
  | "Safety Flag"
  | "Actionable Abuse"
  | "Reviewable Interaction"
  | "Allowed Criticism";

export type HubChannelIdentity = Readonly<{
  channelId: string;
  connectedChannelId: string;
  providerChannelId: string;
  displayName: string;
}>;

export type ChannelHubChannel = HubChannelIdentity &
  Readonly<{
    active: boolean;
    grantStatus: "active" | "revoked";
    publishingAuthorization: "not_requested" | "active" | "revoked";
  }>;

export type HubCoverage = Readonly<{
  window: "recent_seven_days";
  windowStart: string;
  windowEnd: string;
  oldestThreadAt?: string | null;
  newestThreadAt?: string | null;
  pages: number;
  threadsDiscovered: number;
  threadsAssessed: number;
  threadsReused: number;
  threadsFailed: number;
  bound: "thread_limit" | "time_window" | null;
  boundPreventedCompleteCoverage: boolean;
  completeWithinBounds: boolean;
}>;

export type HubScanRun = Readonly<{
  id: string;
  status: "queued" | "running" | "completed" | "partial" | "cancelled" | "failed";
  progress: Readonly<{
    processedThreads: number;
    totalThreads: number;
    percent: number;
  }>;
  coverage: HubCoverage;
  failureMessage?: string | null;
}>;

export type HubReviewItem = Readonly<{
  id: string;
  channelId: string;
  connectedChannelId: string;
  video: Readonly<{ id: string; title: string }>;
  interactionText: string;
  topLevelCommentText: string | null;
  neighboringReplies: readonly string[];
  classification: HubReviewClassification;
  target: "channel_steward" | "other_participant" | "ambiguous";
  severity: "non_severe" | "severe";
  targetEvidence: readonly string[];
  draftEligible: boolean;
  status: HubReviewStatus;
  assessedAt: string;
  publishingIdentity: ChannelHubChannel;
  youtubeUrl: string;
  draft?: Readonly<{ text: string; updatedAt?: string }>;
  failure?: Readonly<{ message: string; retryable: boolean }>;
  publication?: Readonly<{ replyId: string | null; publishedAt?: string }>;
  deleteAllowed?: boolean;
  sensitiveEvidence?: Readonly<{ maskedText: string }>;
}>;

type DisconnectedHubState = Readonly<{
  kind: "disconnected";
  phase: "first_visit" | "after_disconnect";
  access: "anonymous" | "registered" | "unknown";
  entitlement: "free" | "active_pro" | "unavailable";
  canConnect: boolean;
}>;

type FreeDiscoveryHubState = Readonly<{
  kind: "free_discovery";
  upgradeHref: string;
}>;

type ProOnboardingHubState = Readonly<{
  kind: "pro_onboarding";
  step: "attest_age" | "authorize_read" | "select_channel" | "ready_to_scan";
  canContinue: boolean;
}>;

type ConnectedHubState = Readonly<{
  kind: "connected";
  channel: ChannelHubChannel;
  scanRun: HubScanRun | null;
  queue: readonly HubReviewItem[];
}>;

type ScanningHubState = Readonly<{
  kind: "scanning";
  channel: ChannelHubChannel;
  scanRun: HubScanRun;
  queue: readonly HubReviewItem[];
}>;

type ReviewHubState = Readonly<{
  kind: "review";
  channel: ChannelHubChannel;
  scanRun?: HubScanRun | null;
  coverage?: HubCoverage | null;
  queue: readonly HubReviewItem[];
  selectedItemId: string | null;
}>;

type GracePeriodHubState = Readonly<{
  kind: "grace_period";
  channel: ChannelHubChannel;
  expiresAt: string;
  queue: readonly HubReviewItem[];
  coverage?: HubCoverage | null;
}>;

type DeletionHubState = Readonly<{
  kind: "deletion";
  phase: "pending" | "in_progress" | "failed" | "completed";
  requestedAt: string;
  failureMessage?: string | null;
}>;

type DeletedHubState = Readonly<{
  kind: "deleted";
  deletedAt: string;
}>;

export type ChannelHubState =
  | DisconnectedHubState
  | FreeDiscoveryHubState
  | ProOnboardingHubState
  | ConnectedHubState
  | ScanningHubState
  | ReviewHubState
  | GracePeriodHubState
  | DeletionHubState
  | DeletedHubState;

export type HubAction =
  | "upgrade"
  | "connect"
  | "continue_onboarding"
  | "start_scan"
  | "cancel_scan"
  | "open_review"
  | "dismiss"
  | "defer"
  | "mark_allowed_criticism"
  | "confirm_actionable_abuse"
  | "request_draft"
  | "edit_draft"
  | "publish"
  | "retry_publication"
  | "recheck_publication"
  | "continue_safety_guidance"
  | "open_on_youtube"
  | "delete_published_reply"
  | "disconnect"
  | "export_data"
  | "delete_data";

export type HubReviewAction = Readonly<{
  action: Exclude<
    HubAction,
    | "upgrade"
    | "connect"
    | "continue_onboarding"
    | "start_scan"
    | "cancel_scan"
    | "open_review"
    | "disconnect"
    | "export_data"
    | "delete_data"
  >;
  label: string;
  href?: string;
}>;

export type HubCapabilities = Readonly<{
  canConnect: boolean;
  canStartScan: boolean;
  canCancelScan: boolean;
  canReview: boolean;
  canDraft: boolean;
  canPublish: boolean;
  canDelete: boolean;
  readOnly: boolean;
}>;

const EMPTY_CAPABILITIES: HubCapabilities = {
  canConnect: false,
  canStartScan: false,
  canCancelScan: false,
  canReview: false,
  canDraft: false,
  canPublish: false,
  canDelete: false,
  readOnly: false,
};

const TERMINAL_REVIEW_STATUSES = new Set<HubReviewStatus>([
  "dismissed",
  "marked_criticism",
  "published",
  "deleted",
]);

function hasActivePublishingAuthorization(channel: ChannelHubChannel): boolean {
  return (
    channel.active &&
    channel.grantStatus === "active" &&
    channel.publishingAuthorization === "active"
  );
}

export function getHubCapabilities(state: ChannelHubState): HubCapabilities {
  switch (state.kind) {
    case "disconnected":
      return {
        ...EMPTY_CAPABILITIES,
        canConnect:
          state.canConnect &&
          state.access === "registered" &&
          state.entitlement === "active_pro",
      };
    case "free_discovery":
      return EMPTY_CAPABILITIES;
    case "pro_onboarding":
      return { ...EMPTY_CAPABILITIES, canConnect: state.canContinue };
    case "connected":
      return {
        ...EMPTY_CAPABILITIES,
        canStartScan: state.channel.active && state.channel.grantStatus === "active",
        canReview: state.queue.length > 0,
        canPublish: hasActivePublishingAuthorization(state.channel),
      };
    case "scanning":
      return {
        ...EMPTY_CAPABILITIES,
        canCancelScan: state.scanRun.status === "queued" || state.scanRun.status === "running",
        canReview: state.queue.length > 0,
      };
    case "review":
      return {
        ...EMPTY_CAPABILITIES,
        canStartScan: state.channel.active && state.channel.grantStatus === "active",
        canReview: true,
        canDraft: state.queue.some(
          (item) =>
            item.classification === "Actionable Abuse" &&
            item.draftEligible &&
            item.status === "actionable",
        ),
        canPublish: hasActivePublishingAuthorization(state.channel),
      };
    case "grace_period":
      return {
        ...EMPTY_CAPABILITIES,
        canReview: state.queue.length > 0,
        canDelete: true,
        readOnly: true,
      };
    case "deletion":
      return EMPTY_CAPABILITIES;
    case "deleted":
      return EMPTY_CAPABILITIES;
  }
}

export function getReviewActions(item: HubReviewItem): readonly HubReviewAction[] {
  const actions: HubReviewAction[] = [];

  // Safety is dominant. Do this before looking at status or draft fields so a
  // stale or forged lifecycle state cannot reopen a response path.
  if (
    item.classification === "Safety Flag" ||
    item.severity === "severe" ||
    item.status === "safety_flag"
  ) {
    if (item.status === "deleted") return [];
    if (!TERMINAL_REVIEW_STATUSES.has(item.status)) {
      actions.push({
        action: "continue_safety_guidance",
        label: "Continue with safety guidance",
      });
    }
    return [...actions, { action: "open_on_youtube", label: "Open on YouTube", href: item.youtubeUrl }];
  }

  if (item.status === "reviewable" || item.status === "actionable") {
    actions.push(
      { action: "dismiss", label: "Dismiss" },
      { action: "defer", label: "Defer" },
      { action: "mark_allowed_criticism", label: "Mark as Allowed Criticism" },
    );
  }

  if (
    item.status === "reviewable" &&
    item.target === "channel_steward" &&
    item.severity === "non_severe" &&
    item.targetEvidence.length > 0
  ) {
    actions.push({
      action: "confirm_actionable_abuse",
      label: "Confirm Actionable Abuse",
    });
  }

  if (
    item.status === "actionable" &&
    item.draftEligible &&
    item.target === "channel_steward" &&
    item.severity === "non_severe"
  ) {
    actions.push({ action: "request_draft", label: "Request draft" });
  }

  if (item.status === "draft_ready" && item.draft) {
    actions.push({ action: "edit_draft", label: "Edit draft" });
    if (hasActivePublishingAuthorization(item.publishingIdentity)) {
      actions.push({ action: "publish", label: "Publish reviewed reply" });
    }
  }

  if (item.status === "stale") {
    actions.push({ action: "request_draft", label: "Request a fresh draft" });
  }

  if (item.status === "failed" && item.failure?.retryable === true) {
    actions.push({ action: "retry_publication", label: "Retry publication" });
  }

  if (item.status === "publication_uncertain") {
    actions.push({ action: "recheck_publication", label: "Check publication status" });
  }

  if (
    item.status === "published" &&
    item.publication?.replyId &&
    item.deleteAllowed === true &&
    item.publishingIdentity.active &&
    item.publishingIdentity.grantStatus === "active" &&
    item.publishingIdentity.publishingAuthorization === "active"
  ) {
    actions.push({ action: "delete_published_reply", label: "Delete published reply" });
  }

  if (item.status !== "deleted") {
    actions.push({ action: "open_on_youtube", label: "Open on YouTube", href: item.youtubeUrl });
  }

  return actions;
}

export function getReviewStatusLabel(status: HubReviewStatus): string {
  const labels: Record<HubReviewStatus, string> = {
    reviewable: "Reviewable Interaction",
    actionable: "Actionable Abuse",
    safety_flag: "Safety Flag",
    dismissed: "Dismissed",
    marked_criticism: "Marked Criticism",
    draft_requested: "Draft Requested",
    draft_ready: "Draft Ready",
    stale: "Stale",
    publishing: "Publishing",
    failed: "Failed",
    published: "Published",
    publication_uncertain: "Publication Uncertain",
    deleted: "Deleted",
  };
  return labels[status];
}

export function getReviewStatusDescription(status: HubReviewStatus): string {
  const descriptions: Record<HubReviewStatus, string> = {
    reviewable: "Context needs your review before a response decision.",
    actionable: "Non-severe abuse confirmed as targeting the Channel Steward.",
    safety_flag: "Safety concern detected; reply assistance is blocked.",
    dismissed: "Dismissed without a response action.",
    marked_criticism: "Marked as Allowed Criticism and removed from active work.",
    draft_requested: "A private Reply Draft has been requested.",
    draft_ready: "A private Reply Draft is ready for your edits.",
    stale: "The source changed; regenerate the draft before publishing.",
    publishing: "The reviewed reply is being sent to YouTube.",
    failed: "Publishing failed; retry only when the provider explicitly rejected it.",
    published: "The reviewed reply was published under the named YouTube identity.",
    publication_uncertain: "YouTube may have accepted the reply; check before retrying.",
    deleted: "The product-published reply was deleted.",
  };
  return descriptions[status];
}

export function getScreenStateLabel(state: ChannelHubScreenState): string {
  const labels: Record<ChannelHubScreenState, string> = {
    disconnected: "Disconnected",
    free_discovery: "Free discovery",
    pro_onboarding: "Pro onboarding",
    connected: "Connected",
    scanning: "Scanning",
    review: "Review",
    grace_period: "Read-only grace period",
    deletion: "Deletion",
    deleted: "Deleted",
  };
  return labels[state];
}

export function getScreenStateDescription(state: ChannelHubState): string {
  switch (state.kind) {
    case "disconnected":
      return state.phase === "after_disconnect"
        ? "The YouTube connection is disconnected. New Channel work is unavailable."
        : "Connect one verified YouTube Channel to review its public interactions."
    case "free_discovery":
      return "Explore Channel assistance with Free access; Pro is required to connect a Channel."
    case "pro_onboarding":
      return "Complete adult attestation and read-only identity setup before the first scan."
    case "connected":
      return "Your active Connected YouTube Channel is ready for a deliberate scan."
    case "scanning":
      return "A bounded Scan Run is gathering recent activity. Progress and coverage stay visible."
    case "review":
      return "Review one interaction at a time. Assessment and publication remain separate decisions."
    case "grace_period":
      return "Pro access ended. Existing Channel data is available read-only until the grace period ends."
    case "deletion":
      return state.phase === "failed"
        ? state.failureMessage ?? "Deletion needs attention before local data can be removed."
        : "Channel data deletion is durable compliance work and remains visible until complete."
    case "deleted":
      return "Channel data was deleted. No Channel identity or retained review text is available."
  }
}
