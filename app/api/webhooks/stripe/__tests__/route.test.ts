import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  insertEvent: vi.fn(),
  retrieveSub: vi.fn(),
  upsert: vi.fn(),
  updateMarker: vi.fn(),
  fromUserSubsLookup: vi.fn(),
  retryMarkerLookup: vi.fn(),
  activationStates: new Map<string, {
    marker_kind: "subscription_activation" | "stripe_event";
    marker_status: "pending" | "processing" | "sent" | "processed";
    lease_until: string | null;
    claim_token: string | null;
    received_at?: string;
  }>(),
  deleteEvent: vi.fn(),
  getAnalyticsUser: vi.fn(),
  captureSubscriptionActivated: vi.fn(),
}));

type TestMarkerState = {
  marker_kind: "subscription_activation" | "stripe_event";
  marker_status: "pending" | "processing" | "sent" | "processed";
  lease_until: string | null;
  claim_token: string | null;
  received_at?: string;
};

function markerStateFor(eventId: string): TestMarkerState | undefined {
  const direct = mocks.activationStates.get(eventId);
  if (direct) return direct;
  const prefixes = [
    "stripe_event:processing:",
    "subscription_activation:processing:",
    "subscription_activation:pending:",
  ];
  for (const prefix of prefixes) {
    if (eventId.startsWith(prefix)) {
      return mocks.activationStates.get(eventId.slice(prefix.length));
    }
  }
  return undefined;
}

function markerKindFor(eventId: string): TestMarkerState["marker_kind"] {
  return eventId.startsWith("subscription_activation:")
    ? "subscription_activation"
    : "stripe_event";
}

function markerStatusFor(eventId: string): TestMarkerState["marker_status"] {
  if (eventId.startsWith("stripe_event:processing:") || eventId.startsWith("subscription_activation:processing:")) {
    return "processing";
  }
  if (eventId.startsWith("subscription_activation:pending:")) return "pending";
  if (eventId.startsWith("stripe_event:sent:") || eventId.startsWith("subscription_activation:sent:")) {
    return eventId.startsWith("stripe_event:") ? "processed" : "sent";
  }
  return "processed";
}

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
    auth: { admin: { getUserById: mocks.getAnalyticsUser } },
    from: (table: string) => {
      if (table === "stripe_webhook_events") {
        return {
          upsert: (payload: unknown) => ({
            select: async () => {
              const result = await mocks.insertEvent(payload);
              const marker = payload as {
                event_id?: string;
                received_at?: string | null;
              };
              if (marker.event_id && result?.data?.length) {
                const state: TestMarkerState = {
                  marker_kind: markerKindFor(marker.event_id),
                  marker_status: markerStatusFor(marker.event_id),
                  lease_until: null,
                  claim_token: null,
                  received_at: marker.received_at ?? new Date().toISOString(),
                };
                mocks.activationStates.set(marker.event_id, state);
                const prefixes = [
                  "stripe_event:processing:",
                  "stripe_event:sent:",
                  "subscription_activation:processing:",
                  "subscription_activation:pending:",
                  "subscription_activation:sent:",
                ];
                const prefix = prefixes.find((value) => marker.event_id?.startsWith(value));
                if (prefix) mocks.activationStates.set(marker.event_id.slice(prefix.length), state);
              }
              return result;
            },
          }),
          update: (payload: unknown) => {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq: (column: string, value: unknown) => {
                filters.push([column, value]);
                return builder;
              },
              lt: (column: string, value: unknown) => {
                filters.push([column, value]);
                return builder;
              },
              select: () => mocks.updateMarker(payload, filters),
            };
            return builder;
          },
          select: () => {
            const filters: Array<[string, unknown]> = [];
            const builder = {
              eq: (column: string, value: unknown) => {
                filters.push([column, value]);
                return builder;
              },
              maybeSingle: () => mocks.retryMarkerLookup(filters),
            };
            return builder;
          },
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

vi.mock("@/lib/analytics/server", () => ({
  captureSubscriptionActivated: mocks.captureSubscriptionActivated,
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) {
    if (typeof (m as { mockReset?: unknown }).mockReset === "function") {
      (m as { mockReset: () => void }).mockReset();
    }
  }
  mocks.activationStates.clear();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_M");
  vi.stubEnv("STRIPE_PRICE_YEARLY", "price_Y");
  mocks.deleteEvent.mockResolvedValue({ error: null });
  mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) => {
    if (markerStateFor(payload.event_id)) {
      return { data: [], error: null };
    }
    return { data: [{ event_id: payload.event_id }], error: null };
  });
  mocks.captureSubscriptionActivated.mockResolvedValue("sent");
  mocks.updateMarker.mockImplementation(
    async (
      payload: {
        received_at?: string | null;
      },
      filters: Array<[string, unknown]>,
    ) => {
      const eventId = filters.find(([column]) => column === "event_id")?.[1];
      if (typeof eventId !== "string") return { data: [], error: null };
      const state = markerStateFor(eventId);
      if (!state) return { data: [], error: null };
      const receivedAtFilter = filters.find(([column]) => column === "received_at")?.[1];
      const currentReceivedAt = state.received_at ?? state.lease_until;
      if (receivedAtFilter !== undefined && currentReceivedAt !== String(receivedAtFilter)) {
        return { data: [], error: null };
      }
      if (Object.prototype.hasOwnProperty.call(payload, "received_at")) {
        state.received_at = payload.received_at ?? undefined;
      }
      return { data: [{ event_id: eventId }], error: null };
    },
  );
  mocks.retryMarkerLookup.mockImplementation(async (filters: Array<[string, unknown]>) => {
    const eventId = filters.find(([column]) => column === "event_id")?.[1];
    const state = typeof eventId === "string" ? markerStateFor(eventId) : undefined;
    // Raw event ids represent legacy completed receipts. A test state with a
    // processing status is the compatibility alias for the leased marker,
    // not a completed raw receipt.
    if (
      typeof eventId === "string" &&
      !eventId.includes(":") &&
      state?.marker_status === "processing"
    ) {
      return { data: null, error: null };
    }
    return {
      data: state
        ? {
            event_id: eventId,
            received_at: state.received_at ?? state.lease_until,
          }
        : null,
      error: null,
    };
  });
  mocks.getAnalyticsUser.mockResolvedValue({
    data: { user: { app_metadata: {} } },
    error: null,
  });
  mocks.fromUserSubsLookup.mockResolvedValue({ data: null, error: null });
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
    // A raw event_id row is the legacy completed receipt.
    mocks.activationStates.set("evt_1", {
      marker_kind: "stripe_event",
      marker_status: "processed",
      lease_until: null,
      claim_token: null,
      received_at: new Date().toISOString(),
    });
    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: "{}",
      headers: { "stripe-signature": "t=1,v1=x" },
    }));
    expect(res.status).toBe(200);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("returns 500 while another worker owns a live event lease", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_busy",
      type: "invoice.paid",
      data: { object: {} },
    });
    mocks.activationStates.set("evt_busy", {
      marker_kind: "stripe_event",
      marker_status: "processing",
      lease_until: new Date(Date.now() + 60_000).toISOString(),
      claim_token: "active-worker",
    });

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(500);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("reclaims a stale event lease and marks it processed", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_stale",
      type: "invoice.paid",
      data: { object: {} },
    });
    mocks.activationStates.set("evt_stale", {
      marker_kind: "stripe_event",
      marker_status: "processing",
      lease_until: "2020-01-01T00:00:00.000Z",
      claim_token: "crashed-worker",
      received_at: "2020-01-01T00:00:00.000Z",
    });

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "x" },
    }));
    expect(res.status).toBe(200);
    expect(mocks.activationStates.get("stripe_event:sent:evt_stale")).toMatchObject({
      marker_status: "processed",
    });
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
    expect(mocks.activationStates.get("evt_x")?.received_at).toBe(
      new Date(0).toISOString(),
    );
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
    mocks.constructEvent.mockReturnValue({
      ...buildEvent({ status: "active", current_period_end: future }),
      id: "evt_lookup_err",
    });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: { user_id: "u1" }, error: null });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", tier: "pro", status: "active", plan: "monthly" }),
      expect.objectContaining({ onConflict: "user_id" }),
    );
  });

  it("does not emit activation for a legacy existing Pro row without a retry marker", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.constructEvent.mockReturnValue(
      buildEvent({ status: "active", current_period_end: future }),
    );
    mocks.insertEvent.mockResolvedValue({
      data: [{ event_id: "evt_legacy_pro" }],
      error: null,
    });
    mocks.fromUserSubsLookup.mockResolvedValue({
      data: { user_id: "u1", tier: "pro", status: "active" },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "x" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.captureSubscriptionActivated).not.toHaveBeenCalled();
  });

  it("refreshes a stale active payload before writing after a cancellation", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_stale_active_after_delete",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    });
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "canceled",
      cancel_at_period_end: false,
      current_period_end: future,
      items: { data: [{ price: { id: "price_M" } }] },
    });
    mocks.fromUserSubsLookup.mockResolvedValue({
      data: { user_id: "u1", tier: "free", status: "free", stripe_subscription_id: null },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ tier: "free", status: "canceled" }),
      expect.objectContaining({ onConflict: "user_id" }),
    );
    expect(mocks.captureSubscriptionActivated).not.toHaveBeenCalled();
  });

  it("clears a sent marker on downgrade so a same-subscription reactivation emits once", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.activationStates.set("subscription_activation:sent:u1:sub_1", {
      marker_kind: "subscription_activation",
      marker_status: "sent",
      lease_until: null,
      claim_token: null,
      received_at: new Date().toISOString(),
    });
    const downgrade = {
      id: "evt_downgrade",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "canceled",
          cancel_at_period_end: false,
          items: {
            data: [{
              price: { id: "price_M" },
              current_period_start: 1000,
              current_period_end: future,
            }],
          },
        },
      },
    };
    const reactivate = {
      id: "evt_reactivate",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          items: {
            data: [{
              price: { id: "price_M" },
              current_period_start: 2000,
              current_period_end: future,
            }],
          },
        },
      },
    };
    mocks.constructEvent
      .mockReturnValueOnce(downgrade)
      .mockReturnValueOnce(reactivate);
    mocks.retrieveSub
      .mockResolvedValueOnce(downgrade.data.object)
      .mockResolvedValueOnce(reactivate.data.object);
    mocks.fromUserSubsLookup
      .mockResolvedValueOnce({
        data: { user_id: "u1", tier: "pro", status: "active", stripe_subscription_id: "sub_1" },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user_id: "u1", tier: "free", status: "free", stripe_subscription_id: "sub_1" },
        error: null,
      });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.deleteEvent.mockImplementation(async (_column: string, id: string) => {
      mocks.activationStates.delete(id);
      return { error: null };
    });

    const { POST } = await import("../route");
    const request = () =>
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.activationStates.has("subscription_activation:sent:u1:sub_1")).toBe(false);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledWith(
      "u1",
      expect.any(Object),
      expect.anything(),
      { activationMarker: `subscription_activation:u1:sub_1:2000-${future}` },
    );
  });

  it("preserves Checkout attribution when subscription.updated arrives first", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    const metadata = {
      user_id: "u1",
      plan: "monthly",
      source_surface: "global_header",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "mobile",
    };
    mocks.constructEvent.mockReturnValue({
      id: "evt_update_first",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          metadata,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    });
    const insertedIds = new Set<string>();
    mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) => {
      if (insertedIds.has(payload.event_id)) {
        return { data: [], error: null };
      }
      insertedIds.add(payload.event_id);
      return { data: [{ event_id: payload.event_id }], error: null };
    });
    mocks.fromUserSubsLookup.mockResolvedValueOnce({
      data: { user_id: "u1", tier: "free", status: "free" },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    const request = () =>
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      });
    const first = await POST(request());
    expect(first.status).toBe(200);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledWith(
      "u1",
      {
        source_surface: "global_header",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "mobile",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      },
      { app_metadata: {} },
      { activationMarker: "subscription_activation:u1:sub_1" },
    );

    // The later checkout event sees the pro row written by the update event;
    // it must not emit a duplicate activation.
    mocks.constructEvent.mockReturnValue({
      id: "evt_checkout_after_update",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "u1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata,
        },
      },
    });
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: future,
      items: { data: [{ price: { id: "price_M" } }] },
    });
    mocks.fromUserSubsLookup.mockResolvedValueOnce({
      data: { tier: "pro" },
      error: null,
    });

    const second = await POST(request());
    expect(second.status).toBe(200);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledTimes(1);
  });

  it("atomically deduplicates concurrent checkout and subscription activation", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    const metadata = {
      user_id: "u1",
      plan: "monthly",
      source_surface: "direct_pricing",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "desktop",
    };
    const checkoutEvent = {
      id: "evt_concurrent_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "u1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata,
        },
      },
    };
    const updatedEvent = {
      id: "evt_concurrent_update",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          metadata,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    };
    mocks.constructEvent
      .mockImplementationOnce(() => checkoutEvent)
      .mockImplementationOnce(() => updatedEvent);
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: future,
      metadata,
      items: { data: [{ price: { id: "price_M" } }] },
    });
    mocks.fromUserSubsLookup.mockResolvedValue({
      data: { user_id: "u1", tier: "free", status: "free" },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });

    // Model the unique event_id primary key in stripe_webhook_events. The
    // marker claim is intentionally shared by both concurrent deliveries.
    const insertedIds = new Set<string>();
    mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) => {
      if (insertedIds.has(payload.event_id)) {
        return { data: [], error: null };
      }
      insertedIds.add(payload.event_id);
      return { data: [{ event_id: payload.event_id }], error: null };
    });

    const { POST } = await import("../route");
    const request = () =>
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      });
    const [first, second] = await Promise.all([POST(request()), POST(request())]);

    expect([first.status, second.status].sort()).toEqual([200, 500]);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(
      [...insertedIds].filter((id) => id.startsWith("subscription_activation:")),
    ).toEqual([
      "subscription_activation:pending:u1:sub_1",
      "subscription_activation:processing:u1:sub_1",
      "subscription_activation:sent:u1:sub_1",
    ]);
  });

  it("retries activation analytics after a sink failure even when the row is already Pro", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    const metadata = {
      user_id: "u1",
      plan: "monthly",
      source_surface: "direct_pricing",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "desktop",
    };
    mocks.constructEvent.mockReturnValue({
      id: "evt_sink_failure",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          metadata,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    });
    const insertedIds = new Set<string>();
    mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) => {
      if (insertedIds.has(payload.event_id)) {
        return { data: [], error: null };
      }
      insertedIds.add(payload.event_id);
      return { data: [{ event_id: payload.event_id }], error: null };
    });
    mocks.deleteEvent.mockImplementation(async (_column: string, id: string) => {
      insertedIds.delete(id);
      return { error: null };
    });
    mocks.fromUserSubsLookup
      .mockResolvedValueOnce({
        data: { user_id: "u1", tier: "free", status: "free" },
        error: null,
      })
      .mockResolvedValue({
        data: { user_id: "u1", tier: "pro", status: "active" },
        error: null,
      });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.captureSubscriptionActivated
      .mockResolvedValueOnce("failed")
      .mockResolvedValue("sent");

    const { POST } = await import("../route");
    const request = () =>
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      });
    const first = await POST(request());
    expect(first.status).toBe(500);
    const second = await POST(request());
    expect(second.status).toBe(200);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledTimes(2);
  });

  it("serializes concurrent sink-failure redeliveries with the activation lease", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    const metadata = {
      user_id: "u1",
      plan: "monthly",
      source_surface: "direct_pricing",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "desktop",
    };
    const initialEvent = {
      id: "evt_retry_initial",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          metadata,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    };
    const retryEvent = {
      ...initialEvent,
      id: "evt_retry_redelivery",
    };
    mocks.constructEvent
      .mockReturnValueOnce(initialEvent)
      .mockReturnValue(retryEvent);
    const insertedIds = new Set<string>();
    mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) => {
      if (insertedIds.has(payload.event_id)) {
        return { data: [], error: null };
      }
      insertedIds.add(payload.event_id);
      return { data: [{ event_id: payload.event_id }], error: null };
    });
    mocks.deleteEvent.mockImplementation(async (_column: string, id: string) => {
      insertedIds.delete(id);
      return { error: null };
    });
    mocks.fromUserSubsLookup
      .mockResolvedValueOnce({
        data: { user_id: "u1", tier: "free", status: "free" },
        error: null,
      })
      .mockResolvedValue({
        data: { user_id: "u1", tier: "pro", status: "active" },
        error: null,
      });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.captureSubscriptionActivated
      .mockResolvedValueOnce("failed")
      .mockResolvedValue("sent");

    const { POST } = await import("../route");
    const request = () =>
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      });
    const first = await POST(request());
    expect(first.status).toBe(500);

    const [second, third] = await Promise.all([POST(request()), POST(request())]);
    expect([second.status, third.status].sort()).toEqual([200, 500]);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledTimes(2);
  });

  it("reclaims a processing activation after its worker lease expires", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    const marker = "subscription_activation:processing:u1:sub_1";
    mocks.activationStates.set(marker, {
      marker_kind: "subscription_activation",
      marker_status: "processing",
      lease_until: "2020-01-01T00:00:00.000Z",
      claim_token: "crashed-worker",
      received_at: "2020-01-01T00:00:00.000Z",
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt_stale_activation",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    });
    mocks.fromUserSubsLookup.mockResolvedValue({
      data: {
        user_id: "u1",
        tier: "pro",
        status: "active",
        stripe_subscription_id: "sub_1",
      },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(mocks.activationStates.get("subscription_activation:sent:u1:sub_1")?.marker_status).toBe("sent");
  });

  it("surfaces activation marker persistence failure before creating a claim", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_retry_marker_failure",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    });
    const insertedIds = new Set<string>();
    mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) => {
      if (payload.event_id.startsWith("subscription_activation:pending:")) {
        return { data: null, error: { message: "activation marker db down" } };
      }
      if (insertedIds.has(payload.event_id)) {
        return { data: [], error: null };
      }
      insertedIds.add(payload.event_id);
      return { data: [{ event_id: payload.event_id }], error: null };
    });
    mocks.fromUserSubsLookup.mockResolvedValue({
      data: { user_id: "u1", tier: "free", status: "free" },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.captureSubscriptionActivated.mockResolvedValueOnce("failed");

    const { POST } = await import("../route");
    const response = await POST(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      }),
    );

    expect(response.status).toBe(500);
    expect(mocks.captureSubscriptionActivated).not.toHaveBeenCalled();
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
    expect(mocks.activationStates.get("evt_canary")).toMatchObject({
      marker_kind: "stripe_event",
      marker_status: "processing",
    });
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
    mocks.constructEvent.mockReturnValue({
      ...buildEvent({ status: "active", current_period_end: future }),
      id: "evt_lookup_err",
    });
    mocks.insertEvent.mockResolvedValue({ data: [{ event_id: "evt_lookup_err" }], error: null });
    mocks.fromUserSubsLookup.mockResolvedValue({ data: null, error: { message: "db down" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "stripe-signature": "x" } }));
    expect(res.status).toBe(500);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.activationStates.get("evt_lookup_err")).toMatchObject({
      marker_kind: "stripe_event",
      marker_status: "processing",
    });
  });
});

describe("checkout.session.completed", () => {
  it("carries validated Pricing attribution into activation analytics", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_attributed_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "u1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: {
            user_id: "u1",
            plan: "yearly",
            source_surface: "global_header",
            presentation_state: "upgrade_to_pro",
            authentication_state: "registered",
            device_class: "mobile",
          },
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({
      data: [{ event_id: "evt_attributed_checkout" }],
      error: null,
    });
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_1",
      status: "active",
      cancel_at_period_end: false,
      current_period_start: 1234,
      current_period_end: future,
      items: { data: [{ price: { id: "price_Y" } }] },
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "t=1,v1=x" },
      }),
    );

    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledWith(
      "u1",
      {
        source_surface: "global_header",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "mobile",
        plan: "yearly",
        billing_interval: "yearly",
        subscription_status: "active",
      },
      { app_metadata: {} },
      {
        activationMarker: `subscription_activation:u1:sub_1:1234-${future}`,
      },
    );
  });

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
    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledWith("u1", {
      source_surface: "stripe_webhook",
      plan: "monthly",
      billing_interval: "monthly",
      subscription_status: "active",
       }, { app_metadata: {} }, { activationMarker: "subscription_activation:u1:sub_1" });
  });

  it("passes the trusted Auth marker into server analytics", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_smoke_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "smoke-user",
          customer: "cus_smoke",
          subscription: "sub_smoke",
          metadata: { user_id: "smoke-user" },
        },
      },
    });
    mocks.insertEvent.mockResolvedValue({
      data: [{ event_id: "evt_smoke_checkout" }],
      error: null,
    });
    mocks.retrieveSub.mockResolvedValue({
      id: "sub_smoke",
      status: "active",
      cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      items: { data: [{ price: { id: "price_M" } }] },
    });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.getAnalyticsUser.mockResolvedValue({
      data: {
        user: {
          id: "smoke-user",
          app_metadata: { is_smoke_account: true },
          user_metadata: { is_smoke_account: false },
        },
      },
      error: null,
    });

    const { POST } = await import("../route");
    await POST(new Request("http://x", {
      method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=x" },
    }));

    expect(mocks.captureSubscriptionActivated).toHaveBeenCalledWith(
      "smoke-user",
      expect.objectContaining({
        source_surface: "stripe_webhook",
        plan: "monthly",
        billing_interval: "monthly",
        subscription_status: "active",
      }),
      expect.objectContaining({
        app_metadata: { is_smoke_account: true },
      }),
      { activationMarker: "subscription_activation:smoke-user:sub_smoke" },
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

  it("does not emit subscription_activated for a duplicate pro update", async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86400;
    mocks.constructEvent.mockReturnValue({
      id: "evt_existing_pro",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: future,
          items: { data: [{ price: { id: "price_M" } }] },
        },
      },
    });
    mocks.insertEvent.mockImplementation(async (payload: { event_id: string }) =>
      payload.event_id.startsWith("subscription_activation:")
        ? { data: [], error: null }
        : { data: [{ event_id: payload.event_id }], error: null },
    );
    mocks.fromUserSubsLookup.mockResolvedValue({
      data: { user_id: "u1", tier: "pro", status: "active" },
      error: null,
    });
    mocks.upsert.mockResolvedValue({ error: null });

    const { POST } = await import("../route");
    await POST(
      new Request("http://x", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "x" },
      }),
    );

    expect(mocks.captureSubscriptionActivated).not.toHaveBeenCalled();
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
    expect(mocks.activationStates.get("evt_del_err")).toMatchObject({
      marker_kind: "stripe_event",
      marker_status: "processing",
    });
  });
});
