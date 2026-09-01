import {
  CHANNEL_HUB_LABEL,
  CHANNEL_LABEL,
  CHANNEL_STEWARD_LABEL,
  CONNECTED_YOUTUBE_CHANNEL_LABEL,
  INTERACTION_ASSESSMENT_LABEL,
  REVIEW_QUEUE_LABEL,
  SCAN_RUN_LABEL,
  type ChannelJourneySnapshot,
} from "./domain";

export type ChannelHubPresentation = Readonly<{
  kind: "channel_hub";
  surface: typeof CHANNEL_HUB_LABEL;
  channel: Readonly<{
    label: typeof CHANNEL_LABEL;
    id: string;
  }>;
  channelSteward: Readonly<{
    label: typeof CHANNEL_STEWARD_LABEL;
    principalId: string;
  }>;
  connectedYouTubeChannel: Readonly<{
    label: typeof CONNECTED_YOUTUBE_CHANNEL_LABEL;
    id: string;
    displayName: string;
    active: true;
  }>;
  scanRun: Readonly<{
    label: typeof SCAN_RUN_LABEL;
    id: string;
    mode: "deliberate";
    status: "completed";
    coverage: ChannelJourneySnapshot["scanRun"]["coverage"];
  }>;
  reviewQueue: Readonly<{
    label: typeof REVIEW_QUEUE_LABEL;
    id: string;
    items: readonly ChannelHubPresentationItem[];
  }>;
}>;

export type ChannelHubPresentationItem = Readonly<{
  id: string;
  assessmentId: string;
  interactionId: string;
  video: ChannelJourneySnapshot["reviewQueue"]["items"][number]["video"];
  interactionText: string;
  interactionAssessment: Readonly<{
    label: typeof INTERACTION_ASSESSMENT_LABEL;
    classification: ChannelJourneySnapshot["reviewQueue"]["items"][number]["interactionAssessment"]["classification"];
    status: "awaiting_review";
  }>;
  replyDraft: ChannelJourneySnapshot["reviewQueue"]["items"][number]["replyDraft"];
  status: "awaiting_review";
}>;

export function buildChannelHubPresentation(
  snapshot: ChannelJourneySnapshot,
): ChannelHubPresentation {
  return {
    kind: "channel_hub",
    surface: CHANNEL_HUB_LABEL,
    channel: {
      label: CHANNEL_LABEL,
      id: snapshot.channel.id,
    },
    channelSteward: {
      label: CHANNEL_STEWARD_LABEL,
      principalId: snapshot.channelSteward.principalId,
    },
    connectedYouTubeChannel: {
      label: CONNECTED_YOUTUBE_CHANNEL_LABEL,
      id: snapshot.connectedYouTubeChannel.id,
      displayName: snapshot.connectedYouTubeChannel.displayName,
      active: true,
    },
    scanRun: {
      label: SCAN_RUN_LABEL,
      id: snapshot.scanRun.id,
      mode: snapshot.scanRun.mode,
      status: snapshot.scanRun.status,
      coverage: snapshot.scanRun.coverage,
    },
    reviewQueue: {
      label: REVIEW_QUEUE_LABEL,
      id: snapshot.reviewQueue.id,
      items: snapshot.reviewQueue.items.map((item) => ({
        id: item.id,
        assessmentId: item.assessmentId,
        interactionId: item.interactionId,
        video: item.video,
        interactionText: item.interactionText,
        interactionAssessment: {
          label: INTERACTION_ASSESSMENT_LABEL,
          classification: item.interactionAssessment.classification,
          status: item.interactionAssessment.status,
        },
        replyDraft: item.replyDraft,
        status: item.status,
      })),
    },
  };
}
