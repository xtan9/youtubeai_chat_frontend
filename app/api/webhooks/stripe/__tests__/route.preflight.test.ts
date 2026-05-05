import { describe, it, expect, vi, beforeEach } from "vitest";

// Separate from route.test.ts because that file hardcodes both helpers to
// always return non-null clients at module scope. These tests need the
// helpers to return null on demand to exercise the 503 preflight path.

const mocks = vi.hoisted(() => ({
  getStripe: vi.fn(),
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/services/stripe", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/stripe")>(
    "@/lib/services/stripe",
  );
  return { ...actual, getStripe: mocks.getStripe };
});

vi.mock("@/lib/supabase/service-role", () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}));

beforeEach(() => {
  mocks.getStripe.mockReset();
  mocks.getServiceRoleClient.mockReset();
  vi.unstubAllEnvs();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const stripeStub = { webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() } };
const srStub = { from: vi.fn() };

function postWithSig() {
  return new Request("http://x", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": "t=1,v1=x" },
  });
}

describe("Stripe webhook env preflight", () => {
  it("503 lists STRIPE_WEBHOOK_SECRET when only secret missing", async () => {
    // No STRIPE_WEBHOOK_SECRET env stub
    mocks.getStripe.mockReturnValue(stripeStub);
    mocks.getServiceRoleClient.mockReturnValue(srStub);

    const { POST } = await import("../route");
    const res = await POST(postWithSig());

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("STRIPE_WEBHOOK_SECRET");
    expect(text).not.toContain("STRIPE_API_CLIENT");
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE");
  });

  it("503 lists STRIPE_API_CLIENT when only stripe client missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    mocks.getStripe.mockReturnValue(null);
    mocks.getServiceRoleClient.mockReturnValue(srStub);

    const { POST } = await import("../route");
    const res = await POST(postWithSig());

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("STRIPE_API_CLIENT");
    expect(text).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(text).not.toContain("SUPABASE_SERVICE_ROLE");
  });

  it("503 lists SUPABASE_SERVICE_ROLE when only service-role client missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    mocks.getStripe.mockReturnValue(stripeStub);
    mocks.getServiceRoleClient.mockReturnValue(null);

    const { POST } = await import("../route");
    const res = await POST(postWithSig());

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("SUPABASE_SERVICE_ROLE");
    expect(text).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(text).not.toContain("STRIPE_API_CLIENT");
  });

  it("503 lists all three when nothing is configured", async () => {
    // No env stub, both getters return null
    mocks.getStripe.mockReturnValue(null);
    mocks.getServiceRoleClient.mockReturnValue(null);

    const { POST } = await import("../route");
    const res = await POST(postWithSig());

    expect(res.status).toBe(503);
    const text = await res.text();
    // Lock the exact body format — operators (and any future grep/parser)
    // depend on this string shape, and a refactor to e.g. JSON.stringify
    // would silently reword the operator-facing contract while looser
    // .toContain() assertions kept passing.
    expect(text).toBe(
      "Service unavailable: missing STRIPE_WEBHOOK_SECRET, STRIPE_API_CLIENT, SUPABASE_SERVICE_ROLE",
    );
  });

  it("503 lists STRIPE_WEBHOOK_SECRET when secret is empty string", async () => {
    // Real misconfig mode: rotating an env var to an empty value in the
    // Vercel UI is a one-click footgun. `!secret` treats it as missing —
    // pin that so a future swap to `secret === undefined` regresses loudly.
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    mocks.getStripe.mockReturnValue(stripeStub);
    mocks.getServiceRoleClient.mockReturnValue(srStub);

    const { POST } = await import("../route");
    const res = await POST(postWithSig());

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("STRIPE_WEBHOOK_SECRET");
  });
});
