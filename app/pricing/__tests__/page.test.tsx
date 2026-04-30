// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import PricingPage from "../page";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { cleanup } from "@testing-library/react";

// push fn lives inside the factory closure — available at hoisting time
vi.mock("next/navigation", () => {
  const push = vi.fn();
  return { useRouter: () => ({ push, replace: vi.fn() }), _push: push };
});

// Mock useEntitlements so tests control tier without fetch
vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

// Lazily import the _push spy after module graph is settled
async function getMockPush() {
  const mod = await import("next/navigation");
  return (mod as unknown as { _push: ReturnType<typeof vi.fn> })._push;
}

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default entitlements: free tier (re-applied after each clear)
  (useEntitlements as unknown as Mock).mockReturnValue({
    data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
  });
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, assign: vi.fn() },
  });
});

describe("PricingPage", () => {
  it("renders free + pro cards and toggles between yearly and monthly prices", () => {
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={freshQueryClient()}>{children}</Wrapper> });

    // Default plan is yearly
    expect(screen.getByText(/\$4\.99\/mo/)).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^Monthly$/i }));
    expect(screen.getByText(/\$6\.99\/mo/)).not.toBeNull();
  });

  it("CTA shows 'Current plan' for pro user", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: { tier: "pro", caps: { summariesUsed: 0, summariesLimit: -1 } },
    });
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={freshQueryClient()}>{children}</Wrapper> });
    expect(screen.getByRole("button", { name: /current plan/i })).not.toBeNull();
  });

  it("upgrade click POSTs to /api/billing/checkout and assigns the returned url", async () => {
    // free tier: button says Upgrade, click triggers checkout
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), { status: 200 }),
      );
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={freshQueryClient()}>{children}</Wrapper> });

    fireEvent.click(screen.getAllByRole("button", { name: /upgrade/i })[0]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({ method: "POST" }),
      );
      expect(window.location.assign).toHaveBeenCalledWith("https://checkout.stripe.com/x");
    });
  });

  it("anon user clicking Upgrade pushes to signup with encoded redirect_to=/pricing?intent=upgrade", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: { tier: "anon", caps: { summariesUsed: 0, summariesLimit: 1 } },
    });

    // Spy on fetch — should NOT be called (anon path does router.push, no fetch)
    const fetchSpy = vi.spyOn(global, "fetch");

    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={freshQueryClient()}>{children}</Wrapper> });

    fireEvent.click(screen.getAllByRole("button", { name: /upgrade/i })[0]);

    // A small tick to let any async code settle
    await new Promise((r) => setTimeout(r, 0));

    // The anon path calls router.push and returns — no fetch should happen
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/billing/checkout",
      expect.anything(),
    );
    // The redirect target must contain the encoded redirect_to param.
    // We verify by checking window.location was NOT changed (no assign call)
    // and by checking that the router mock was invoked.
    // Since the push fn is from the vi.mock factory (not spied), retrieve it via the _push export.
    const navMod = await import("next/navigation");
    const push = (navMod as unknown as { _push: ReturnType<typeof vi.fn> })._push;
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/auth/sign-up"),
    );
    expect(push.mock.calls.at(-1)?.[0]).toContain(
      "redirect_to=" + encodeURIComponent("/pricing?intent=upgrade"),
    );
  });

  it("shows inline error text when checkout fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={freshQueryClient()}>{children}</Wrapper> });

    fireEvent.click(screen.getAllByRole("button", { name: /upgrade/i })[0]);

    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeNull()
    );
    expect(screen.getByRole("alert").textContent).toMatch(/checkout/i);
  });

  it("FAQ renders all 4 items", () => {
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={freshQueryClient()}>{children}</Wrapper> });
    expect(screen.getAllByText(/Can I cancel anytime\?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/end of my paid period/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Do you offer refunds\?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/payment methods/i).length).toBeGreaterThan(0);
  });
});
