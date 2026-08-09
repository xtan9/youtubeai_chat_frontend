import { it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  getServiceRoleClient: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
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
  expect(await res.json()).toEqual({ message: "Service unavailable" });
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

it("creates customer + session for new user, returns url", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  mocks.customersCreate.mockResolvedValue({ id: "cus_1" });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.sessionsCreate.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
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
      line_items: [{ price: "price_M", quantity: 1 }],
      allow_promotion_codes: true,
      success_url:
        "https://test.example/billing/success?session_id={CHECKOUT_SESSION_ID}",
    })
  );
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
    body: JSON.stringify({ plan: "yearly" }),
  }));

  expect(mocks.customersCreate).not.toHaveBeenCalled();
  expect(mocks.sessionsCreate).toHaveBeenCalledWith(
    expect.objectContaining({ customer: "cus_existing", line_items: [{ price: "price_Y", quantity: 1 }] })
  );
});

it("503 when customer lookup returns DB error", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST301" } });
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
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
    body: JSON.stringify({ plan: "monthly" }),
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
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(503);
});
