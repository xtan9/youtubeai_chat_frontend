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
