import { describe, expect, it, vi } from "vitest";

import {
  runChannelJourney,
  type ChannelActivityProvider,
} from "../journey";
import {
  createInMemoryChannelPersistence,
  createSyntheticChannelActivityProvider,
  createSyntheticChannelAssessmentProvider,
  SYNTHETIC_CHANNEL,
  SYNTHETIC_INTERACTION,
  SYNTHETIC_PRINCIPAL,
} from "../testing/synthetic-channel-fixtures";

const FIXED_NOW = new Date("2026-08-31T12:00:00.000Z");

function journeyInput(overrides: Partial<Parameters<typeof runChannelJourney>[0]> = {}) {
  return {
    principal: SYNTHETIC_PRINCIPAL,
    adultAttested: true,
    connectedChannel: SYNTHETIC_CHANNEL,
    activityProvider: createSyntheticChannelActivityProvider(),
    assessmentProvider: createSyntheticChannelAssessmentProvider(),
    persistence: createInMemoryChannelPersistence(),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

describe("Channel synthetic journey contract", () => {
  it("traces an authenticated Channel Steward through persistence to Channel Hub", async () => {
    const input = journeyInput();

    const result = await runChannelJourney(input);

    expect(result).toMatchObject({ status: "ready" });
    if (result.status !== "ready") throw new Error("expected a ready journey");

    const { snapshot, presentation } = result.journey;
    expect(snapshot.channel).toMatchObject({
      governance: { source: "synthetic", corpusVersion: "channel-tracer-v1" },
      activeConnectedChannelId: snapshot.connectedYouTubeChannel.id,
    });
    expect(snapshot.channelSteward).toMatchObject({
      principalId: SYNTHETIC_PRINCIPAL.userId,
      adultAttested: true,
    });
    expect(snapshot.connectedYouTubeChannel).toMatchObject({
      identity: { kind: "synthetic" },
      displayName: "Synthetic Steward Channel",
    });
    expect(snapshot.scanRun).toMatchObject({
      mode: "deliberate",
      status: "completed",
      coverage: {
        window: "recent_seven_days",
        interactionsDiscovered: 1,
        assessmentsCreated: 1,
        reviewItemsCreated: 1,
      },
    });
    expect(snapshot.interactionAssessments).toHaveLength(1);
    expect(snapshot.interactionAssessments[0]).toMatchObject({
      interactionId: SYNTHETIC_INTERACTION.id,
      classification: "Actionable Abuse",
      target: "channel_steward",
      replyDraft: null,
    });
    expect(snapshot.reviewQueue.items).toHaveLength(1);
    expect(snapshot.reviewQueue.items[0]).toMatchObject({
      interactionAssessment: {
        label: "Interaction Assessment",
        classification: "Actionable Abuse",
      },
      status: "awaiting_review",
    });

    expect(presentation).toMatchObject({
      kind: "channel_hub",
      surface: "Channel Hub",
      channel: { label: "Channel" },
      channelSteward: { label: "Channel Steward" },
      connectedYouTubeChannel: { label: "Connected YouTube Channel" },
      scanRun: { label: "Scan Run", mode: "deliberate" },
      reviewQueue: {
        label: "Review Queue",
        items: [
          {
            interactionAssessment: {
              label: "Interaction Assessment",
              classification: "Actionable Abuse",
            },
          },
        ],
      },
    });

    const persisted = await input.persistence.loadChannelHub(
      SYNTHETIC_PRINCIPAL.userId,
    );
    expect(persisted).toEqual(snapshot);
  });

  it("keeps the activity provider replaceable at a normalized domain seam", async () => {
    const scan = vi.fn().mockResolvedValue([
      { ...SYNTHETIC_INTERACTION, id: "replacement-interaction" },
    ]);
    const activityProvider: ChannelActivityProvider = {
      kind: "synthetic",
      scan,
    };

    const result = await runChannelJourney(journeyInput({ activityProvider }));

    expect(result.status).toBe("ready");
    expect(scan).toHaveBeenCalledWith({
      connectedChannelId: expect.any(String),
      channelKey: "synthetic-channel-468",
      mode: "deliberate",
      window: "recent_seven_days",
      stewardPrincipalId: SYNTHETIC_PRINCIPAL.userId,
    });
    if (result.status !== "ready") throw new Error("expected a ready journey");
    expect(result.journey.snapshot.interactionAssessments[0]?.interactionId).toBe(
      "replacement-interaction",
    );
  });

  it("does not admit a non-synthetic provider into the offline tracer", async () => {
    const scan = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        activityProvider: { kind: "separately_governed", scan },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "provider",
      reason: "non_synthetic_provider",
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("fails closed when a provider returns an invalid normalized interaction", async () => {
    const scan = vi.fn().mockResolvedValue([
      { ...SYNTHETIC_INTERACTION, text: "" },
    ]);
    const saveJourney = vi.fn();
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        activityProvider: { kind: "synthetic", scan },
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "provider",
      reason: "invalid_response",
    });
    expect(saveJourney).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when assessment output is incoherent", async () => {
    const assess = vi.fn().mockResolvedValue({
      classification: "Reviewable Interaction",
      target: "channel_steward",
      severity: "severe",
    });
    const saveJourney = vi.fn();
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        assessmentProvider: { kind: "synthetic", assess },
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "provider",
      reason: "invalid_response",
    });
    expect(saveJourney).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when a scan repeats an interaction identity", async () => {
    const scan = vi.fn().mockResolvedValue([
      SYNTHETIC_INTERACTION,
      SYNTHETIC_INTERACTION,
    ]);
    const saveJourney = vi.fn();
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        activityProvider: { kind: "synthetic", scan },
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "provider",
      reason: "invalid_response",
    });
    expect(saveJourney).not.toHaveBeenCalled();
  });

  it("fails closed at the identity seam before provider or persistence work", async () => {
    const scan = vi.fn();
    const assess = vi.fn();
    const saveJourney = vi.fn();
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        principal: { userId: "", isAnonymous: true },
        activityProvider: { kind: "synthetic", scan },
        assessmentProvider: { kind: "synthetic", assess },
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "identity",
      reason: "principal_unavailable",
    });
    expect(scan).not.toHaveBeenCalled();
    expect(assess).not.toHaveBeenCalled();
    expect(saveJourney).not.toHaveBeenCalled();
    expect(loadChannelHub).not.toHaveBeenCalled();
  });

  it("fails closed on an activity provider failure without persisting a partial journey", async () => {
    const scan = vi.fn().mockRejectedValue(new Error("provider detail"));
    const saveJourney = vi.fn();
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        activityProvider: { kind: "synthetic", scan },
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "provider",
      reason: "activity_unavailable",
    });
    expect(saveJourney).not.toHaveBeenCalled();
    expect(loadChannelHub).not.toHaveBeenCalled();
  });

  it("fails closed on an assessment provider failure without persisting a partial journey", async () => {
    const assess = vi.fn().mockRejectedValue(new Error("assessment detail"));
    const saveJourney = vi.fn();
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        assessmentProvider: { kind: "synthetic", assess },
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "provider",
      reason: "assessment_unavailable",
    });
    expect(saveJourney).not.toHaveBeenCalled();
    expect(loadChannelHub).not.toHaveBeenCalled();
  });

  it("fails closed when persistence cannot save the completed Scan Run", async () => {
    const saveJourney = vi.fn().mockRejectedValue(new Error("database detail"));
    const loadChannelHub = vi.fn();

    const result = await runChannelJourney(
      journeyInput({
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "persistence",
      reason: "save_failed",
    });
    expect(loadChannelHub).not.toHaveBeenCalled();
  });

  it("fails closed when persistence returns no Channel Hub for the authenticated principal", async () => {
    const saveJourney = vi.fn().mockResolvedValue(undefined);
    const loadChannelHub = vi.fn().mockResolvedValue(null);

    const result = await runChannelJourney(
      journeyInput({
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "persistence",
      reason: "hub_not_found",
    });
  });

  it("fails closed when persistence cannot load the Channel Hub", async () => {
    const saveJourney = vi.fn().mockResolvedValue(undefined);
    const loadChannelHub = vi.fn().mockRejectedValue(new Error("database detail"));

    const result = await runChannelJourney(
      journeyInput({
        persistence: { saveJourney, loadChannelHub },
      }),
    );

    expect(result).toEqual({
      status: "blocked",
      seam: "persistence",
      reason: "load_failed",
    });
  });
});
