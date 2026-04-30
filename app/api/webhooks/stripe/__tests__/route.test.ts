import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  insertEvent: vi.fn(),
  retrieveSub: vi.fn(),
  upsert: vi.fn(),
  fromUserSubsLookup: vi.fn(),
}));

vi.mock("@/lib/services/stripe", () => {
  const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
  return {
    getStripe: () => ({
      webhooks: { constructEvent: mocks.constructEvent },
      subscriptions: { retrieve: mocks.retrieveSub },
    }),
    deriveTier: (status: string | null | undefined, periodEndIso: string | null | undefined) => {
      if (!status || !periodEndIso) return "free";
      const end = Date.parse(periodEndIso);
      if (!Number.isFinite(end)) return "free";
      const now = Date.now();
      if (status === "active" || status === "trialing") return end > now ? "pro" : "free";
      if (status === "past_due") return end > now - PAST_DUE_GRACE_MS ? "pro" : "free";
      return "free";
    },
    periodEndToIso: (s: number | null | undefined) =>
      s ? new Date(s * 1000).toISOString() : null,
  };
});

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "stripe_webhook_events") {
        return {
          upsert: () => ({ select: mocks.insertEvent }),
        };
      }
      if (table === "user_subscriptions") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mocks.fromUserSubsLookup }) }),
          upsert: mocks.upsert,
        };
      }
      throw new Error(`unexpected from(${table})`);
    },
  }),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_M");
  vi.stubEnv("STRIPE_PRICE_YEARLY", "price_Y");
});

describe("Stripe webhook signature + idempotency", () => {
  it("400 when signature missing", async () => {
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("400 when constructEvent throws (bad signature)", async () => {
    mocks.constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=x" },
    }));
    expect(res.status).toBe(400);
  });

  it("200 + no-op when event already processed (idempotency)", async () => {
    mocks.constructEvent.mockReturnValue({ id: "evt_1", type: "customer.subscription.updated", data: { object: {} } });
    // Conflict: returning empty data signals duplicate
    mocks.insertEvent.mockResolvedValue({ data: [], error: null });
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=x" },
    }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
