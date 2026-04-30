// @vitest-environment happy-dom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import PricingPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, assign: vi.fn() },
  });
});

describe("PricingPage", () => {
  it("renders free + pro cards and toggles between yearly and monthly prices", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } }), { status: 200 }),
    );
    const qc = freshQueryClient();
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    // Default plan is yearly
    expect(screen.getByText(/\$4\.99\/mo/)).not.toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^Monthly$/i }));
    expect(screen.getByText(/\$6\.99\/mo/)).not.toBeNull();
  });

  it("CTA shows 'Current plan' for pro user", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tier: "pro", caps: { summariesUsed: 0, summariesLimit: -1 } }), { status: 200 }),
    );
    const qc = freshQueryClient();
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /current plan/i })).not.toBeNull();
    });
  });

  it("upgrade click POSTs to /api/billing/checkout and assigns the returned url", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/x" }), { status: 200 }),
      );
    const qc = freshQueryClient();
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /upgrade/i }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /upgrade/i })[0]);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/billing/checkout",
        expect.objectContaining({ method: "POST" }),
      );
      expect(window.location.assign).toHaveBeenCalledWith("https://checkout.stripe.com/x");
    });
  });

  it("shows inline error text when checkout fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500 }),
      );
    const qc = freshQueryClient();
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /upgrade/i }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /upgrade/i })[0]);

    await waitFor(() =>
      expect(screen.getByRole("alert")).not.toBeNull()
    );
    expect(screen.getByRole("alert").textContent).toMatch(/checkout/i);
  });

  it("FAQ renders all 4 items", () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } }), { status: 200 }),
    );
    const qc = freshQueryClient();
    render(<PricingPage />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getAllByText(/Can I cancel anytime\?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/end of my paid period/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Do you offer refunds\?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/payment methods/i).length).toBeGreaterThan(0);
  });
});
