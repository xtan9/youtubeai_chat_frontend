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
    });
    expect(m.ANON_LIMITS).toEqual({ summariesLifetime: 1 });
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
