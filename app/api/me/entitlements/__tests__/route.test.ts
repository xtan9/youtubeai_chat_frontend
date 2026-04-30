import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserTier: vi.fn(),
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

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock("@/lib/services/anon-cookie", () => ({
  ANON_COOKIE_NAME: "yt_anon_id",
  verifyAnonId: mocks.verifyAnonId,
}));

vi.mock("@/lib/services/entitlements", () => ({
  ANON_LIMITS: { summariesLifetime: 1 },
  FREE_LIMITS: { summariesPerMonth: 10, chatMessagesPerVideo: 5, historyItems: 10 },
  getUserTier: mocks.getUserTier,
  getYearMonthUtc: () => "2026-04",
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => mocks.getServiceRoleClient(),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  // Default: service-role client present and chains return null/zero
  mocks.getServiceRoleClient.mockReturnValue({
    from: (table: string) => {
      if (table === "anon_summary_quota") {
        return { select: () => ({ eq: () => ({ maybeSingle: mocks.fromAnon }) }) };
      }
      if (table === "monthly_summary_usage") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.fromUsage }) }) }) };
      }
      if (table === "user_video_history") {
        return { select: () => ({ eq: () => mocks.fromHistory() }) };
      }
      if (table === "user_subscriptions") {
        return { select: () => ({ eq: () => ({ maybeSingle: mocks.fromSub }) }) };
      }
      throw new Error(`unexpected from(${table})`);
    },
  });
});

describe("GET /api/me/entitlements", () => {
  it("returns anon tier with count=0 when not signed in and no cookie", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.cookieGet.mockReturnValue(undefined);
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      tier: "anon",
      caps: { summariesUsed: 0, summariesLimit: 1 },
    });
  });

  it("returns anon tier with current count when cookie verifies", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.cookieGet.mockReturnValue({ value: "signed.sig" });
    mocks.verifyAnonId.mockReturnValue("aaaa-bbbb");
    mocks.fromAnon.mockResolvedValue({ data: { count: 1 }, error: null });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.tier).toBe("anon");
    expect(body.caps.summariesUsed).toBe(1);
    expect(body.caps.summariesLimit).toBe(1);
  });

  it("returns pro tier with subscription details", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } }, error: null,
    });
    mocks.getUserTier.mockResolvedValue("pro");
    mocks.fromSub.mockResolvedValue({
      data: { plan: "yearly", current_period_end: "2027-04-01T00:00:00Z", cancel_at_period_end: false },
      error: null,
    });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.tier).toBe("pro");
    expect(body.caps.summariesLimit).toBe(-1);
    expect(body.subscription).toEqual({
      plan: "yearly",
      current_period_end: "2027-04-01T00:00:00Z",
      cancel_at_period_end: false,
    });
  });

  it("returns free tier with current monthly + history counts", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } }, error: null,
    });
    mocks.getUserTier.mockResolvedValue("free");
    mocks.fromUsage.mockResolvedValue({ data: { count: 4 }, error: null });
    mocks.fromHistory.mockResolvedValue({ count: 7, error: null });
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({
      tier: "free",
      caps: {
        summariesUsed: 4, summariesLimit: 10,
        historyUsed: 7, historyLimit: 10,
      },
    });
  });

  it("returns free tier with zeros when service-role unavailable", async () => {
    mocks.getServiceRoleClient.mockReturnValue(null);
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: false } }, error: null,
    });
    mocks.getUserTier.mockResolvedValue("free");
    const { GET } = await import("../route");
    const res = await GET();
    const body = await res.json();
    expect(body.tier).toBe("free");
    expect(body.caps.summariesUsed).toBe(0);
    expect(body.caps.historyUsed).toBe(0);
  });
});
