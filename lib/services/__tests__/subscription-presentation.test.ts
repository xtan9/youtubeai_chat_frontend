import { describe, expect, it } from "vitest";
import { normalizeSubscriptionPresentation } from "../subscription-presentation";

function snapshot(
  overrides: Partial<Parameters<typeof normalizeSubscriptionPresentation>[0]> = {},
): Parameters<typeof normalizeSubscriptionPresentation>[0] {
  return {
    tier: "free",
    plan: null,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe("normalizeSubscriptionPresentation", () => {
  it.each(["active", "trialing"])(
    "normalizes %s Pro access without exposing raw Stripe state",
    (status) => {
      const presentation = normalizeSubscriptionPresentation(
        snapshot({
          tier: "pro",
          plan: "yearly",
          status,
          currentPeriodEnd: "2027-04-01T00:00:00Z",
        }),
      );

      expect(presentation).toEqual({
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-04-01T00:00:00Z",
      });
      expect(presentation).not.toHaveProperty("status");
    },
  );

  it("keeps cancellation-pending access Pro through the paid period", () => {
    expect(
      normalizeSubscriptionPresentation(
        snapshot({
          tier: "pro",
          plan: "monthly",
          status: "active",
          currentPeriodEnd: "2026-09-15T00:00:00Z",
          cancelAtPeriodEnd: true,
        }),
      ),
    ).toEqual({
      state: "pro_pending_cancellation",
      plan: "monthly",
      accessEndsAt: "2026-09-15T00:00:00Z",
    });
  });

  it.each(["past_due", "unpaid", "incomplete", "paused"])(
    "normalizes recoverable %s relationships as billing issues",
    (status) => {
      expect(
        normalizeSubscriptionPresentation(
          snapshot({ tier: "free", plan: "monthly", status }),
        ),
      ).toEqual({ state: "billing_issue", plan: "monthly" });
    },
  );

  it("keeps a billing issue visible while past-due grace still grants Pro", () => {
    expect(
      normalizeSubscriptionPresentation(
        snapshot({ tier: "pro", plan: "yearly", status: "past_due" }),
      ),
    ).toEqual({ state: "billing_issue", plan: "yearly" });
  });

  it.each(["canceled", "incomplete_expired"])(
    "normalizes terminal %s relationships with expired access as Free",
    (status) => {
      expect(
        normalizeSubscriptionPresentation(
          snapshot({
            tier: "free",
            plan: "monthly",
            status,
            currentPeriodEnd: "2026-07-01T00:00:00Z",
          }),
        ),
      ).toEqual({ state: "free" });
    },
  );

  it("uses the entitlement tier when relationship metadata is missing", () => {
    expect(
      normalizeSubscriptionPresentation(snapshot({ tier: "pro" })),
    ).toEqual({ state: "active_pro", plan: null, renewsAt: null });
  });

  it("normalizes a missing relationship as Free", () => {
    expect(normalizeSubscriptionPresentation(snapshot())).toEqual({
      state: "free",
    });
  });
});
