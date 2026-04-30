import { describe, it, expect, vi, beforeEach } from "vitest";

const loadFresh = async () => {
  vi.resetModules();
  return await import("../stripe");
};

describe("deriveTier", () => {
  it("active + future period_end → pro", async () => {
    const { deriveTier } = await loadFresh();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(deriveTier("active", future)).toBe("pro");
  });

  it("trialing + future period_end → pro", async () => {
    const { deriveTier } = await loadFresh();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(deriveTier("trialing", future)).toBe("pro");
  });

  it("active + past period_end → free", async () => {
    const { deriveTier } = await loadFresh();
    const past = new Date(Date.now() - 86400_000).toISOString();
    expect(deriveTier("active", past)).toBe("free");
  });

  it("past_due within 3 days → pro (grace)", async () => {
    const { deriveTier } = await loadFresh();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    expect(deriveTier("past_due", twoDaysAgo)).toBe("pro");
  });

  it("past_due over 3 days → free", async () => {
    const { deriveTier } = await loadFresh();
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400_000).toISOString();
    expect(deriveTier("past_due", fiveDaysAgo)).toBe("free");
  });

  it("canceled → free regardless of period_end", async () => {
    const { deriveTier } = await loadFresh();
    const future = new Date(Date.now() + 86400_000).toISOString();
    expect(deriveTier("canceled", future)).toBe("free");
  });

  it("unknown status → free", async () => {
    const { deriveTier } = await loadFresh();
    expect(deriveTier("incomplete_expired", null)).toBe("free");
  });

  it("null period_end → free", async () => {
    const { deriveTier } = await loadFresh();
    expect(deriveTier("active", null)).toBe("free");
  });
});

describe("priceIdForPlan", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_M");
    vi.stubEnv("STRIPE_PRICE_YEARLY", "price_Y");
  });
  it("returns correct price for plan", async () => {
    const { priceIdForPlan } = await loadFresh();
    expect(priceIdForPlan("monthly")).toBe("price_M");
    expect(priceIdForPlan("yearly")).toBe("price_Y");
  });
  it("returns null for unknown plan", async () => {
    const { priceIdForPlan } = await loadFresh();
    expect(priceIdForPlan("weekly" as never)).toBeNull();
  });
});
