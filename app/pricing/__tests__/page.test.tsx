// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import PricingPage from "../page";

const analyticsMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analyticsMocks.capture,
}));

vi.mock("next/navigation", () => {
  const push = vi.fn();
  return { useRouter: () => ({ push, replace: vi.fn() }), _push: push };
});

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderPage() {
  return render(<PricingPage />, {
    wrapper: ({ children }) => (
      <Wrapper qc={freshQueryClient()}>{children}</Wrapper>
    ),
  });
}

async function getRouterPush() {
  const navMod = await import("next/navigation");
  return (navMod as unknown as { _push: ReturnType<typeof vi.fn> })._push;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  (useEntitlements as unknown as Mock).mockReturnValue({
    data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
  });
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, assign: vi.fn() },
  });
});

describe("PricingPage", () => {
  it("shows Free, Pro Monthly, and Pro Yearly together without a billing-period control", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Free" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Pro Monthly" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Pro Yearly" })).not.toBeNull();
    expect(screen.getByText("$6.99/mo")).not.toBeNull();
    expect(screen.getByText("$4.99/mo")).not.toBeNull();
    expect(screen.getByText("Save 28%")).not.toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: /billing period/i }),
    ).toBeNull();
    expect(document.querySelectorAll("[data-pricing-card]")).toHaveLength(3);
  });

  it.each([
    ["monthly", "https://checkout.stripe.com/monthly"],
    ["yearly", "https://checkout.stripe.com/yearly"],
  ] as const)(
    "starts %s checkout with the matching plan",
    async (plan, checkoutUrl) => {
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ url: checkoutUrl }), { status: 200 }),
        );
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: `Choose ${plan}` }));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        expect(window.location.assign).toHaveBeenCalledWith(checkoutUrl);
        expect(analyticsMocks.capture).toHaveBeenCalledWith(
          "checkout_started",
          {
            account_type: "free",
            source_surface: "pricing",
            plan,
            billing_interval: plan,
          },
        );
      });
    },
  );

  it("marks the subscriber's interval current and routes the other interval to account", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1 },
        subscription: { plan: "yearly" },
      },
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    renderPage();

    const currentPlan = screen.getByRole("button", {
      name: "Current plan",
    }) as HTMLButtonElement;
    expect(currentPlan.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Manage subscription" }),
    );

    expect(await getRouterPush()).toHaveBeenCalledWith("/account");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes both paid cards to account when a Pro subscriber's interval is unknown", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1 },
        subscription: { plan: null },
      },
    });
    renderPage();

    const manageButtons = screen.getAllByRole("button", {
      name: "Manage subscription",
    });
    expect(manageButtons).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Current plan" })).toBeNull();
    fireEvent.click(manageButtons[0]);

    expect(await getRouterPush()).toHaveBeenCalledWith("/account");
  });

  it("sends an anonymous learner to signup for the selected interval", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: { tier: "anon", caps: { summariesUsed: 0, summariesLimit: 1 } },
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));

    const push = await getRouterPush();
    expect(push).toHaveBeenCalledWith(expect.stringContaining("/auth/sign-up"));
    expect(push.mock.calls.at(-1)?.[0]).toContain(
      "redirect_to=" + encodeURIComponent("/pricing?intent=upgrade"),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("does not route while the learner's entitlements are still loading", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: undefined,
      isPending: true,
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    renderPage();

    const monthly = screen.getByRole("button", {
      name: "Loading monthly pricing",
    }) as HTMLButtonElement;
    expect(monthly.disabled).toBe(true);
    fireEvent.click(monthly);

    expect(await getRouterPush()).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("offers a retry when entitlements fail instead of loading forever", async () => {
    const refetch = vi.fn().mockResolvedValue({ data: undefined });
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isPending: false,
      refetch,
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    renderPage();

    const monthly = screen.getByRole("button", {
      name: "Retry monthly pricing",
    }) as HTMLButtonElement;
    expect(monthly.disabled).toBe(false);
    expect(screen.getAllByText(/couldn't load your account status/i)).toHaveLength(2);
    fireEvent.click(monthly);

    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(await getRouterPush()).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows inline error text on the card whose checkout fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("", { status: 500 }),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose yearly" }));

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/checkout/i);
  });

  it("renders all four FAQ items", () => {
    renderPage();

    expect(
      screen.getAllByText(/Can I cancel anytime\?/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/end of my paid period/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Do you offer refunds\?/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/payment methods/i).length).toBeGreaterThan(0);
  });
});
