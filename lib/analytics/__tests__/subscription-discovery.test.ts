import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY,
  SUBSCRIPTION_DISCOVERY_SOURCE_SURFACES,
  CompatibleSubscriptionDiscoveryEventSchema,
  SubscriptionDiscoveryEventSchema,
  createSubscriptionDiscoveryEvent,
  emitSubscriptionDiscoveryEvent,
  type SubscriptionDiscoveryEventName,
} from "../subscription-discovery";

const attribution = {
  source_surface: "global_header",
  presentation_state: "upgrade_to_pro",
  authentication_state: "registered",
  device_class: "desktop",
} as const;

describe("Subscription discovery analytics contract", () => {
  it("represents every discovery funnel interaction with shared attribution", () => {
    const events = [
      createSubscriptionDiscoveryEvent(
        "subscription_discovery_viewed",
        attribution,
      ),
      createSubscriptionDiscoveryEvent(
        "subscription_discovery_clicked",
        attribution,
      ),
      createSubscriptionDiscoveryEvent("pricing_viewed", attribution),
      createSubscriptionDiscoveryEvent("plan_choice_attempted", {
        ...attribution,
        plan: "yearly",
        billing_interval: "yearly",
      }),
      createSubscriptionDiscoveryEvent("checkout_started", {
        ...attribution,
        account_type: "free",
        plan: "yearly",
        billing_interval: "yearly",
      }),
      createSubscriptionDiscoveryEvent("checkout_failed", {
        ...attribution,
        account_type: "free",
        plan: "yearly",
        billing_interval: "yearly",
        failure_category: "service_unavailable",
      }),
      createSubscriptionDiscoveryEvent("subscription_activated", {
        ...attribution,
        plan: "yearly",
        billing_interval: "yearly",
        subscription_status: "active",
      }),
    ];

    expect(
      events.map(
        (event) =>
          SubscriptionDiscoveryEventSchema.safeParse(event).success,
      ),
    ).toEqual([true, true, true, true, true, true, true]);
  });

  it("governs every approved source surface", () => {
    expect(SUBSCRIPTION_DISCOVERY_SOURCE_SURFACES).toEqual([
      "global_header",
      "public_footer",
      "plan_and_billing",
      "account",
      "summary_limit",
      "video_chat_limit",
      "history_limit",
      "direct_pricing",
    ]);
  });

  it("uses one responsive boundary for mobile versus desktop attribution", () => {
    expect(SUBSCRIPTION_DISCOVERY_MOBILE_MEDIA_QUERY).toBe(
      "(max-width: 767px)",
    );
  });

  it("exposes a closed event-name type", () => {
    expectTypeOf<SubscriptionDiscoveryEventName>().toEqualTypeOf<
      | "subscription_discovery_viewed"
      | "subscription_discovery_clicked"
      | "pricing_viewed"
      | "plan_choice_attempted"
      | "checkout_started"
      | "checkout_failed"
      | "subscription_activated"
    >();
  });

  it.each([
    ["source_surface", "sidebar"],
    ["presentation_state", "enterprise_plan"],
    ["authentication_state", "someone@example.com"],
    ["device_class", "smart_tv"],
  ] as const)("rejects an invalid %s", (field, value) => {
    const parsed = SubscriptionDiscoveryEventSchema.safeParse({
      event: "subscription_discovery_clicked",
      properties: { ...attribution, [field]: value },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unknown event names", () => {
    expect(
      SubscriptionDiscoveryEventSchema.safeParse({
        event: "upgrade_clicked",
        properties: attribution,
      }).success,
    ).toBe(false);
  });

  it("delivers interaction payloads to a public sink without a transport", () => {
    const sink = vi.fn();

    emitSubscriptionDiscoveryEvent(
      sink,
      "subscription_discovery_clicked",
      attribution,
    );

    expect(sink).toHaveBeenCalledWith({
      event: "subscription_discovery_clicked",
      properties: attribution,
    });
  });

  it("rejects personal or ungoverned fields", () => {
    expect(
      SubscriptionDiscoveryEventSchema.safeParse({
        event: "pricing_viewed",
        properties: {
          ...attribution,
          email: "learner@example.com",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a plan whose billing interval does not match", () => {
    expect(
      SubscriptionDiscoveryEventSchema.safeParse({
        event: "plan_choice_attempted",
        properties: {
          ...attribution,
          plan: "monthly",
          billing_interval: "yearly",
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    {
      event: "checkout_started",
      properties: {
        account_type: "free",
        source_surface: "pricing",
        plan: "monthly",
        billing_interval: "monthly",
      },
    },
    {
      event: "subscription_activated",
      properties: {
        source_surface: "stripe_webhook",
        plan: "unknown",
        billing_interval: "unknown",
        subscription_status: "trialing",
      },
    },
  ])("keeps the legacy $event payload compatible", (event) => {
    expect(
      CompatibleSubscriptionDiscoveryEventSchema.safeParse(event).success,
    ).toBe(true);
  });

  it("keeps mismatched legacy billing fields compatible", () => {
    expect(
      CompatibleSubscriptionDiscoveryEventSchema.safeParse({
        event: "checkout_started",
        properties: {
          account_type: "free",
          source_surface: "pricing",
          plan: "monthly",
          billing_interval: "yearly",
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    ["logged_out", "pricing"],
    ["anonymous_session", "pricing"],
    ["registered", "upgrade_to_pro"],
    ["registered", "pro_plan"],
    ["registered", "billing_issue"],
  ] as const)(
    "segments %s learners in the %s presentation state",
    (authenticationState, presentationState) => {
      expect(
        SubscriptionDiscoveryEventSchema.safeParse({
          event: "subscription_discovery_viewed",
          properties: {
            ...attribution,
            authentication_state: authenticationState,
            presentation_state: presentationState,
          },
        }).success,
      ).toBe(true);
    },
  );
});
