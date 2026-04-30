import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  insertEvent: vi.fn(),
  retrieveSub: vi.fn(),
  upsert: vi.fn(),
  fromUserSubsLookup: vi.fn(),
  deleteEvent: vi.fn(),
}));

// Use the REAL `deriveTier`, `periodEndToIso`, and `readCurrentPeriodEnd`
// so a future divergence in production logic surfaces here. Mocking those
// helpers byte-for-byte (the prior shape) was a drift trap — the very
// kind of payload-shape divergence PR #104 fixes. Only stub `getStripe`
// (the only side-effecting/network-touching surface).
vi.mock("@/lib/services/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/stripe")>(
    "@/lib/services/stripe",
  );
  return {
    ...actual,
    getStripe: () => ({
      webhooks: { constructEvent: mocks.constructEvent },
      subscriptions: { retrieve: mocks.retrieveSub },
    }),
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
    // value lives on each subscription item. Pins the regression PR #104
    // fixes — webhook reading sub.current_period_end was null on every
    // paying user, silently producing tier="free".
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

  it("active subscription with missing period_end → 500 + idempotency row deleted (canary)", async () => {
    // The architectural fix from PR #104 review: a tier=free write for
    // an active subscription is a code defect, not a data state. Throw
    // so Stripe retries (idempotency row deleted by outer catch).
    mocks.constructEvent.mockReturnValue({
      id: "evt_canary",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_x",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_M" } }] },
          // current_period_end intentionally omitted in BOTH locations
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_canary" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(500);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.deleteEvent).toHaveBeenCalledWith("event_id", "evt_canary");
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

  it("basil-shape (period_end on items only) → tier=pro [PR #104 regression]", async () => {
    // Primary purchase path: brand-new paying user free→pro. Pins basil
    // schema fix at the checkout.session.completed handler too.
    const future = Math.floor(Date.now() / 1000) + 365 * 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_basil_checkout",
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
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_basil_checkout" }], error: null });
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      // top-level current_period_end omitted — it lives on items.data[0]
      items: { data: [{ price: { id: "price_Y" }, current_period_end: future }] },
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" },
    }));

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "pro",
        plan: "yearly",
        current_period_end: new Date(future * 1000).toISOString(),
      }),
      expect.anything(),
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

  it("basil-shape persists items[0] period_end on cancel [PR #104 regression]", async () => {
    // Tier is hard-coded "free" on delete, but current_period_end is
    // still written and read by the billing UI to show "valid until".
    // Pins that the basil schema fix flows through this handler too.
    const past = Math.floor(Date.now() / 1000) - 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_d_basil",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "canceled",
          cancel_at_period_end: false,
          // top-level current_period_end omitted; lives on items.data[0]
          items: { data: [{ price: { id: "price_M" }, current_period_end: past }] },
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_d_basil" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "free",
        current_period_end: new Date(past * 1000).toISOString(),
      }),
      expect.anything(),
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
