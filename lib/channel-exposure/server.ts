import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdultAttestation,
  ChannelAccessContext,
  ChannelEntitlement,
  ChannelGrantReference,
  ConnectedChannelReference,
} from "@/lib/channel-onboarding/access";
import type {
  ChannelHubChannel,
  ChannelHubState,
  HubScanRun,
  HubReviewItem,
} from "@/lib/channel-hub/contract";
import { loadInteractionReviewQueue } from "@/lib/channel/repository";
import type { InteractionReviewQueueItem } from "@/lib/channel/review-queue";
import { listChannelScanRuns } from "@/lib/channel-scans/service";
import {
  serializeScanRun,
  type PublicScanRun,
} from "@/lib/channel-scans/contracts";
import { getServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeYouTubeVideoId } from "@/lib/services/youtube-url";

type QueryResult = Readonly<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

type ChannelDetails = Readonly<{
  reference: ConnectedChannelReference;
  providerChannelId: string;
  displayName: string;
}>;

export type ChannelAccessSnapshot = Readonly<{
  access: ChannelAccessContext;
  channel: ChannelDetails | null;
}>;

export type ChannelAccessSnapshotResult =
  | Readonly<{ kind: "resolved"; snapshot: ChannelAccessSnapshot }>
  | Readonly<{ kind: "unavailable" }>;

export type OwnedVideoFilter =
  | Readonly<{ kind: "not_requested" }>
  | Readonly<{
      kind: "resolved";
      internalVideoId: string;
      providerVideoId: string | null;
    }>
  | Readonly<{ kind: "not_owned" }>
  | Readonly<{ kind: "unavailable" }>;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function arrayOfStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.map(text);
  return values.every((value): value is string => value !== null) ? values : null;
}

function rowObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function failedQuery(result: QueryResult): boolean {
  if (!result.error) return false;
  console.error("[channel-exposure] account projection query failed", {
    code: result.error.code,
  });
  return true;
}

function parseAttestation(value: unknown): AdultAttestation | null {
  const row = rowObject(value);
  if (!row) return null;
  const attestedAt = text(row.attested_at);
  const policyVersion = text(row.policy_version);
  if (!attestedAt || !policyVersion || !Number.isFinite(Date.parse(attestedAt))) {
    return null;
  }
  return { attested: true, attestedAt, policyVersion };
}

function parseChannelDetails(
  selectionValue: unknown,
  connectedRowsValue: unknown,
  grantRowsValue: unknown,
  ownerId: string,
): ChannelDetails | null | "invalid" {
  const selection = rowObject(selectionValue);
  if (!selection) return null;
  const channelId = text(selection.channel_id);
  const connectedChannelId = text(selection.connected_channel_id);
  if (!channelId || !connectedChannelId) return "invalid";

  const connectedRows = Array.isArray(connectedRowsValue)
    ? connectedRowsValue.map(rowObject).filter((row): row is Record<string, unknown> => row !== null)
    : [];
  const grantRows = Array.isArray(grantRowsValue)
    ? grantRowsValue.map(rowObject).filter((row): row is Record<string, unknown> => row !== null)
    : [];
  const connected = connectedRows.find(
    (row) =>
      text(row.id) === connectedChannelId &&
      text(row.channel_id) === channelId &&
      text(row.owner_id) === ownerId &&
      text(row.status) === "active" &&
      boolean(row.supported_creator) === true,
  );
  if (!connected) return "invalid";
  const grantId = text(connected.oauth_grant_id);
  if (!grantId) return "invalid";
  const grant = grantRows.find(
    (row) =>
      text(row.id) === grantId &&
      text(row.owner_id) === ownerId &&
      text(row.channel_id) === channelId &&
      text(row.status) === "active" &&
      text(row.provider) === "youtube",
  );
  if (!grant) return "invalid";

  const providerChannelId = text(connected.provider_channel_id);
  const displayName = text(connected.display_name);
  const credentialReferenceId = text(grant.credential_reference_id);
  const scopes = arrayOfStrings(grant.oauth_scopes);
  const readScopeGranted = boolean(grant.read_scope_granted);
  const writeScopeGranted = boolean(grant.write_scope_granted);
  if (
    !providerChannelId ||
    !displayName ||
    !credentialReferenceId ||
    !scopes ||
    readScopeGranted === null ||
    writeScopeGranted === null
  ) {
    return "invalid";
  }

  return {
    reference: {
      ownerId,
      channelId,
      connectedChannelId,
      grantId,
      supportedCreator: true,
      status: "active",
    },
    providerChannelId,
    displayName,
  };
}

function parseGrant(
  channel: ChannelDetails | null,
  grantRowsValue: unknown,
): ChannelGrantReference | null {
  if (!channel || !Array.isArray(grantRowsValue)) return null;
  const grant = grantRowsValue
    .map(rowObject)
    .find((row) => row && text(row.id) === channel.reference.grantId);
  if (!grant) return null;
  const credentialReferenceId = text(grant.credential_reference_id);
  const scopes = arrayOfStrings(grant.oauth_scopes);
  const readScopeGranted = boolean(grant.read_scope_granted);
  const writeScopeGranted = boolean(grant.write_scope_granted);
  if (
    !credentialReferenceId ||
    !scopes ||
    readScopeGranted === null ||
    writeScopeGranted === null
  ) {
    return null;
  }
  return {
    ownerId: channel.reference.ownerId,
    channelId: channel.reference.channelId,
    connectedChannelId: channel.reference.connectedChannelId,
    grantId: channel.reference.grantId,
    credentialReferenceId,
    provider: "youtube",
    scopes,
    readScopeGranted,
    writeScopeGranted,
    status: "active",
  };
}

/**
 * Load account-owned Channel facts through owner-filtered queries. A missing
 * or malformed projection is never promoted to an active Channel state.
 */
export async function loadChannelAccessSnapshot(input: Readonly<{
  supabase: SupabaseClient;
  userId: string;
  entitlement: ChannelEntitlement;
}>): Promise<ChannelAccessSnapshotResult> {
  const [attestationResult, selectionResult, connectedResult, grantResult] =
    await Promise.all([
      input.supabase
        .from("channel_adult_attestations")
        .select("owner_id, attested_at, policy_version")
        .eq("owner_id", input.userId)
        .maybeSingle(),
      input.supabase
        .from("active_connected_channel_selections")
        .select("owner_id, channel_id, connected_channel_id")
        .eq("owner_id", input.userId)
        .maybeSingle(),
      input.supabase
        .from("connected_youtube_channels")
        .select(
          "id, owner_id, channel_id, oauth_grant_id, provider_channel_id, display_name, supported_creator, status",
        )
        .eq("owner_id", input.userId),
      input.supabase
        .from("channel_oauth_grants")
        .select(
          "id, owner_id, channel_id, provider, oauth_scopes, credential_reference_id, read_scope_granted, write_scope_granted, status",
        )
        .eq("owner_id", input.userId),
    ]);

  const results = [
    attestationResult,
    selectionResult,
    connectedResult,
    grantResult,
  ] as QueryResult[];
  if (results.some(failedQuery)) return { kind: "unavailable" };

  const attestation = parseAttestation(attestationResult.data);
  const channelResult = parseChannelDetails(
    selectionResult.data,
    connectedResult.data,
    grantResult.data,
    input.userId,
  );
  if (channelResult === "invalid") return { kind: "unavailable" };
  const channel = channelResult;
  const grant = parseGrant(channel, grantResult.data);

  return {
    kind: "resolved",
    snapshot: {
      access: {
        principal: { userId: input.userId, isAnonymous: false },
        entitlement: input.entitlement,
        persistenceAvailable: getServiceRoleClient() !== null,
        adultAttestation: attestation,
        connectedChannel: channel?.reference ?? null,
        grant,
      },
      channel,
    },
  };
}

export async function loadOwnedVideoFilter(input: Readonly<{
  supabase: SupabaseClient;
  userId: string;
  requestedVideoId: string | null | undefined;
}>): Promise<OwnedVideoFilter> {
  const requestedVideoId = input.requestedVideoId?.trim();
  if (!requestedVideoId) return { kind: "not_requested" };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[4-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestedVideoId)) {
    return { kind: "not_owned" };
  }

  const historyResult = await input.supabase
    .from("user_video_history")
    .select("video_id")
    .eq("user_id", input.userId)
    .eq("video_id", requestedVideoId)
    .maybeSingle();
  if (failedQuery(historyResult as QueryResult)) return { kind: "unavailable" };
  if (!rowObject(historyResult.data)) return { kind: "not_owned" };

  const videoResult = await input.supabase
    .from("videos")
    .select("id, youtube_video_id")
    .eq("id", requestedVideoId)
    .maybeSingle();
  if (failedQuery(videoResult as QueryResult)) return { kind: "unavailable" };
  const video = rowObject(videoResult.data);
  if (!video || text(video.id) !== requestedVideoId) {
    return { kind: "unavailable" };
  }
  return {
    kind: "resolved",
    internalVideoId: requestedVideoId,
    providerVideoId: text(video.youtube_video_id),
  };
}

export type OwnedVideoUrlResult =
  | Readonly<{
      kind: "resolved";
      internalVideoId: string;
      providerVideoId: string;
    }>
  | Readonly<{ kind: "not_owned" }>
  | Readonly<{ kind: "unavailable" }>;

/**
 * Resolve a Summary URL to a Video only after checking the authenticated
 * owner's History row. The public Videos table may identify a URL, but it
 * cannot grant the caller access to another user's owned-video link.
 */
export async function loadOwnedVideoForUrl(input: Readonly<{
  supabase: SupabaseClient;
  userId: string;
  youtubeUrl: string;
}>): Promise<OwnedVideoUrlResult> {
  const providerVideoId = normalizeYouTubeVideoId(input.youtubeUrl);
  if (!providerVideoId) return { kind: "not_owned" };

  const videoResult = await input.supabase
    .from("videos")
    .select("id, youtube_video_id")
    .eq("youtube_video_id", providerVideoId)
    .maybeSingle();
  if (failedQuery(videoResult as QueryResult)) return { kind: "unavailable" };
  const video = rowObject(videoResult.data);
  const internalVideoId = text(video?.id);
  if (
    !video ||
    !internalVideoId ||
    text(video.youtube_video_id) !== providerVideoId
  ) {
    return { kind: "not_owned" };
  }

  const historyResult = await input.supabase
    .from("user_video_history")
    .select("video_id")
    .eq("user_id", input.userId)
    .eq("video_id", internalVideoId)
    .maybeSingle();
  if (failedQuery(historyResult as QueryResult)) return { kind: "unavailable" };
  const history = rowObject(historyResult.data);
  if (text(history?.video_id) !== internalVideoId) {
    return { kind: "not_owned" };
  }

  return { kind: "resolved", internalVideoId, providerVideoId };
}

function channelIdentity(
  details: ChannelDetails,
  grant: ChannelGrantReference,
): ChannelHubChannel {
  return {
    channelId: details.reference.channelId,
    connectedChannelId: details.reference.connectedChannelId,
    providerChannelId: details.providerChannelId,
    displayName: details.displayName,
    active: details.reference.status === "active",
    grantStatus: grant.status,
    publishingAuthorization:
      grant.writeScopeGranted && grant.scopes.includes("https://www.googleapis.com/auth/youtube.force-ssl")
        ? "active"
        : "not_requested",
  };
}

function providerVideoId(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/u.test(value);
}

function mapScanRun(run: PublicScanRun): HubScanRun {
  return {
    id: run.id,
    status: run.status,
    progress: run.progress,
    coverage: {
      window: "recent_seven_days",
      ...run.coverage,
    },
    failureMessage: null,
  };
}

function mapQueueItem(
  item: InteractionReviewQueueItem,
  identity: ChannelHubChannel,
): HubReviewItem | null {
  if (!providerVideoId(item.videoId)) return null;
  const target = item.target ?? "ambiguous";
  const targetEvidence = item.targetEvidence ?? [];
  const safety = item.category === "safety_flag";
  const classification = safety
    ? "Safety Flag"
    : item.category === "actionable_abuse"
      ? "Actionable Abuse"
      : "Reviewable Interaction";
  return {
    id: item.assessmentId,
    channelId: identity.channelId,
    connectedChannelId: identity.connectedChannelId,
    video: { id: item.videoId, title: item.videoTitle },
    interactionText: item.candidateText,
    topLevelCommentText: item.topLevelCommentText,
    neighboringReplies: item.neighboringReplies,
    classification,
    target,
    severity: safety ? "severe" : "non_severe",
    targetEvidence,
    draftEligible:
      !safety &&
      item.draftEligible &&
      target === "channel_steward" &&
      targetEvidence.length > 0,
    status: item.status,
    assessedAt: item.assessedAt,
    publishingIdentity: identity,
    youtubeUrl: `https://www.youtube.com/watch?v=${item.videoId}&lc=${encodeURIComponent(item.commentId)}`,
  };
}

/**
 * Load the connected projection only after the caller has verified the
 * account owner and active grant. Service-side repositories retain the same
 * account/channel scope, and failures render the Hub unavailable.
 */
export async function loadConnectedChannelHubState(input: Readonly<{
  accountId: string;
  details: ChannelDetails;
  grant: ChannelGrantReference;
  providerVideoId?: string | null;
}>): Promise<ChannelHubState | null> {
  let runs: Awaited<ReturnType<typeof listChannelScanRuns>>;
  let queue: readonly InteractionReviewQueueItem[];
  try {
    [runs, queue] = await Promise.all([
      listChannelScanRuns(
        input.accountId,
        input.details.reference.connectedChannelId,
      ),
      loadInteractionReviewQueue({
        accountId: input.accountId,
        connectedChannelId: input.details.reference.connectedChannelId,
      }),
    ]);
  } catch (error) {
    console.error("[channel-exposure] connected Hub projection unavailable", {
      accountId: input.accountId,
      reason: error,
    });
    return null;
  }

  const identity = channelIdentity(input.details, input.grant);
  const mappedQueue = queue
    .map((item) => mapQueueItem(item, identity))
    .filter((item): item is HubReviewItem => item !== null)
    .filter(
      (item) =>
        !input.providerVideoId || item.video.id === input.providerVideoId,
    );
  const mappedRuns = runs.map(serializeScanRun).map(mapScanRun);
  const activeRun = mappedRuns.find(
    (run) => run.status === "queued" || run.status === "running",
  );
  const latestRun = activeRun ?? mappedRuns[0] ?? null;

  if (activeRun) {
    return {
      kind: "scanning",
      channel: identity,
      scanRun: activeRun,
      queue: mappedQueue,
    };
  }
  if (mappedQueue.length > 0) {
    return {
      kind: "review",
      channel: identity,
      scanRun: latestRun,
      coverage: latestRun?.coverage ?? null,
      queue: mappedQueue,
      selectedItemId: mappedQueue[0].id,
    };
  }
  return {
    kind: "connected",
    channel: identity,
    scanRun: latestRun,
    queue: [],
  };
}

export type { ChannelDetails };
