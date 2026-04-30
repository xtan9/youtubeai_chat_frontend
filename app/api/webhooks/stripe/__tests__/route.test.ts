import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  insertEvent: vi.fn(),
  retrieveSub: vi.fn(),
  upsert: vi.fn(),
  fromUserSubsLookup: vi.fn(),
  deleteEvent: vi.fn(),
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
    // basil API moved current_period_end from Subscription to
    // Subscription.items.data[]. Mirror the real helper's read-items-first,
    // fall-back-to-top-level shape so tests using either fixture pass.
    readCurrentPeriodEnd: (sub: {
      items?: { data?: Array<{ current_period_end?: number }> };
      current_period_end?: number;
    }) => {
      const item = sub.items?.data?.[0];
      const itemEnd = item?.current_period_end;
      if (typeof itemEnd === "number" && Number.isFinite(itemEnd)) return itemEnd;
      const topEnd = sub.current_period_end;
      if (typeof topEnd === "number" && Number.isFinite(topEnd)) return topEnd;
      return null;
    },
  };
});

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "stripe_webhook_events") {
        return {
          upsert: () => ({ select: mocks.insertEvent }),
          delete: () => ({ eq: mocks.deleteEvent }),
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
  mocks.deleteEvent.mockResolvedValue({ error: null });
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

describe("idempotency cleanup on handler failure", () => {
  it("500 + deletes idempotency row when dispatch throws", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_x",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_M" } }] },
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_x" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: { message: "boom" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(500);
    expect(mocks.deleteEvent).toHaveBeenCalledWith("event_id", "evt_x");
  });
});

describe("checkout.session.completed missing fields", () => {
  it("checkout.session.completed: missing user_id → 200, no upsert", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_missing",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_1",
          subscription: "sub_1",
          // no metadata, no client_reference_id
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_missing" }], error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(200);
    expect(mocks.retrieveSub).not.toHaveBeenCalled();
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

  it("basil-shape (period_end on items only) → tier=pro", async () => {
    // Real basil-API payload: top-level current_period_end is omitted, the
    // value lives on each subscription item. This pins the regression we
    // hit during P2.11 e2e — webhook reading sub.current_period_end was
    // null on every paying user, silently producing tier="free".
    const future = Math.floor(Date.now() / 1000) + 365 * 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_basil",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_Y" }, current_period_end: future }] },
        },
      },
    });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        tier: "pro",
        plan: "yearly",
        current_period_end: new Date(future * 1000).toISOString(),
      }),
      expect.anything(),
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

  it("500 + deletes idempotency row when customer lookup returns DB error", async () => {
    const future = Math.floor(Date.now() / 1000) + 86400;
    mocks.constructEvent.mockReturnValue(buildEvent({ status: "active", current_period_end: future }));
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_lookup_err" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: null, error: { message: "db down" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(res.status).toBe(500);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteEvent).toHaveBeenCalled();
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

describe("invoice events (no-ops)", () => {
  it("invoice.paid: 200 no-op (no upsert)", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_invoice_paid",
      type: "invoice.paid",
      data: { object: {} },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_invoice_paid" }], error: null });
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("invoice.payment_failed: 200 no-op (no upsert)", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_invoice_failed",
      type: "invoice.payment_failed",
      data: { object: {} },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_invoice_failed" }], error: null });
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("customer.subscription.deleted", () => {
  it("tier=free, subscription_id null, customer kept", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_d",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "canceled",
          current_period_end: Math.floor(Date.now() / 1000),
          cancel_at_period_end: false,
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_d" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        stripe_customer_id: "cus_1",
        stripe_subscription_id: null,
        tier: "free",
        plan: null,
        cancel_at_period_end: false,
      }),
      expect.objectContaining({ onConflict: "user_id" }),
    );
  });

  it("logs and 200s when customer is unknown (no row mapping)", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_d2",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_x", customer: "cus_x", status: "canceled" } },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_d2" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: null, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("500 + deletes idempotency row when customer lookup returns DB error", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_del_err",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_x", customer: "cus_x", status: "canceled" } },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_del_err" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: null, error: { message: "db down" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(res.status).toBe(500);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteEvent).toHaveBeenCalled();
  });
});
