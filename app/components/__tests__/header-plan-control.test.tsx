import { describe, expect, it } from "vitest";
import { resolveHeaderPlanControl } from "../header-plan-control";

describe("resolveHeaderPlanControl", () => {
  it.each([
    {
      identity: { state: "logged_out" } as const,
      expected: {
        label: "Pricing",
        href: "/pricing?source_surface=global_header",
        presentationState: "pricing",
        authenticationState: "logged_out",
        tone: "navigation",
      },
    },
    {
      identity: { state: "anonymous_session" } as const,
      expected: {
        label: "Pricing",
        href: "/pricing?source_surface=global_header",
        presentationState: "pricing",
        authenticationState: "anonymous_session",
        tone: "navigation",
      },
    },
    {
      identity: {
        state: "registered",
        subscriptionPresentation: { state: "free" },
      } as const,
      expected: {
        label: "Upgrade to Pro",
        href: "/pricing?source_surface=global_header",
        presentationState: "upgrade_to_pro",
        authenticationState: "registered",
        tone: "upgrade",
      },
    },
    {
      identity: {
        state: "registered",
        subscriptionPresentation: {
          state: "active_pro",
          plan: "monthly",
          renewsAt: "2026-09-01T00:00:00.000Z",
        },
      } as const,
      expected: {
        label: "Pro Plan",
        href: "/account/billing",
        presentationState: "pro_plan",
        authenticationState: "registered",
        tone: "status",
      },
    },
    {
      identity: {
        state: "registered",
        subscriptionPresentation: {
          state: "pro_pending_cancellation",
          plan: "yearly",
          accessEndsAt: "2027-01-01T00:00:00.000Z",
        },
      } as const,
      expected: {
        label: "Pro Plan",
        href: "/account/billing",
        presentationState: "pro_plan",
        authenticationState: "registered",
        tone: "status",
      },
    },
    {
      identity: {
        state: "registered",
        subscriptionPresentation: {
          state: "billing_issue",
          plan: "monthly",
        },
      } as const,
      expected: {
        label: "Billing issue",
        href: "/account/billing",
        presentationState: "billing_issue",
        authenticationState: "registered",
        tone: "attention",
      },
    },
    {
      identity: {
        state: "registered",
        subscriptionPresentation: { state: "lookup_failure" },
      } as const,
      expected: {
        label: "Plans",
        href: "/pricing?source_surface=global_header",
        presentationState: "plans",
        authenticationState: "registered",
        tone: "neutral",
      },
    },
  ])("maps $identity.state truthfully", ({ identity, expected }) => {
    expect(resolveHeaderPlanControl(identity)).toEqual({
      state: "resolved",
      analyticsEnabled: true,
      ...expected,
    });
  });

  it("reserves layout while auth is loading without exposing an action", () => {
    expect(resolveHeaderPlanControl({ state: "auth_loading" })).toEqual({
      state: "loading",
    });
  });

  it("reserves layout while registered Subscription state is loading", () => {
    expect(
      resolveHeaderPlanControl({
        state: "registered",
        subscriptionPresentation: { state: "loading" },
      }),
    ).toEqual({ state: "loading" });
  });

  it("shows neutral Plans without misclassifying an auth lookup failure", () => {
    expect(resolveHeaderPlanControl({ state: "auth_failure" })).toEqual({
      state: "resolved",
      label: "Plans",
      href: "/pricing?source_surface=global_header",
      presentationState: "plans",
      authenticationState: "logged_out",
      analyticsEnabled: false,
      tone: "neutral",
    });
  });
});
