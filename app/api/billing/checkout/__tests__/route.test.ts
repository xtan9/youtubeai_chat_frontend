import { it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getServiceRoleClient: vi.fn(),
  customersCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  upsert: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
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

it("401 when not signed in", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(401);
});

it("401 when user is anonymous (Supabase anon auth)", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", is_anonymous: true } },
    error: null,
  });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "monthly" }),
  }));
  expect(res.status).toBe(401);
});

it("400 on invalid plan", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
  const { POST } = await import("../route");
  const res = await POST(new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ plan: "weekly" }),
  }));
  expect(res.status).toBe(400);
});

it("creates customer + session for new user, returns url", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
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
    })
  );
});

it("reuses existing customer when user_subscriptions row already exists", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
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
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
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
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
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
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "u1", email: "u@x", is_anonymous: false } },
    error: null,
  });
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
