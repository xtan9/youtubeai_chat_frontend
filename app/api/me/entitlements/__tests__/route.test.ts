import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RegisteredSubscriptionResolution } from "@/lib/services/entitlements";

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  resolveRegisteredSubscription: vi.fn(),
  cookieGet: vi.fn(),
  verifyAnonId: vi.fn(),
  fromAnon: vi.fn(),
  fromUsage: vi.fn(),
  fromHistory: vi.fn(),
  fromWorkspace: vi.fn(),
  fromProjects: vi.fn(),
  getServiceRoleClient: vi.fn(),
  getAnonymousTrialChatAllowance: vi.fn(),
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

vi.mock("@/lib/services/entitlements", () => ({
  ANON_LIMITS: { summariesLifetime: 1, projects: 0 },
  FREE_LIMITS: { summariesPerMonth: 10, historyItems: 10, projects: 1 },
  getYearMonthUtc: () => "2026-08",
  resolveRegisteredSubscription: mocks.resolveRegisteredSubscription,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => mocks.getServiceRoleClient(),
}));

vi.mock("@/lib/services/anonymous-trial", () => ({
  getAnonymousTrialChatAllowance: mocks.getAnonymousTrialChatAllowance,
}));

function resolved(
  value: Omit<
    Extract<RegisteredSubscriptionResolution, { kind: "resolved" }>,
    "kind" | "stripeSubscriptionId"
  >,
): RegisteredSubscriptionResolution {
  return { kind: "resolved", stripeSubscriptionId: null, ...value };
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
  mocks.resolveRegisteredSubscription.mockResolvedValue(
    resolved({
      tier: "free",
      subscription: null,
      presentation: { state: "free" },
    }),
  );
  mocks.fromAnon.mockResolvedValue({ data: null, error: null });
  mocks.fromUsage.mockResolvedValue({ data: null, error: null });
  mocks.fromHistory.mockResolvedValue({ count: 0, error: null });
  mocks.fromWorkspace.mockResolvedValue({
    data: { id: "workspace-1" },
    error: null,
  });
  mocks.fromProjects.mockResolvedValue({ count: 0, error: null });
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
      if (table === "workspaces") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.fromWorkspace }),
          }),
        };
      }
      if (table === "projects") {
        return { select: () => ({ eq: () => mocks.fromProjects() }) };
      }
      throw new Error(`unexpected from(${table})`);
    },
  });
  mocks.getAnonymousTrialChatAllowance.mockResolvedValue({
    outcome: "available",
    remainingMessages: 5,
  });
  vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/me/entitlements", () => {
  it("returns an explicit anonymous presentation when not signed in", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    mocks.cookieGet.mockReturnValue(undefined);

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body).toEqual({
      tier: "anon",
      caps: {
        summariesUsed: 0,
        summariesLimit: 1,
        projectsUsed: 0,
        projectsLimit: 0,
      },
      subscriptionPresentation: { state: "anonymous" },
    });
    expect(mocks.resolveRegisteredSubscription).not.toHaveBeenCalled();
  });

  it("returns anonymous usage when the quota cookie verifies", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
    mocks.cookieGet.mockReturnValue({ value: "signed.sig" });
    mocks.verifyAnonId.mockReturnValue("aaaa-bbbb");
    mocks.fromAnon.mockResolvedValue({ data: { count: 1 }, error: null });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.caps).toEqual({
      summariesUsed: 1,
      summariesLimit: 1,
      projectsUsed: 0,
      projectsLimit: 0,
    });
    expect(body.subscriptionPresentation).toEqual({ state: "anonymous" });
  });

  it("returns the normalized active Pro contract with unchanged Pro caps", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue(
      resolved({
        tier: "pro",
        subscription: {
          plan: "yearly",
          current_period_end: "2027-04-01T00:00:00Z",
          cancel_at_period_end: false,
        },
        presentation: {
          state: "active_pro",
          plan: "yearly",
          renewsAt: "2027-04-01T00:00:00Z",
        },
      }),
    );

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body).toEqual({
      tier: "pro",
      caps: {
        summariesUsed: 0,
        summariesLimit: -1,
        historyUsed: 0,
        historyLimit: -1,
        projectsUsed: 0,
        projectsLimit: -1,
      },
      subscription: {
        plan: "yearly",
        current_period_end: "2027-04-01T00:00:00Z",
        cancel_at_period_end: false,
      },
      subscriptionPresentation: {
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-04-01T00:00:00Z",
      },
    });
  });

  it("keeps cancellation-pending access Pro and exposes its access-end date", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue(
      resolved({
        tier: "pro",
        subscription: {
          plan: "monthly",
          current_period_end: "2026-09-15T00:00:00Z",
          cancel_at_period_end: true,
        },
        presentation: {
          state: "pro_pending_cancellation",
          plan: "monthly",
          accessEndsAt: "2026-09-15T00:00:00Z",
        },
      }),
    );

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

  it.each(["pro", "free"] as const)(
    "keeps a billing issue visible with %s access",
    async (tier) => {
      mocks.resolveRegisteredSubscription.mockResolvedValue(
        resolved({
          tier,
          subscription: {
            plan: "monthly",
            current_period_end: "2026-08-06T00:00:00Z",
            cancel_at_period_end: false,
          },
          presentation: { state: "billing_issue", plan: "monthly" },
        }),
      );

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

  it("returns the Free contract with unchanged usage quotas", async () => {
    mocks.fromUsage.mockResolvedValue({ data: { count: 4 }, error: null });
    mocks.fromHistory.mockResolvedValue({ count: 7, error: null });
    mocks.fromProjects.mockResolvedValue({ count: 1, error: null });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body).toEqual({
      tier: "free",
      caps: {
        summariesUsed: 4,
        summariesLimit: 10,
        historyUsed: 7,
        historyLimit: 10,
        projectsUsed: 1,
        projectsLimit: 1,
      },
      subscriptionPresentation: { state: "free" },
    });
  });

  it("returns truthful Pro presentation when optional metadata is missing", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue(
      resolved({
        tier: "pro",
        subscription: null,
        presentation: { state: "active_pro", plan: null, renewsAt: null },
      }),
    );

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.subscription).toBeNull();
    expect(body.subscriptionPresentation).toEqual({
      state: "active_pro",
      plan: null,
      renewsAt: null,
    });
  });

  it("passes trusted smoke entitlement context to the resolver", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "smoke-u1",
        isAnonymous: false,
        email: "smoke@example.test",
        smokeProEntitled: true,
      },
    });
    mocks.resolveRegisteredSubscription.mockResolvedValue(
      resolved({
        tier: "pro",
        subscription: null,
        presentation: { state: "active_pro", plan: null, renewsAt: null },
      }),
    );

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(mocks.resolveRegisteredSubscription).toHaveBeenCalledWith(
      "smoke-u1",
      true,
    );
    expect(body.subscriptionPresentation.state).toBe("active_pro");
  });

  it("returns 503 when auth infrastructure is unavailable", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect((await response.json()).message).toContain("unavailable");
  });

  it("returns 503 instead of an incorrect Free state when lookup fails", async () => {
    mocks.resolveRegisteredSubscription.mockResolvedValue({
      kind: "unavailable",
    });

    const { GET } = await import("../route");
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      message: "Subscription details temporarily unavailable.",
    });
  });

  it("keeps a known Free presentation when only usage lookup fails", async () => {
    mocks.fromUsage.mockResolvedValue({
      data: null,
      error: { code: "42P01", message: "table missing" },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.caps.summariesUsed).toBe(0);
    expect(body.subscriptionPresentation).toEqual({ state: "free" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[me/entitlements] monthly_summary_usage read failed",
      expect.objectContaining({ errorId: "ENTITLEMENTS_USAGE_READ_FAILED" }),
    );
  });

  it("fails soft to zero Project usage when Project infrastructure throws", async () => {
    mocks.fromWorkspace.mockRejectedValue(new Error("network down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("../route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.caps).toMatchObject({ projectsUsed: 0, projectsLimit: 1 });
    expect(errorSpy).toHaveBeenCalledWith(
      "[me/entitlements] Project usage read threw",
      expect.objectContaining({
        errorId: "ENTITLEMENTS_PROJECT_USAGE_READ_THREW",
      }),
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
      caps: {
        summariesUsed: 1,
        summariesLimit: 1,
        projectsUsed: 0,
        projectsLimit: 0,
      },
      subscriptionPresentation: { state: "anonymous" },
    });
    expect(mocks.resolveRegisteredSubscription).not.toHaveBeenCalled();
  });

  it("returns the authoritative Anonymous Trial allowance for an enabled Supabase anonymous user", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "anon-supabase-1",
        isAnonymous: true,
        email: "",
      },
    });
    mocks.getAnonymousTrialChatAllowance.mockResolvedValue({
      outcome: "available",
      remainingMessages: 3,
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(mocks.getAnonymousTrialChatAllowance).toHaveBeenCalledWith({
      userId: "anon-supabase-1",
    });
    expect(body.anonymousTrial).toEqual({
      state: "available",
      remainingMessages: 3,
    });
  });

  it("fails closed when the enabled Anonymous Trial allowance is unavailable", async () => {
    vi.stubEnv("ANONYMOUS_TRIAL_ENABLED", "true");
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "anon-supabase-1",
        isAnonymous: true,
        email: "",
      },
    });
    mocks.getAnonymousTrialChatAllowance.mockResolvedValue({
      outcome: "unavailable",
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.anonymousTrial).toEqual({ state: "unavailable" });
  });

  it("does not read the Anonymous Trial allowance while the switch is disabled", async () => {
    mocks.resolveRequestPrincipal.mockResolvedValue({
      kind: "resolved",
      principal: {
        userId: "anon-supabase-1",
        isAnonymous: true,
        email: "",
      },
    });

    const { GET } = await import("../route");
    const body = await (await GET()).json();

    expect(body.anonymousTrial).toBeUndefined();
    expect(mocks.getAnonymousTrialChatAllowance).not.toHaveBeenCalled();
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
