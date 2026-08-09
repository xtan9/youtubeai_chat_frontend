import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createClient: vi.fn(() => ({ rpc: mocks.rpc, from: mocks.from })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

async function loadFreshModule() {
  vi.resetModules();
  return await import("../entitlements");
}

describe("FREE_LIMITS / ANON_LIMITS", () => {
  it("exports the spec values", async () => {
    const m = await loadFreshModule();
    expect(m.FREE_LIMITS).toEqual({
      summariesPerMonth: 10,
      chatMessagesPerVideo: 5,
      historyItems: 10,
      projects: 1,
    });
    expect(m.ANON_LIMITS).toEqual({ summariesLifetime: 1, projects: 0 });
  });
});

describe("getYearMonthUtc", () => {
  it("formats UTC year-month", async () => {
    const { getYearMonthUtc } = await loadFreshModule();
    expect(getYearMonthUtc(new Date("2026-04-29T23:59:00Z"))).toBe("2026-04");
    expect(getYearMonthUtc(new Date("2026-04-30T23:59:00Z"))).toBe("2026-04");
    expect(getYearMonthUtc(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05");
  });
});

describe("resolveRegisteredSubscription", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.createClient.mockClear();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function stubSubscriptionRow(
    row: unknown,
    error: { code?: string } | null = null,
  ) {
    mocks.from.mockImplementation((table: string) => {
      if (table !== "user_subscriptions") {
        throw new Error(`unexpected from(${table})`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: row, error }),
          }),
        }),
      };
    });
  }

  it("resolves access, metadata, and active presentation from one row", async () => {
    stubSubscriptionRow({
      tier: "pro",
      plan: "yearly",
      status: "trialing",
      current_period_end: "2027-04-01T00:00:00Z",
      cancel_at_period_end: false,
      stripe_subscription_id: "sub_trialing",
    });

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "resolved",
      tier: "pro",
      stripeSubscriptionId: "sub_trialing",
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
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("preserves a recoverable billing relationship after access becomes Free", async () => {
    stubSubscriptionRow({
      tier: "free",
      plan: "monthly",
      status: "past_due",
      current_period_end: "2026-08-01T00:00:00Z",
      cancel_at_period_end: false,
      stripe_subscription_id: "sub_past_due",
    });

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "resolved",
      tier: "free",
      stripeSubscriptionId: "sub_past_due",
      subscription: {
        plan: "monthly",
        current_period_end: "2026-08-01T00:00:00Z",
        cancel_at_period_end: false,
      },
      presentation: { state: "billing_issue", plan: "monthly" },
    });
  });

  it("normalizes missing and invalid optional metadata", async () => {
    stubSubscriptionRow({
      tier: "pro",
      plan: "legacy",
      status: null,
      current_period_end: null,
      cancel_at_period_end: null,
      stripe_subscription_id: null,
    });

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "resolved",
      tier: "pro",
      stripeSubscriptionId: null,
      subscription: {
        plan: null,
        current_period_end: null,
        cancel_at_period_end: false,
      },
      presentation: { state: "active_pro", plan: null, renewsAt: null },
    });
  });

  it("normalizes a missing Subscription row as Free", async () => {
    stubSubscriptionRow(null);

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "resolved",
      tier: "free",
      stripeSubscriptionId: null,
      subscription: null,
      presentation: { state: "free" },
    });
  });

  it("returns unavailable instead of guessing Free when the query fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubSubscriptionRow(null, { code: "08006" });

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[entitlements] subscription presentation read failed",
      expect.objectContaining({
        errorId: "SUBSCRIPTION_PRESENTATION_READ_FAILED",
        userId: "u1",
        code: "08006",
      }),
    );
  });

  it("returns unavailable when the Subscription query throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.from.mockImplementation(() => {
      throw new Error("connection lost");
    });

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "unavailable",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[entitlements] subscription presentation read threw",
      expect.objectContaining({
        errorId: "SUBSCRIPTION_PRESENTATION_READ_THREW",
        userId: "u1",
      }),
    );
  });

  it("keeps a trusted smoke entitlement Pro without service credentials", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("smoke-u1", true)).toEqual({
      kind: "resolved",
      tier: "pro",
      stripeSubscriptionId: null,
      subscription: null,
      presentation: { state: "active_pro", plan: null, renewsAt: null },
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("returns unavailable without service credentials for a normal user", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    const { resolveRegisteredSubscription } = await loadFreshModule();

    expect(await resolveRegisteredSubscription("u1")).toEqual({
      kind: "unavailable",
    });
  });
});

describe("getUserTier", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });
  afterEach(() => vi.restoreAllMocks());

  function stubRow(row: unknown, error: { code?: string } | null = null) {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error }),
        }),
      }),
    });
  }

  it("returns 'free' when no subscription row exists", async () => {
    stubRow(null);
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("u1")).toBe("free");
  });

  it("returns 'pro' when tier='pro' in row", async () => {
    stubRow({ tier: "pro" });
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("u1")).toBe("pro");
  });

  it("returns 'pro' for a trusted smoke entitlement without a subscription read", async () => {
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("smoke-u1", true)).toBe("pro");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns 'free' on infra error (fail-open to free)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubRow(null, { code: "PGRST301" });
    const { getUserTier } = await loadFreshModule();
    expect(await getUserTier("u1")).toBe("free");
  });
});

describe("checkSummaryEntitlement (signed-in users)", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  function stubTier(tier: "free" | "pro") {
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { tier }, error: null }),
        }),
      }),
    });
  }

  it("Pro: returns unlimited regardless of count", async () => {
    stubTier("pro");
    mocks.rpc.mockResolvedValue({ data: 9999, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r).toMatchObject({ tier: "pro", allowed: true, reason: "unlimited" });
  });

  it("Smoke Pro: returns unlimited without reading or incrementing quota", async () => {
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      userId: "smoke-u1",
      isAnon: false,
      smokeProEntitled: true,
    });
    expect(r).toMatchObject({ tier: "pro", allowed: true, reason: "unlimited" });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("Free under cap: allowed=true, remaining=limit-count", async () => {
    stubTier("free");
    mocks.rpc.mockResolvedValue({ data: 3, error: null });
    const { checkSummaryEntitlement, FREE_LIMITS } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r).toEqual({
      tier: "free",
      allowed: true,
      remaining: FREE_LIMITS.summariesPerMonth - 3,
      reason: "within_limit",
    });
  });

  it("Free at boundary (count===10): allowed", async () => {
    stubTier("free");
    mocks.rpc.mockResolvedValue({ data: 10, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("Free over cap (count===11): denied", async () => {
    stubTier("free");
    mocks.rpc.mockResolvedValue({ data: 11, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r).toEqual({
      tier: "free",
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
  });

  it("Free RPC error: fail-open with errorId", async () => {
    stubTier("free");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
    expect(err).toHaveBeenCalled();
  });

  it("Free RPC returns non-numeric data: fail-open", async () => {
    stubTier("free");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: "not-a-number", error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ userId: "u1", isAnon: false });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
  });
});

describe("checkSummaryEntitlement (anon)", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  it("first use: allowed, remaining=0 after this call", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    const { checkSummaryEntitlement, ANON_LIMITS } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      anonId: "11111111-1111-1111-1111-111111111111",
      isAnon: true,
    });
    expect(r).toEqual({
      tier: "anon",
      allowed: true,
      remaining: ANON_LIMITS.summariesLifetime - 1,
      reason: "within_limit",
    });
  });

  it("second use: denied", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      anonId: "11111111-1111-1111-1111-111111111111",
      isAnon: true,
    });
    expect(r).toEqual({
      tier: "anon",
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
  });

  it("RPC error: fail-open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const { checkSummaryEntitlement, ANON_LIMITS } = await loadFreshModule();
    const r = await checkSummaryEntitlement({
      anonId: "11111111-1111-1111-1111-111111111111",
      isAnon: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
    expect(r.remaining).toBe(ANON_LIMITS.summariesLifetime);
  });

  it("RPC returns non-numeric data: fail-open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: "not-a-number", error: null });
    const { checkSummaryEntitlement } = await loadFreshModule();
    const r = await checkSummaryEntitlement({ anonId: "11111111-1111-1111-1111-111111111111", isAnon: true });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
  });
});

describe("checkChatEntitlement", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://sb");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sr");
  });

  function stubChain(opts: {
    tier: "free" | "pro";
    chatCount?: number;
    chatError?: { code?: string } | null;
  }) {
    mocks.from.mockImplementation((table: string) => {
      if (table === "user_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { tier: opts.tier }, error: null }),
            }),
          }),
        };
      }
      if (table === "chat_messages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: async () => ({
                  count: opts.chatCount ?? 0,
                  error: opts.chatError ?? null,
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected from(${table})`);
    });
  }

  it("Pro: unlimited", async () => {
    stubChain({ tier: "pro", chatCount: 50 });
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r).toMatchObject({ tier: "pro", allowed: true, reason: "unlimited" });
  });

  it("Smoke Pro: unlimited without subscription or chat-count reads", async () => {
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("smoke-u1", "summary-1", true);
    expect(r).toMatchObject({ tier: "pro", allowed: true, reason: "unlimited" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("Free under cap: allowed", async () => {
    stubChain({ tier: "free", chatCount: 2 });
    const { checkChatEntitlement, FREE_LIMITS } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r).toEqual({
      tier: "free",
      allowed: true,
      remaining: FREE_LIMITS.chatMessagesPerVideo - 2,
      reason: "within_limit",
    });
  });

  it("Free at boundary (count===5): denied (this would be the 6th)", async () => {
    stubChain({ tier: "free", chatCount: 5 });
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r).toEqual({
      tier: "free",
      allowed: false,
      remaining: 0,
      reason: "exceeded",
    });
  });

  it("Free count error: fail-open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubChain({ tier: "free", chatError: { code: "42501" } });
    const { checkChatEntitlement } = await loadFreshModule();
    const r = await checkChatEntitlement("u1", "summary-1");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("fail_open");
  });
});
