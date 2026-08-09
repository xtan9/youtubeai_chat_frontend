import { it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  resolveRegisteredSubscription: vi.fn(),
  getServiceRoleClient: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/services/entitlements", () => ({
  resolveRegisteredSubscription: mocks.resolveRegisteredSubscription,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => mocks.getServiceRoleClient(),
}));

vi.mock("@/lib/services/stripe", () => ({
  getStripe: () => ({
    customers: { create: mocks.customersCreate },
    checkout: { sessions: { create: mocks.sessionsCreate } },
  }),
  priceIdForPlan: (p: string) => (p === "monthly" ? "price_M" : p === "yearly" ? "price_Y" : null),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example");
  mocks.resolveRegisteredSubscription.mockResolvedValue({
    kind: "resolved",
    tier: "free",
    subscription: null,
    presentation: { state: "free" },
  });
  // Default service-role chain returning maybeSingle()
  mocks.getServiceRoleClient.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
      upsert: mocks.upsert,
    }),
  });
});

function resolvedPrincipal(
  userId = "u1",
  email: string | null = "u@x",
  isAnonymous = false,
) {
  return {
    kind: "resolved" as const,
    principal: { userId, email, isAnonymous },
  };
}

it("401 when not signed in", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(401);
});

it("503 when auth infrastructure is unavailable", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    code: "service_unavailable",
    message: "Service unavailable",
  });
});

it("401 when user is anonymous (Supabase anon auth)", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(
    resolvedPrincipal("u1", "", true),
  );
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(401);
});

it("400 on invalid plan", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "weekly" }),
  }));
  expect(res.status).toBe(400);
});

it("400 when a registered checkout attempt has no idempotency key", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  const { POST } = await import("../route");
  const res = await POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ plan: "monthly" }),
    }),
  );
  expect(res.status).toBe(400);
  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it("400 when body and header idempotency keys conflict", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  const { POST } = await import("../route");
  const res = await POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ plan: "monthly", attempt_id: "attempt-body-1234" }),
      headers: { "Idempotency-Key": "attempt-header-1234" },
    }),
  );
  expect(res.status).toBe(400);
  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it("accepts a header-only idempotency key", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.customersCreate.mockResolvedValue({ id: "cus_header" });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/header" });

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
    headers: { "Idempotency-Key": "a1234567" },
  }));

  expect(res.status).toBe(200);
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(
    expect.anything(),
    { idempotencyKey: "checkout-u1-a1234567" },
  );
});

it.each([
  "short7",
  "contains space",
  "contains/slash",
  "a".repeat(129),
])("rejects malformed idempotency key %s", async (attemptId) => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
    headers: { "Idempotency-Key": attemptId },
  }));
  expect(res.status).toBe(400);
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it.each(["a1234567", "a".repeat(128)])(
  "accepts idempotency key boundary %s",
  async (attemptId) => {
    mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.customersCreate.mockResolvedValue({ id: "cus_boundary" });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/boundary" });

    const { POST } = await import("../route");
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ plan: "monthly" }),
      headers: { "Idempotency-Key": attemptId },
    }));
    expect(res.status).toBe(200);
  },
);

it.each([
  {
    state: "active_pro",
    presentation: {
      state: "active_pro",
      plan: "monthly",
      renewsAt: "2026-09-01T00:00:00.000Z",
    },
  },
  {
    state: "pro_pending_cancellation",
    presentation: {
      state: "pro_pending_cancellation",
      plan: "yearly",
      accessEndsAt: "2027-09-01T00:00:00.000Z",
    },
  },
  {
    state: "billing_issue",
    presentation: { state: "billing_issue", plan: "monthly" },
  },
])("409 rejects $state before Stripe work", async ({ presentation }) => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.resolveRegisteredSubscription.mockResolvedValue({
    kind: "resolved",
    tier: presentation.state === "billing_issue" ? "free" : "pro",
    subscription: null,
    presentation,
  });

  const { POST } = await import("../route");
  const res = await POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ plan: "monthly" }),
    }),
  );

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    code: "subscription_ineligible",
    message: "Manage your existing subscription in Plan & Billing.",
  });
  expect(mocks.resolveRegisteredSubscription).toHaveBeenCalledWith(
    "u1",
    false,
  );
  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it("503 when trusted Subscription state cannot be resolved", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.resolveRegisteredSubscription.mockResolvedValue({
    kind: "unavailable",
  });

  const { POST } = await import("../route");
  const res = await POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ plan: "yearly" }),
    }),
  );

  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({
    code: "service_unavailable",
    message: "Service unavailable",
  });
  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it("creates customer + session for new user, returns url", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.customersCreate.mockResolvedValue({ id: "cus_1" });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({
      plan: "monthly",
      source_surface: "global_header",
      device_class: "mobile",
      attempt_id: "attempt-12345678",
    }),
  }));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.url).toBe("https://checkout.stripe.com/x");
  expect(mocks.customersCreate).toHaveBeenCalledWith(
    expect.objectContaining({ metadata: { user_id: "u1" } }),
    expect.objectContaining({ idempotencyKey: "customer-create-u1" }),
  );
  expect(mocks.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: "u1", stripe_customer_id: "cus_1", tier: "free" })
  );
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: "u1",
      metadata: {
        user_id: "u1",
        plan: "monthly",
        source_surface: "global_header",
        presentation_state: "upgrade_to_pro",
        authentication_state: "registered",
        device_class: "mobile",
      },
      subscription_data: {
        metadata: {
          user_id: "u1",
          plan: "monthly",
          source_surface: "global_header",
          presentation_state: "upgrade_to_pro",
          authentication_state: "registered",
          device_class: "mobile",
        },
      },
      line_items: [{ price: "price_M", quantity: 1 }],
      success_url:
        "https://test.example/billing/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url:
        "https://test.example/pricing?intent=upgrade&plan=monthly&source_surface=global_header&canceled=1",
      allow_promotion_codes: true,
    }),
    { idempotencyKey: "checkout-u1-attempt-12345678" },
  );
});

it("reuses one Stripe idempotency key for concurrent requests from one attempt", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_existing" },
    error: null,
  });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  const request = () =>
    POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          plan: "monthly",
          source_surface: "direct_pricing",
          device_class: "desktop",
          attempt_id: "attempt-concurrent-1",
        }),
      }),
    );
  await Promise.all([request(), request()]);

  expect(mocks.sessionsCreate).toHaveBeenCalledTimes(2);
  expect(mocks.sessionsCreate.mock.calls[0][1]).toEqual({
    idempotencyKey: "checkout-u1-attempt-concurrent-1",
  });
  expect(mocks.sessionsCreate.mock.calls[1][1]).toEqual({
    idempotencyKey: "checkout-u1-attempt-concurrent-1",
  });
});

it("serializes concurrent customer creation for one trusted attempt", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  let customerId: string | null = null;
  mocks.maybeSingle.mockImplementation(async () => ({
    data: customerId ? { stripe_customer_id: customerId } : null,
    error: null,
  }));
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.customersCreate.mockImplementation(async () => {
    customerId = "cus_serialized";
    return { id: customerId };
  });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  const request = () =>
    POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          plan: "monthly",
          source_surface: "direct_pricing",
          device_class: "desktop",
          attempt_id: "attempt-customer-race-1",
        }),
      }),
    );
  await Promise.all([request(), request()]);

  expect(mocks.customersCreate).toHaveBeenCalledTimes(1);
  expect(mocks.sessionsCreate).toHaveBeenCalledTimes(2);
});

it("reuses existing customer when user_subscriptions row already exists", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_existing" },
    error: null,
  });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "yearly", attempt_id: "attempt-existing-1234" }),
  }));

  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(
    expect.objectContaining({ customer: "cus_existing", line_items: [{ price: "price_Y", quantity: 1 }] }),
    expect.objectContaining({ idempotencyKey: "checkout-u1-attempt-existing-1234" }),
  );
});

it("503 when customer lookup returns DB error", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST301" } });
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly", attempt_id: "attempt-lookup-1234" }),
  }));
  expect(res.status).toBe(503);
  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it("503 when upsert fails (does not create checkout session)", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.customersCreate.mockResolvedValue({ id: "cus_1" });
  mocks.upsert.mockResolvedValue({ error: { code: "23505" } });
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly", attempt_id: "attempt-upsert-1234" }),
  }));
  expect(res.status).toBe(503);
  expect(mocks.sessionsCreate).not.toHaveBeenCalled();
});

it("503 when Stripe throws", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_existing" },
    error: null,
  });
  mocks.sessionsCreate.mockRejectedValue(new Error("stripe down"));
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly", attempt_id: "attempt-stripe-1234" }),
  }));
  expect(res.status).toBe(503);
});
