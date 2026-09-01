import {
  ChannelAssessmentDecisionSchema,
  ChannelInteractionSchema,
  ChannelJourneySnapshotSchema,
  ChannelSchema,
  ChannelStewardSchema,
  ConnectedYouTubeChannelSchema,
  INTERACTION_ASSESSMENT_LABEL,
  InteractionAssessmentSchema,
  ReviewQueueSchema,
  SyntheticConnectedChannelDefinitionSchema,
} from "./domain";
import type {
  ChannelActivityProvider,
  ChannelAssessmentProvider,
  ChannelPersistence,
  Channel,
  ChannelAssessmentInput,
  ChannelAssessmentTarget,
  ChannelJourneySnapshot,
  ChannelPrincipal,
  ChannelSteward,
  ConnectedYouTubeChannel,
  InteractionAssessment,
  ReviewQueue,
  ReviewQueueItem,
  ScanRun,
  SyntheticConnectedChannelDefinition,
} from "./domain";
import {
  buildChannelHubPresentation,
  type ChannelHubPresentation,
} from "./presentation";

/**
 * Runs the offline Channel tracer only when every dependency is explicitly
 * supplied. There is intentionally no default provider, persistence adapter,
 * route, or navigation registration in this module.
 */

export type {
  ChannelActivityProvider,
  ChannelAssessmentProvider,
  ChannelPersistence,
} from "./domain";

export type ChannelJourneyInput = Readonly<{
  principal: ChannelPrincipal;
  adultAttested: boolean;
  connectedChannel: SyntheticConnectedChannelDefinition;
  activityProvider: ChannelActivityProvider;
  assessmentProvider: ChannelAssessmentProvider;
  persistence: ChannelPersistence;
  now?: () => Date;
}>;

export type ChannelJourney = Readonly<{
  snapshot: ChannelJourneySnapshot;
  presentation: ChannelHubPresentation;
}>;

export type ChannelJourneyResult =
  | Readonly<{ status: "ready"; journey: ChannelJourney }>
  | Readonly<{
      status: "blocked";
      seam: "identity";
      reason:
        | "principal_unavailable"
        | "adult_attestation_missing"
        | "connected_channel_unavailable";
    }>
  | Readonly<{
      status: "blocked";
      seam: "provider";
      reason:
        | "non_synthetic_provider"
        | "activity_unavailable"
        | "assessment_unavailable"
        | "invalid_response";
    }>
  | Readonly<{
      status: "blocked";
      seam: "persistence";
      reason:
        | "snapshot_invalid"
        | "save_failed"
        | "load_failed"
        | "hub_not_found"
        | "ownership_mismatch";
    }>;

const QUEUE_PRIORITY: Record<string, number> = {
  "Safety Flag": 0,
  "Actionable Abuse": 1,
  "Reviewable Interaction": 2,
};

export async function runChannelJourney(
  input: ChannelJourneyInput,
): Promise<ChannelJourneyResult> {
  const identity = resolveIdentity(input);
  if (identity.status !== "ready") return identity;

  if (
    input.activityProvider?.kind !== "synthetic" ||
    input.assessmentProvider?.kind !== "synthetic"
  ) {
    return {
      status: "blocked",
      seam: "provider",
      reason: "non_synthetic_provider",
    };
  }
  if (typeof input.activityProvider.scan !== "function") {
    return {
      status: "blocked",
      seam: "provider",
      reason: "activity_unavailable",
    };
  }
  if (typeof input.assessmentProvider.assess !== "function") {
    return {
      status: "blocked",
      seam: "provider",
      reason: "assessment_unavailable",
    };
  }

  const { channel, channelSteward, connectedYouTubeChannel, definition } =
    identity.value;
  const now = input.now?.() ?? new Date();
  if (Number.isNaN(now.getTime())) {
    return {
      status: "blocked",
      seam: "identity",
      reason: "connected_channel_unavailable",
    };
  }
  const timestamp = now.toISOString();
  const scanRunId = `scan-run:${definition.channelKey}:${timestamp}`;

  let rawInteractions: unknown;
  try {
    rawInteractions = await input.activityProvider.scan({
      connectedChannelId: connectedYouTubeChannel.id,
      channelKey: definition.channelKey,
      mode: "deliberate",
      window: "recent_seven_days",
      stewardPrincipalId: channelSteward.principalId,
    });
  } catch {
    return {
      status: "blocked",
      seam: "provider",
      reason: "activity_unavailable",
    };
  }

  const parsedInteractions = ChannelInteractionSchema.array()
    .max(200)
    .safeParse(rawInteractions);
  if (
    !parsedInteractions.success ||
    parsedInteractions.data.some(
      (interaction) =>
        interaction.connectedChannelId !== connectedYouTubeChannel.id ||
        interaction.governance.source !== "synthetic" ||
        interaction.governance.corpusVersion !==
          definition.governance.corpusVersion,
    )
  ) {
    return {
      status: "blocked",
      seam: "provider",
      reason: "invalid_response",
    };
  }

  const assessments: InteractionAssessment[] = [];
  let allowedCriticismCount = 0;
  for (const interaction of parsedInteractions.data) {
    const assessmentInput: ChannelAssessmentInput = {
      interaction,
      channelId: channel.id,
      connectedChannelId: connectedYouTubeChannel.id,
      scanRunId,
      mode: "deliberate",
      window: "recent_seven_days",
    };

    let rawDecision: unknown;
    try {
      rawDecision = await input.assessmentProvider.assess(assessmentInput);
    } catch {
      return {
        status: "blocked",
        seam: "provider",
        reason: "assessment_unavailable",
      };
    }

    const parsedDecision = ChannelAssessmentDecisionSchema.safeParse(rawDecision);
    if (!parsedDecision.success) {
      return {
        status: "blocked",
        seam: "provider",
        reason: "invalid_response",
      };
    }

    if (parsedDecision.data.classification === "Allowed Criticism") {
      allowedCriticismCount += 1;
      continue;
    }

    if (!isCoherentDecision(parsedDecision.data, interaction)) {
      return {
        status: "blocked",
        seam: "provider",
        reason: "invalid_response",
      };
    }

    const assessment: InteractionAssessment = {
      id: `interaction-assessment:${scanRunId}:${interaction.id}`,
      channelId: channel.id,
      connectedChannelId: connectedYouTubeChannel.id,
      scanRunId,
      interactionId: interaction.id,
      video: interaction.video,
      text: interaction.text,
      classification: parsedDecision.data.classification,
      target: parsedDecision.data.target,
      severity: parsedDecision.data.severity,
      status: "awaiting_review",
      replyDraft: null,
      assessedAt: timestamp,
      governance: interaction.governance,
    };
    const parsedAssessment = InteractionAssessmentSchema.safeParse(assessment);
    if (!parsedAssessment.success) {
      return {
        status: "blocked",
        seam: "provider",
        reason: "invalid_response",
      };
    }
    assessments.push(parsedAssessment.data);
  }

  const scanRun: ScanRun = {
    id: scanRunId,
    channelId: channel.id,
    connectedChannelId: connectedYouTubeChannel.id,
    stewardId: channelSteward.id,
    mode: "deliberate",
    status: "completed",
    startedAt: timestamp,
    completedAt: timestamp,
    coverage: {
      window: "recent_seven_days",
      interactionsDiscovered: parsedInteractions.data.length,
      assessmentsCreated: assessments.length,
      reviewItemsCreated: assessments.length,
      allowedCriticismCount,
    },
  };
  const reviewQueue = buildReviewQueue(
    channel,
    connectedYouTubeChannel,
    assessments,
  );
  const snapshot: ChannelJourneySnapshot = {
    channel,
    channelSteward,
    connectedYouTubeChannel,
    scanRun,
    interactionAssessments: assessments,
    reviewQueue,
  };
  if (!ChannelJourneySnapshotSchema.safeParse(snapshot).success) {
    return {
      status: "blocked",
      seam: "persistence",
      reason: "snapshot_invalid",
    };
  }
  if (!belongsToJourney(snapshot, channelSteward.principalId, channel.id)) {
    return {
      status: "blocked",
      seam: "provider",
      reason: "invalid_response",
    };
  }

  try {
    await input.persistence.saveJourney(snapshot);
  } catch {
    return {
      status: "blocked",
      seam: "persistence",
      reason: "save_failed",
    };
  }

  let stored: unknown;
  try {
    stored = await input.persistence.loadChannelHub(channelSteward.principalId);
  } catch {
    return {
      status: "blocked",
      seam: "persistence",
      reason: "load_failed",
    };
  }
  if (stored === null) {
    return {
      status: "blocked",
      seam: "persistence",
      reason: "hub_not_found",
    };
  }
  const parsedStored = ChannelJourneySnapshotSchema.safeParse(stored);
  if (!parsedStored.success) {
    return {
      status: "blocked",
      seam: "persistence",
      reason: "snapshot_invalid",
    };
  }
  if (!belongsToJourney(parsedStored.data, channelSteward.principalId, channel.id)) {
    return {
      status: "blocked",
      seam: "persistence",
      reason: "ownership_mismatch",
    };
  }

  return {
    status: "ready",
    journey: {
      snapshot: parsedStored.data,
      presentation: buildChannelHubPresentation(parsedStored.data),
    },
  };
}

function resolveIdentity(
  input: ChannelJourneyInput,
):
  | Readonly<{
      status: "ready";
      value: Readonly<{
        channel: Channel;
        channelSteward: ChannelSteward;
        connectedYouTubeChannel: ConnectedYouTubeChannel;
        definition: SyntheticConnectedChannelDefinition;
      }>;
    }>
  | Extract<ChannelJourneyResult, { seam: "identity" }> {
  if (
    !input.principal ||
    typeof input.principal.userId !== "string" ||
    input.principal.userId.trim().length === 0 ||
    input.principal.isAnonymous !== false
  ) {
    return {
      status: "blocked",
      seam: "identity",
      reason: "principal_unavailable",
    };
  }
  if (input.adultAttested !== true) {
    return {
      status: "blocked",
      seam: "identity",
      reason: "adult_attestation_missing",
    };
  }
  const parsedDefinition = SyntheticConnectedChannelDefinitionSchema.safeParse(
    input.connectedChannel,
  );
  if (!parsedDefinition.success) {
    return {
      status: "blocked",
      seam: "identity",
      reason: "connected_channel_unavailable",
    };
  }

  const principalId = input.principal.userId.trim();
  const definition = parsedDefinition.data;
  const channelId = `channel:${definition.channelKey}`;
  const connectedChannelId = `connected-youtube-channel:${definition.channelKey}`;
  const stewardId = `channel-steward:${principalId}:${definition.channelKey}`;
  const channel: Channel = {
    id: channelId,
    stewardId,
    activeConnectedChannelId: connectedChannelId,
    governance: definition.governance,
  };
  const channelSteward: ChannelSteward = {
    id: stewardId,
    principalId,
    channelId,
    adultAttested: true,
  };
  const connectedYouTubeChannel: ConnectedYouTubeChannel = {
    id: connectedChannelId,
    channelId,
    stewardId,
    identity: { kind: "synthetic", key: definition.channelKey },
    displayName: definition.displayName,
    active: true,
    governance: definition.governance,
  };

  if (
    !ChannelSchema.safeParse(channel).success ||
    !ChannelStewardSchema.safeParse(channelSteward).success ||
    !ConnectedYouTubeChannelSchema.safeParse(connectedYouTubeChannel).success
  ) {
    return {
      status: "blocked",
      seam: "identity",
      reason: "connected_channel_unavailable",
    };
  }

  return {
    status: "ready",
    value: {
      channel,
      channelSteward,
      connectedYouTubeChannel,
      definition,
    },
  };
}

function isCoherentDecision(
  decision: {
    classification: string;
    target: ChannelAssessmentTarget;
    severity: "non_severe" | "severe";
  },
  interaction: {
    target: ChannelAssessmentTarget;
    behavior?: string;
  },
): boolean {
  if (
    decision.severity === "severe" &&
    decision.classification !== "Safety Flag"
  ) {
    return false;
  }
  if (
    decision.classification === "Actionable Abuse" &&
    (decision.target !== "channel_steward" ||
      interaction.target !== "channel_steward" ||
      decision.severity !== "non_severe")
  ) {
    return false;
  }
  if (
    decision.classification === "Safety Flag" &&
    decision.severity !== "severe"
  ) {
    return false;
  }
  if (
    decision.classification === "Allowed Criticism" &&
    decision.severity !== "non_severe"
  ) {
    return false;
  }
  if (
    interaction.behavior === "severe_threat" &&
    decision.classification !== "Safety Flag"
  ) {
    return false;
  }
  return true;
}

function buildReviewQueue(
  channel: Channel,
  connectedYouTubeChannel: ConnectedYouTubeChannel,
  assessments: readonly InteractionAssessment[],
): ReviewQueue {
  const items: ReviewQueueItem[] = assessments.map((assessment) => ({
    id: `review-queue-item:${assessment.id}`,
    assessmentId: assessment.id,
    interactionId: assessment.interactionId,
    video: assessment.video,
    interactionText: assessment.text,
    interactionAssessment: {
      label: INTERACTION_ASSESSMENT_LABEL,
      classification: assessment.classification,
      status: "awaiting_review",
    },
    status: "awaiting_review",
  }));
  items.sort((left, right) => {
    const priorityDifference =
      QUEUE_PRIORITY[left.interactionAssessment.classification] -
      QUEUE_PRIORITY[right.interactionAssessment.classification];
    return priorityDifference || left.id.localeCompare(right.id);
  });

  const queue: ReviewQueue = {
    id: `review-queue:${connectedYouTubeChannel.id}`,
    channelId: channel.id,
    connectedChannelId: connectedYouTubeChannel.id,
    items,
  };
  return ReviewQueueSchema.parse(queue);
}

function belongsToJourney(
  snapshot: ChannelJourneySnapshot,
  principalId: string,
  channelId: string,
): boolean {
  const identityMatches = (
    snapshot.channel.id === channelId &&
    snapshot.channelSteward.principalId === principalId &&
    snapshot.channelSteward.channelId === channelId &&
    snapshot.channel.stewardId === snapshot.channelSteward.id &&
    snapshot.connectedYouTubeChannel.channelId === channelId &&
    snapshot.connectedYouTubeChannel.stewardId === snapshot.channelSteward.id &&
    snapshot.channel.activeConnectedChannelId ===
      snapshot.connectedYouTubeChannel.id &&
    snapshot.scanRun.channelId === channelId &&
    snapshot.scanRun.connectedChannelId === snapshot.connectedYouTubeChannel.id &&
    snapshot.reviewQueue.channelId === channelId &&
    snapshot.reviewQueue.connectedChannelId ===
      snapshot.connectedYouTubeChannel.id
  );
  if (!identityMatches) return false;

  if (
    snapshot.scanRun.stewardId !== snapshot.channelSteward.id ||
    snapshot.scanRun.coverage.assessmentsCreated !==
      snapshot.interactionAssessments.length ||
    snapshot.scanRun.coverage.reviewItemsCreated !==
      snapshot.reviewQueue.items.length ||
    snapshot.scanRun.coverage.interactionsDiscovered !==
      snapshot.interactionAssessments.length +
        snapshot.scanRun.coverage.allowedCriticismCount ||
    snapshot.reviewQueue.items.length !==
      snapshot.interactionAssessments.length ||
    snapshot.connectedYouTubeChannel.governance.source !==
      snapshot.channel.governance.source ||
    snapshot.connectedYouTubeChannel.governance.corpusVersion !==
      snapshot.channel.governance.corpusVersion
  ) {
    return false;
  }

  const assessmentsById = new Map(
    snapshot.interactionAssessments.map((assessment) => [
      assessment.id,
      assessment,
    ]),
  );
  return (
    assessmentsById.size === snapshot.interactionAssessments.length &&
    snapshot.interactionAssessments.every(
    (assessment) =>
      assessment.channelId === channelId &&
      assessment.connectedChannelId ===
        snapshot.connectedYouTubeChannel.id &&
      assessment.scanRunId === snapshot.scanRun.id,
    ) &&
    snapshot.reviewQueue.items.every((item) => {
      const assessment = assessmentsById.get(item.assessmentId);
      return (
        assessment !== undefined &&
        item.interactionId === assessment.interactionId &&
        item.interactionAssessment.classification ===
          assessment.classification &&
        item.interactionText === assessment.text
      );
    })
  );
}
