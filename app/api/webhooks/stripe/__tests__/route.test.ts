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

describe("customer.subscription.updated", () => {
  function buildEvent(sub: Partial<{
    id: string; status: string; customer: string;
    current_period_end: number; cancel_at_period_end: boolean;
    items: { data: Array<{ price: { id: string } }> };
  }>) {
    return {
      id: `evt_${Math.random()}`,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_M" } }] },
          ...sub,
        },
      },
    };
  }

  beforeEach(() => {
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "x" }], error: null });
  });

  it("active + future period → tier=pro", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.constructEvent.mockReturnValue(buildEvent({ status: "active", current_period_end: future }));
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", tier: "pro", status: "active", plan: "monthly" }),
      expect.objectContaining({ onConflict: "user_id" }),
    );
  });

  it("past_due within 3 days → tier=pro (grace)", async () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
    mocks.constructEvent.mockReturnValue(buildEvent({ status: "past_due", current_period_end: twoDaysAgo }));
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "pro", status: "past_due" }),
      expect.anything(),
    );
  });

  it("past_due over 3 days → tier=free", async () => {
    const fiveDaysAgo = Math.floor(Date.now() / 1000) - 5 * 86400;
    mocks.constructEvent.mockReturnValue(buildEvent({ status: "past_due", current_period_end: fiveDaysAgo }));
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "free", status: "past_due" }),
      expect.anything(),
    );
  });

  it("plan switch monthly → yearly updates `plan`", async () => {
    const future = Math.floor(Date.now() / 1000) + 365 * 86400;
    mocks.constructEvent.mockReturnValue(buildEvent({
      status: "active", current_period_end: future,
      items: { data: [{ price: { id: "price_Y" } }] },
    }));
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "yearly" }),
      expect.anything(),
    );
  });

  it("logs and 200s when customer is unknown (no row mapping)", async () => {
    const future = Math.floor(Date.now() / 1000) + 86400;
    mocks.constructEvent.mockReturnValue(buildEvent({ status: "active", current_period_end: future }));
    mocks.fromUserSubsLookup.mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed", () => {
  it("writes pro subscription row", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "u1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { user_id: "u1" },
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_2" }], error: null });
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      items: { data: [{ price: { id: "price_M" } }] },
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" },
    }));

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1",
        tier: "pro",
        plan: "monthly",
        status: "active",
        cancel_at_period_end: false,
      }),
      expect.objectContaining({ onConflict: "user_id" })
    );
  });
});
