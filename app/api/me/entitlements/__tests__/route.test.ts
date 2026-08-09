import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  cookieGet: vi.fn(),
  verifyAnonId: vi.fn(),
  fromAnon: vi.fn(),
  fromUsage: vi.fn(),
  fromHistory: vi.fn(),
  fromSub: vi.fn(),
  getServiceRoleClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/services/anon-cookie", () => ({
  ANON_COOKIE_NAME: "yt_anon_id",
  verifyAnonId: mocks.verifyAnonId,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => mocks.getServiceRoleClient(),
}));

function registeredRow(
  overrides: Partial<{
    tier: "free" | "pro";
    plan: "monthly" | "yearly" | null;
    status: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }> = {},
) {
  return {
    tier: "free" as const,
    plan: null,
    status: null,
    current_period_end: null,
    cancel_at_period_end: false,
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.resolveRequestPrincipal.mockResolvedValue({
    kind: "resolved",
    principal: {
      userId: "u1",
      isAnonymous: false,
      email: "user@example.com",
    },
  });
  mocks.fromAnon.mockResolvedValue({ data: null, error: null });
  mocks.fromUsage.mockResolvedValue({ data: null, error: null });
  mocks.fromHistory.mockResolvedValue({ count: 0, error: null });
  mocks.fromSub.mockResolvedValue({ data: null, error: null });
  mocks.getServiceRoleClient.mockReturnValue({
    from: (table: string) => {
      if (table === "anon_summary_quota") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mocks.fromAnon }) }),
        };
      }
      if (table === "monthly_summary_usage") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: mocks.fromUsage }),
            }),
          }),
        };
      }
      if (table === "user_video_history") {
        return { select: () => ({ eq: () => mocks.fromHistory() }) };
      }
      if (table === "user_subscriptions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mocks.fromSub }) }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  });
});

describe("GET /api/me/entitlements", () => {
  it("returns an explicit anonymous presentation when not signed in", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    mocks.cookieGet.mockReturnValue(undefined);

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body).toEqual({
      tier: "anon",
      caps: { summariesUsed: 0, summariesLimit: 1 },
      subscriptionPresentation: { state: "anonymous" },
    });
  });

  it("returns anonymous usage when the quota cookie verifies", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    mocks.cookieGet.mockReturnValue({ value: "signed.sig" });
    mocks.verifyAnonId.mockReturnValue("aaaa-bbbb");
    mocks.fromAnon.mockResolvedValue({ data: { count: 1 }, error: null });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.tier).toBe("anon");
    expect(body.caps).toEqual({ summariesUsed: 1, summariesLimit: 1 });
    expect(body.subscriptionPresentation).toEqual({ state: "anonymous" });
  });

  it.each(["active", "trialing"])(
    "normalizes %s Pro access without exposing its Stripe status",
    async (status) => {
      mocks.fromSub.mockResolvedValue({
        data: registeredRow({
          tier: "pro",
          plan: "yearly",
          status,
          current_period_end: "2027-04-01T00:00:00Z",
        }),
        error: null,
      });

      const { GET } = await import("../route");
      const body = await (await GET()).json();

      expect(body.tier).toBe("pro");
      expect(body.caps.summariesLimit).toBe(-1);
      expect(body.subscriptionPresentation).toEqual({
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-04-01T00:00:00Z",
      });
      expect(body.subscriptionPresentation).not.toHaveProperty("status");
    },
  );

  it("keeps cancellation-pending access Pro and exposes its access-end date", async () => {
    mocks.fromSub.mockResolvedValue({
      data: registeredRow({
        tier: "pro",
        plan: "monthly",
        status: "active",
        current_period_end: "2026-09-15T00:00:00Z",
        cancel_at_period_end: true,
      }),
      error: null,
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.tier).toBe("pro");
    expect(body.caps.summariesLimit).toBe(-1);
    expect(body.subscriptionPresentation).toEqual({
      state: "pro_pending_cancellation",
      plan: "monthly",
      accessEndsAt: "2026-09-15T00:00:00Z",
    });
  });

  it.each([
    ["past_due", "pro"],
    ["past_due", "free"],
    ["unpaid", "free"],
    ["incomplete", "free"],
    ["paused", "free"],
  ] as const)(
    "normalizes recoverable status %s with %s access as a billing issue",
    async (status, tier) => {
      mocks.fromSub.mockResolvedValue({
        data: registeredRow({
          tier,
          plan: "monthly",
          status,
          current_period_end: "2026-08-06T00:00:00Z",
        }),
        error: null,
      });

      const { GET } = await import("../route");
      const body = await (await GET()).json();

      expect(body.tier).toBe(tier);
      expect(body.caps.summariesLimit).toBe(tier === "pro" ? -1 : 10);
      expect(body.subscriptionPresentation).toEqual({
        state: "billing_issue",
        plan: "monthly",
      });
    },
  );

  it.each(["canceled", "incomplete_expired"])(
    "normalizes terminal status %s as the Free Plan",
    async (status) => {
      mocks.fromSub.mockResolvedValue({
        data: registeredRow({
          tier: "free",
          plan: "monthly",
          status,
          current_period_end: "2026-07-01T00:00:00Z",
        }),
        error: null,
      });

      const { GET } = await import("../route");
      const body = await (await GET()).json();

      expect(body.tier).toBe("free");
      expect(body.subscriptionPresentation).toEqual({ state: "free" });
    },
  );

  it("normalizes an expired active relationship as Free when its entitlement is Free", async () => {
    mocks.fromSub.mockResolvedValue({
      data: registeredRow({
        tier: "free",
        plan: "yearly",
        status: "active",
        current_period_end: "2026-01-01T00:00:00Z",
        cancel_at_period_end: true,
      }),
      error: null,
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.subscriptionPresentation).toEqual({ state: "free" });
  });

  it("keeps a Pro entitlement truthful when subscription metadata is missing", async () => {
    mocks.fromSub.mockResolvedValue({
      data: registeredRow({ tier: "pro" }),
      error: null,
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.subscriptionPresentation).toEqual({
      state: "active_pro",
      plan: null,
      renewsAt: null,
    });
  });

  it("normalizes a missing subscription row as Free and preserves Free quotas", async () => {
    mocks.fromUsage.mockResolvedValue({ data: { count: 4 }, error: null });
    mocks.fromHistory.mockResolvedValue({ count: 7, error: null });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body).toEqual({
      tier: "free",
      caps: {
        summariesUsed: 4,
        summariesLimit: 10,
        historyUsed: 7,
        historyLimit: 10,
      },
      subscriptionPresentation: { state: "free" },
    });
  });

  it("passes a trusted smoke entitlement through as active Pro", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "smoke-u1",
        isAnonymous: false,
        email: "smoke@example.test",
        smokeProEntitled: true,
      },
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.tier).toBe("pro");
    expect(body.subscriptionPresentation).toEqual({
      state: "active_pro",
      plan: null,
      renewsAt: null,
    });
  });

  it("returns 503 when auth infrastructure is unavailable", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });

    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect((await res.json()).message).toContain("unavailable");
  });

  it("returns 503 instead of an incorrect Free presentation when the service role is unavailable", async () => {
    mocks.getServiceRoleClient.mockReturnValue(null);

    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      message: "Subscription details temporarily unavailable.",
    });
  });

  it("keeps trusted smoke Pro explicit when optional metadata cannot load", async () => {
    mocks.getServiceRoleClient.mockReturnValue(null);
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "smoke-u1",
        isAnonymous: false,
        email: "smoke@example.test",
        smokeProEntitled: true,
      },
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.tier).toBe("pro");
    expect(body.subscription).toBeNull();
    expect(body.subscriptionPresentation).toEqual({
      state: "active_pro",
      plan: null,
      renewsAt: null,
    });
  });

  it("returns 503 instead of Free when the subscription query fails", async () => {
    mocks.fromSub.mockResolvedValue({
      data: null,
      error: { code: "08006", message: "connection failure" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      message: "Subscription details temporarily unavailable.",
    });
    expect(errSpy).toHaveBeenCalledWith(
      "[entitlements] subscription presentation read failed",
      expect.objectContaining({
        errorId: "SUBSCRIPTION_PRESENTATION_READ_FAILED",
        userId: "u1",
        code: "08006",
      }),
    );
  });

  it("keeps a known Free presentation when only usage lookup fails", async () => {
    mocks.fromUsage.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "table missing" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.caps.summariesUsed).toBe(0);
    expect(body.subscriptionPresentation).toEqual({ state: "free" });
    expect(errSpy).toHaveBeenCalledWith(
      "[me/entitlements] monthly_summary_usage read failed",
      expect.objectContaining({ errorId: "ENTITLEMENTS_USAGE_READ_FAILED" }),
    );
  });

  it("returns an anonymous presentation for a Supabase anonymous user", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "anon-supabase-1",
        isAnonymous: true,
        email: "",
      },
    });
    mocks.cookieGet.mockReturnValue({ value: "signed.sig" });
    mocks.verifyAnonId.mockReturnValue("aaaa-bbbb");
    mocks.fromAnon.mockResolvedValue({ data: { count: 1 }, error: null });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body).toEqual({
      tier: "anon",
      caps: { summariesUsed: 1, summariesLimit: 1 },
      subscriptionPresentation: { state: "anonymous" },
    });
  });

  it("does not read anonymous usage for a tampered cookie", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "anon-supabase-1",
        isAnonymous: true,
        email: "",
      },
    });
    mocks.cookieGet.mockReturnValue({ value: "tampered-cookie" });
    mocks.verifyAnonId.mockReturnValue(null);

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.caps.summariesUsed).toBe(0);
    expect(mocks.fromAnon).not.toHaveBeenCalled();
  });
});
