import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkCheckoutStatusRateLimit: vi.fn(),
  getStripe: vi.fn(),
  resolveRegisteredSubscription: vi.fn(),
  resolveRequestPrincipal: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/services/checkout-status-rate-limit", () => ({
  checkCheckoutStatusRateLimit: mocks.checkCheckoutStatusRateLimit,
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/services/entitlements", () => ({
  resolveRegisteredSubscription: mocks.resolveRegisteredSubscription,
}));

vi.mock("@/lib/services/stripe", () => ({
  getStripe: mocks.getStripe,
}));

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveRequestPrincipal.mockResolvedValue({
    kind: "resolved",
    principal: {
      email: "learner@example.com",
      isAnonymous: false,
      userId: "user-1",
    },
  });
  mocks.getStripe.mockReturnValue({
    checkout: {
      sessions: { retrieve: mocks.retrieveCheckoutSession },
    },
  });
  mocks.retrieveCheckoutSession.mockResolvedValue({
    client_reference_id: "user-1",
    id: "cs_test_return",
    metadata: { user_id: "user-1" },
    mode: "subscription",
    status: "complete",
    subscription: "sub_return",
  });
  mocks.checkCheckoutStatusRateLimit.mockResolvedValue({
    allowed: true,
    reason: "within_limit",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/billing/checkout/status", () => {
  it("reports activation pending until the webhook-backed Subscription is active", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      presentation: { state: "free" },
      stripeSubscriptionId: null,
      subscription: null,
      tier: "free",
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending" });
    expect(mocks.retrieveCheckoutSession).toHaveBeenCalledWith(
      "cs_test_return",
    );
    expect(mocks.resolveRegisteredSubscription).toHaveBeenCalledWith(
      "user-1",
      false,
    );
  });

  it("reports the truthful active Pro presentation after webhook confirmation", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      presentation: {
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-08-09T00:00:00.000Z",
      },
      stripeSubscriptionId: "sub_return",
      subscription: {
        cancel_at_period_end: false,
        current_period_end: "2027-08-09T00:00:00.000Z",
        plan: "yearly",
      },
      tier: "pro",
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "active",
      subscriptionPresentation: {
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-08-09T00:00:00.000Z",
      },
    });
  });

  it("waits when the active row belongs to an older Subscription", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      presentation: {
        state: "active_pro",
        plan: "monthly",
        renewsAt: "2026-09-09T00:00:00.000Z",
      },
      stripeSubscriptionId: "sub_older",
      subscription: {
        cancel_at_period_end: false,
        current_period_end: "2026-09-09T00:00:00.000Z",
        plan: "monthly",
      },
      tier: "pro",
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "pending" });
  });

  it("does not expose or confirm another Learner's Checkout Session", async () => {
    mocks.retrieveCheckoutSession.mockResolvedValue({
      client_reference_id: "user-2",
      id: "cs_test_other",
      metadata: { user_id: "user-2" },
      mode: "subscription",
      status: "complete",
      subscription: "sub_other",
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_other",
      ),
    );

    expect(response.status).toBe(404);
    expect(mocks.resolveRegisteredSubscription).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before authentication or Stripe access", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=not-a-session",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("rejects ambiguous identifiers before authentication or Stripe access", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_one&session_id=cs_test_two",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("rejects missing session IDs before authentication or Stripe access", async () => {
    const { GET } = await import("../route");
    const response = await GET(
      new Request("https://test.example/api/billing/checkout/status"),
    );

    expect(response.status).toBe(400);
    expect(mocks.resolveRequestPrincipal).not.toHaveBeenCalled();
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("rejects anonymous Learners without reading Stripe", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        email: null,
        isAnonymous: true,
        userId: "anon-1",
      },
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(response.status).toBe(401);
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("throttles repeated status reads before accessing Stripe", async () => {
    mocks.checkCheckoutStatusRateLimit.mockResolvedValue({
      allowed: false,
      reason: "exceeded",
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(mocks.checkCheckoutStatusRateLimit).toHaveBeenCalledWith("user-1");
    expect(mocks.getStripe).not.toHaveBeenCalled();
  });

  it("returns a recoverable service response when Stripe lookup fails", async () => {
    mocks.retrieveCheckoutSession.mockRejectedValue(new Error("stripe down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "Service unavailable" });
    expect(mocks.resolveRegisteredSubscription).not.toHaveBeenCalled();
  });

  it("is read-only and safe to repeat for refresh or revisit", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      presentation: { state: "free" },
      stripeSubscriptionId: null,
      subscription: null,
      tier: "free",
    });

    const { GET } = await import("../route");
    const requestUrl =
      "https://test.example/api/billing/checkout/status?session_id=cs_test_return";
    const first = await GET(new Request(requestUrl));
    const second = await GET(new Request(requestUrl));

    expect(await first.json()).toEqual({ status: "pending" });
    expect(await second.json()).toEqual({ status: "pending" });
    expect(mocks.retrieveCheckoutSession).toHaveBeenCalledTimes(2);
    expect(mocks.resolveRegisteredSubscription).toHaveBeenCalledTimes(2);
  });

  it("waits for webhook state instead of treating a smoke override as purchase confirmation", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        email: "smoke@example.com",
        isAnonymous: false,
        smokeProEntitled: true,
        userId: "user-1",
      },
    });
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "resolved",
      presentation: { state: "free" },
      stripeSubscriptionId: null,
      subscription: null,
      tier: "free",
    });

    const { GET } = await import("../route");
    const response = await GET(
      new Request(
        "https://test.example/api/billing/checkout/status?session_id=cs_test_return",
      ),
    );

    expect(await response.json()).toEqual({ status: "pending" });
    expect(mocks.resolveRegisteredSubscription).toHaveBeenCalledWith(
      "user-1",
      false,
    );
  });
});
