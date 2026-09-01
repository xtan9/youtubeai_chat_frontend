import { describe, expect, it } from "vitest";

import { buildChannelCapabilityPresentation } from "../presentation";

const PRINCIPAL = { userId: "researcher-1", isAnonymous: false } as const;

describe("buildChannelCapabilityPresentation", () => {
  it("lets a registered Free Researcher understand Channel and upgrade without an action route", () => {
    expect(
      buildChannelCapabilityPresentation({
        principal: PRINCIPAL,
        entitlement: { state: "free", verified: true },
      }),
    ).toEqual({
      surface: "Channel",
      hub: "Channel Hub",
      description:
        "Review interactions for your connected YouTube Channel and keep every reply under your control.",
      state: "upgrade_required",
      capabilities: {
        canBeginConnection: false,
        canScan: false,
        canReview: false,
        canDraft: false,
        canPublish: false,
      },
      primaryAction: {
        kind: "upgrade",
        label: "Upgrade to Pro",
        href: "/pricing?source_surface=channel",
      },
    });
  });

  it("shows the Pro setup entry while leaving all work actions gated until onboarding completes", () => {
    const presentation = buildChannelCapabilityPresentation({
      principal: PRINCIPAL,
      entitlement: { state: "active_pro", verified: true },
    });

    expect(presentation).toMatchObject({
      surface: "Channel",
      hub: "Channel Hub",
      state: "ready_to_connect",
      capabilities: {
        canBeginConnection: true,
        canScan: false,
        canReview: false,
        canDraft: false,
        canPublish: false,
      },
      primaryAction: {
        kind: "begin_connection",
        label: "Connect a YouTube Channel",
      },
    });
  });

  it("does not guess Free or Pro when identity or entitlement lookup is unavailable", () => {
    expect(
      buildChannelCapabilityPresentation({
        principal: null,
        entitlement: { state: "active_pro", verified: true },
      }),
    ).toMatchObject({ state: "unavailable", primaryAction: null });
    expect(
      buildChannelCapabilityPresentation({
        principal: PRINCIPAL,
        entitlement: { state: "unavailable", verified: false },
      }),
    ).toMatchObject({ state: "unavailable", primaryAction: null });
  });
});
