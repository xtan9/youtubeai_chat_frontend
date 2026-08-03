import { it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestPrincipal: vi.fn(),
  maybeSingle: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("@/lib/auth/request-principal", () => ({
  resolveRequestPrincipal: mocks.resolveRequestPrincipal,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  }),
}));

vi.mock("@/lib/services/stripe", () => ({
  getStripe: () => ({ billingPortal: { sessions: { create: mocks.portalCreate } } }),
}));

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example");
});

function resolvedPrincipal(userId = "u1", isAnonymous = false) {
  return {
    kind: "resolved" as const,
    principal: { userId, isAnonymous, email: "user@example.com" },
  };
}

it("401 when not signed in", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "missing" });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(401);
});

it("503 when auth infrastructure is unavailable", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue({ kind: "unavailable" });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(503);
  expect(await res.json()).toEqual({ message: "Service unavailable" });
});

it("401 for anonymous Supabase user", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(
    resolvedPrincipal("u1", true),
  );
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(401);
});

it("503 when customer lookup returns DB error", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: "PGRST301" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(503);
  expect(mocks.portalCreate).not.toHaveBeenCalled();
});

it("400 when no user_subscriptions row exists", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(400);
});

it("returns portal URL for user with stripe_customer_id", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" }, error: null,
  });
  mocks.portalCreate.mockResolvedValue({ url: "https://billing.stripe.com/x" });
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.url).toBe("https://billing.stripe.com/x");
  expect(mocks.portalCreate).toHaveBeenCalledWith(expect.objectContaining({
    customer: "cus_1",
    return_url: "https://test.example/",
  }));
});

it("503 when Stripe throws", async () => {
  mocks.resolveRequestPrincipal.mockResolvedValue(resolvedPrincipal());
  mocks.maybeSingle.mockResolvedValue({
    data: { stripe_customer_id: "cus_1" }, error: null,
  });
  mocks.portalCreate.mockRejectedValue(new Error("stripe down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { POST } = await import("../route");
  const res = await POST();
  expect(res.status).toBe(503);
});
