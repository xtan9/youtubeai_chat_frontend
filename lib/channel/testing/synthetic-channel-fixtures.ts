import type {
  ChannelActivityProvider,
  ChannelAssessmentProvider,
  ChannelAssessmentDecision,
  ChannelInteraction,
  ChannelPersistence,
  ChannelJourneySnapshot,
  SyntheticConnectedChannelDefinition,
} from "../domain";
import type { RequestPrincipal } from "@/lib/auth/request-principal";

// This adapter set is test-only and contains no external credentials or user data.

export const SYNTHETIC_PRINCIPAL = {
  userId: "synthetic-channel-steward-468",
  isAnonymous: false,
  email: "synthetic-steward-468@example.test",
  smokeProEntitled: false,
  businessAnalyticsSuppressed: false,
} satisfies RequestPrincipal;

export const SYNTHETIC_CHANNEL = {
  channelKey: "synthetic-channel-468",
  displayName: "Synthetic Steward Channel",
  governance: {
    source: "synthetic",
    corpusVersion: "channel-tracer-v1",
  },
} satisfies SyntheticConnectedChannelDefinition;

export const SYNTHETIC_INTERACTION = {
  id: "synthetic-interaction-468",
  connectedChannelId: "connected-youtube-channel:synthetic-channel-468",
  video: {
    id: "synthetic-video-468",
    title: "Synthetic Channel Review Video",
  },
  text: "You are an idiot.",
  target: "channel_steward",
  behavior: "direct_insult",
  observedAt: "2026-08-31T11:00:00.000Z",
  governance: SYNTHETIC_CHANNEL.governance,
} satisfies ChannelInteraction;

export function createSyntheticChannelActivityProvider(): ChannelActivityProvider {
  return {
    kind: "synthetic",
    async scan(request) {
      return request.channelKey === SYNTHETIC_CHANNEL.channelKey
        ? [SYNTHETIC_INTERACTION]
        : [];
    },
  };
}

export function createSyntheticChannelAssessmentProvider(): ChannelAssessmentProvider {
  return {
    kind: "synthetic",
    async assess({ interaction }): Promise<ChannelAssessmentDecision> {
      if (interaction.behavior === "severe_threat") {
        return {
          classification: "Safety Flag",
          target: interaction.target,
          severity: "severe",
        };
      }
      if (
        interaction.behavior === "direct_insult" &&
        interaction.target === "channel_steward"
      ) {
        return {
          classification: "Actionable Abuse",
          target: "channel_steward",
          severity: "non_severe",
        };
      }
      if (interaction.behavior === "content_criticism") {
        return {
          classification: "Allowed Criticism",
          target: interaction.target,
          severity: "non_severe",
        };
      }
      return {
        classification: "Reviewable Interaction",
        target: interaction.target,
        severity: "non_severe",
      };
    },
  };
}

export function createInMemoryChannelPersistence(): ChannelPersistence {
  let stored: ChannelJourneySnapshot | null = null;
  return {
    async saveJourney(snapshot) {
      stored = snapshot;
    },
    async loadChannelHub(principalId) {
      return stored?.channelSteward.principalId === principalId
        ? stored
        : null;
    },
  };
}
