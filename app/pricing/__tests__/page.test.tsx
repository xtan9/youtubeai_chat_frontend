// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { useUser } from "@/lib/contexts/user-context";
import { resolvePricingNavigationContext } from "@/lib/analytics/subscription-discovery-navigation";
import PricingPage, { PricingPageContent } from "../page";

const analyticsMocks = vi.hoisted(() => ({
  capture: vi.fn(),
}));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analyticsMocks.capture,
}));

vi.mock("next/navigation", () => {
  const push = vi.fn();
  return {
    useRouter: () => ({ push, replace: vi.fn() }),
    useSearchParams: () => new URLSearchParams(window.location.search),
    _push: push,
  };
});

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: vi.fn(),
}));

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function renderPage() {
  const search = new URLSearchParams(window.location.search);
  const initialContext = resolvePricingNavigationContext({
    intent: search.get("intent") ?? undefined,
    plan: search.get("plan") ?? undefined,
    source_surface: search.get("source_surface") ?? undefined,
    canceled: search.get("canceled") ?? undefined,
  });
  return render(<PricingPageContent initialContext={initialContext} />, {
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
  window.history.replaceState(null, "", "/pricing");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  (useUser as unknown as Mock).mockReturnValue({
    user: null,
    isLoading: false,
    error: null,
  });
  (useEntitlements as unknown as Mock).mockReturnValue({
    data: {
      tier: "free",
      caps: { summariesUsed: 0, summariesLimit: 10 },
      subscriptionPresentation: { state: "free" },
    },
    subscriptionPresentation: { state: "free" },
  });
  Object.defineProperty(window, "location", {
    writable: true,
    value: {
      href: "https://www.youtubeai.chat/pricing",
      pathname: "/pricing",
      search: "",
      assign: vi.fn(),
    },
  });
});

describe("PricingPage", () => {
  it("parses Pricing intent and source on the server without a client fallback", async () => {
    const page = await PricingPage({
      searchParams: Promise.resolve({
        intent: "upgrade",
        plan: "yearly",
        source_surface: "global_header",
      }),
    });
    const initialContext = (
      page.props as { initialContext: Record<string, unknown> }
    ).initialContext;

    expect(initialContext).toEqual({
      sourceSurface: "global_header",
      selectedPlan: "yearly",
      checkoutCanceled: false,
    });
  });

  it("attributes one truthful Pricing view after identity and plan state resolve", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "anon",
        caps: { summariesUsed: 0, summariesLimit: 1 },
        subscriptionPresentation: { state: "anonymous" },
      },
      subscriptionPresentation: { state: "anonymous" },
    });
    renderPage();

    await waitFor(() =>
      expect(analyticsMocks.capture).toHaveBeenCalledWith("pricing_viewed", {
        source_surface: "direct_pricing",
        presentation_state: "pricing",
        authentication_state: "logged_out",
        device_class: "desktop",
      }),
    );
    expect(
      analyticsMocks.capture.mock.calls.filter(
        ([event]) => event === "pricing_viewed",
      ),
    ).toHaveLength(1);
  });

  it("shows Free, Pro Monthly, and Pro Yearly together without a billing-period control", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Free" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Pro Monthly" })).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Pro Yearly" })).not.toBeNull();
    expect(screen.getByText("$6.99/month")).not.toBeNull();
    expect(screen.getByText("$6.99 charged every month.")).not.toBeNull();
    expect(screen.getByText("$4.99/month equivalent")).not.toBeNull();
    expect(screen.getByText("$59.88 charged once per year.")).not.toBeNull();
    expect(screen.getByText("Save 28%")).not.toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: /billing period/i }),
    ).toBeNull();
    expect(document.querySelectorAll("[data-pricing-card]")).toHaveLength(3);
    expect(screen.getByText("1 durable Project")).not.toBeNull();
    expect(
      screen.getAllByText(/unlimited Projects within technical and abuse limits/i),
    ).toHaveLength(2);
  });

  it("does not resolve account and Subscription state separately per card", () => {
    renderPage();

    expect(useUser).toHaveBeenCalledOnce();
    expect(useEntitlements).toHaveBeenCalledOnce();
  });

  it.each([
    ["monthly", "https://checkout.stripe.com/monthly"],
    ["yearly", "https://checkout.stripe.com/yearly"],
  ] as const)(
    "starts %s checkout with the matching plan",
    async (plan, checkoutUrl) => {
      (useUser as unknown as Mock).mockReturnValue({
        user: { id: "registered-1", is_anonymous: false },
        isLoading: false,
        error: null,
      });
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ url: checkoutUrl }), { status: 200 }),
        );
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: `Choose ${plan}` }));

      await waitFor(() => {
        const [, request] = fetchSpy.mock.calls[0] as [
          string,
          RequestInit,
        ];
        expect(request.method).toBe("POST");
        expect(request.headers).toEqual({
          "Content-Type": "application/json",
          "Idempotency-Key": expect.any(String),
        });
        expect(JSON.parse(request.body as string)).toEqual({
          plan,
          source_surface: "direct_pricing",
          device_class: "desktop",
          attempt_id: expect.any(String),
        });
        expect(window.location.assign).toHaveBeenCalledWith(checkoutUrl);
        expect(analyticsMocks.capture).toHaveBeenCalledWith(
          "checkout_started",
          {
            account_type: "free",
            source_surface: "direct_pricing",
            presentation_state: "upgrade_to_pro",
            authentication_state: "registered",
            device_class: "desktop",
            plan,
            billing_interval: plan,
          },
        );
        expect(analyticsMocks.capture).toHaveBeenCalledWith(
          "plan_choice_attempted",
          {
            source_surface: "direct_pricing",
            presentation_state: "upgrade_to_pro",
            authentication_state: "registered",
            device_class: "desktop",
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
        subscriptionPresentation: {
          state: "active_pro",
          plan: "yearly",
          renewsAt: "2027-09-01T00:00:00.000Z",
        },
      },
      subscriptionPresentation: {
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-09-01T00:00:00.000Z",
      },
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    renderPage();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Open Plan & Billing" })[0],
    );

    expect(await getRouterPush()).toHaveBeenCalledWith("/account/billing");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes both paid cards to account when a Pro subscriber's interval is unknown", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1 },
        subscriptionPresentation: {
          state: "active_pro",
          plan: null,
          renewsAt: null,
        },
      },
      subscriptionPresentation: {
        state: "active_pro",
        plan: null,
        renewsAt: null,
      },
    });
    renderPage();

    const manageButtons = screen.getAllByRole("button", {
      name: "Open Plan & Billing",
    });
    expect(manageButtons).toHaveLength(2);
    fireEvent.click(manageButtons[0]);

    expect(await getRouterPush()).toHaveBeenCalledWith("/account/billing");
  });

  it.each([
    {
      state: "active_pro" as const,
      presentation: {
        state: "active_pro" as const,
        plan: "monthly" as const,
        renewsAt: "2026-09-01T00:00:00.000Z",
      },
    },
    {
      state: "pro_pending_cancellation" as const,
      presentation: {
        state: "pro_pending_cancellation" as const,
        plan: "yearly" as const,
        accessEndsAt: "2027-09-01T00:00:00.000Z",
      },
    },
    {
      state: "billing_issue" as const,
      presentation: {
        state: "billing_issue" as const,
        plan: "monthly" as const,
      },
    },
  ])(
    "routes $state learners to Plan & Billing without offering checkout",
    async ({ presentation }) => {
      (useEntitlements as unknown as Mock).mockReturnValue({
        data: {
          tier: presentation.state === "billing_issue" ? "free" : "pro",
          caps: { summariesUsed: 0, summariesLimit: -1 },
          subscriptionPresentation: presentation,
        },
        subscriptionPresentation: presentation,
      });
      const fetchSpy = vi.spyOn(global, "fetch");
      renderPage();

      const managementActions = screen.getAllByRole("button", {
        name: /plan & billing/i,
      });
      expect(managementActions).toHaveLength(2);
      fireEvent.click(managementActions[0]);

      expect(await getRouterPush()).toHaveBeenCalledWith("/account/billing");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        analyticsMocks.capture.mock.calls.filter(
          ([event]) => event === "plan_choice_attempted",
        ),
      ).toHaveLength(1);
    },
  );

  it("sends an anonymous learner to signup for the selected interval", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "anon",
        caps: { summariesUsed: 0, summariesLimit: 1 },
        subscriptionPresentation: { state: "anonymous" },
      },
      subscriptionPresentation: { state: "anonymous" },
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

  it("preserves the selected plan and approved source through logged-out signup", async () => {
    window.history.replaceState(
      null,
      "",
      "/pricing?source_surface=global_header",
    );
    window.location.search = "?source_surface=global_header";
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "anon",
        caps: { summariesUsed: 0, summariesLimit: 1 },
        subscriptionPresentation: { state: "anonymous" },
      },
      subscriptionPresentation: { state: "anonymous" },
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /yearly/i }));

    const push = await getRouterPush();
    const destination = push.mock.calls.at(-1)?.[0] as string;
    const signupUrl = new URL(destination, "https://www.youtubeai.chat");
    const returnTo = signupUrl.searchParams.get("redirect_to");
    expect(signupUrl.pathname).toBe("/auth/sign-up");
    expect(returnTo).toBe(
      "/pricing?intent=upgrade&plan=yearly&source_surface=global_header",
    );
    expect(analyticsMocks.capture).toHaveBeenCalledWith(
      "plan_choice_attempted",
      {
        source_surface: "global_header",
        presentation_state: "pricing",
        authentication_state: "logged_out",
        device_class: "desktop",
        plan: "yearly",
        billing_interval: "yearly",
      },
    );
  });

  it("does not route while the learner's entitlements are still loading", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: undefined,
      isPending: true,
      subscriptionPresentation: { state: "loading" },
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

  it("keeps cached Free actions neutral until a fresh entitlement lookup completes", () => {
    const refetch = vi.fn().mockReturnValue(new Promise<never>(() => {}));
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "free",
        caps: { summariesUsed: 0, summariesLimit: 10 },
        subscriptionPresentation: { state: "free" },
      },
      isFetching: true,
      subscriptionPresentation: { state: "free" },
      refetch,
    });
    renderPage();

    expect(refetch).toHaveBeenCalledOnce();
    expect(
      screen.getAllByRole("button", { name: "Loading account status" }),
    ).toHaveLength(2);
    expect(
      (screen.getAllByRole("button", { name: "Loading account status" })[
        0
      ] as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("offers a retry when entitlements fail instead of loading forever", async () => {
    const refetch = vi.fn().mockResolvedValue({ data: undefined });
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isPending: false,
      refetch,
      subscriptionPresentation: { state: "lookup_failure" },
    });
    const fetchSpy = vi.spyOn(global, "fetch");
    renderPage();

    const retry = screen.getByRole("button", { name: "Try again" });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText(/couldn't safely determine/i)).not.toBeNull();
    fireEvent.click(retry);

    await waitFor(() => expect(refetch).toHaveBeenCalledOnce());
    expect(await getRouterPush()).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("attributes a registered lookup failure as registered, not logged out", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1" },
      isLoading: false,
      error: null,
    });
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      isPending: false,
      refetch: vi.fn().mockResolvedValue({ data: undefined }),
      subscriptionPresentation: { state: "lookup_failure" },
    });
    renderPage();

    await waitFor(() =>
      expect(analyticsMocks.capture).toHaveBeenCalledWith("pricing_viewed", {
        source_surface: "direct_pricing",
        presentation_state: "plans",
        authentication_state: "registered",
        device_class: "desktop",
      }),
    );
  });

  it("reports an attributed checkout failure and offers a retry without claiming checkout started", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "service_unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose yearly" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /checkout is temporarily unavailable/i,
      ),
    );
    expect(
      screen.getByRole("button", { name: "Try yearly again" }),
    ).not.toBeNull();
    expect(analyticsMocks.capture).toHaveBeenCalledWith("checkout_failed", {
      account_type: "free",
      source_surface: "direct_pricing",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "desktop",
      plan: "yearly",
      billing_interval: "yearly",
      failure_category: "service_unavailable",
      http_status: 503,
    });
    expect(analyticsMocks.capture).not.toHaveBeenCalledWith(
      "checkout_started",
      expect.anything(),
    );
  });

  it.each([
    {
      name: "authentication required",
      response: new Response(
        JSON.stringify({ code: "authentication_required" }),
        { status: 401 },
      ),
      title: /your account session changed/i,
      action: "Refresh account status",
    },
    {
      name: "ineligible subscription",
      response: new Response(
        JSON.stringify({ code: "subscription_ineligible" }),
        { status: 409 },
      ),
      title: /already have a subscription/i,
      action: "Open Plan & Billing",
    },
    {
      name: "invalid checkout response",
      response: new Response(
        JSON.stringify({ url: "https://example.com/not-stripe" }),
        { status: 200 },
      ),
      title: /couldn't start safely/i,
      action: "Try monthly again",
    },
  ])(
    "renders an actionable $name failure and never starts checkout",
    async ({ response, title, action }) => {
      (useUser as unknown as Mock).mockReturnValue({
        user: { id: "registered-1", is_anonymous: false },
        isLoading: false,
        error: null,
      });
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(global, "fetch").mockResolvedValueOnce(response);
      renderPage();

      fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(title),
      );
      expect(screen.getAllByRole("button", { name: action }).length).toBeGreaterThan(0);
      expect(analyticsMocks.capture).not.toHaveBeenCalledWith(
        "checkout_started",
        expect.anything(),
      );
      expect(analyticsMocks.capture).toHaveBeenCalledWith(
        "checkout_failed",
        expect.objectContaining({
          plan: "monthly",
          billing_interval: "monthly",
        }),
      );
    },
  );

  it("routes both Pro card actions to Plan & Billing after an ineligible response", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "subscription_ineligible" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /already have a subscription/i,
      ),
    );

    const yearlyCard = screen.getByRole("region", { name: "Pro Yearly" });
    const yearlyAction = within(yearlyCard).getByRole("button", {
      name: "Open Plan & Billing",
    });
    fireEvent.click(yearlyAction);
    expect(await getRouterPush()).toHaveBeenCalledWith("/account/billing");
    expect(analyticsMocks.capture).toHaveBeenCalledWith(
      "plan_choice_attempted",
      expect.objectContaining({
        plan: "yearly",
        presentation_state: "plans",
        authentication_state: "registered",
        source_surface: "direct_pricing",
      }),
    );
  });

  it("reports network failures with a retry action", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("offline"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose yearly" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /couldn't connect/i,
      ),
    );
    expect(screen.getByRole("button", { name: "Try yearly again" })).not.toBeNull();
    expect(analyticsMocks.capture).toHaveBeenCalledWith(
      "checkout_failed",
      expect.objectContaining({ failure_category: "network_error" }),
    );
  });

  it("reuses one attempt key when the first checkout response is lost", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/retry" }), {
          status: 200,
        }),
      );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose yearly" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try yearly again" })).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try yearly again" }));

    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/retry",
      ),
    );
    const firstRequest = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const secondRequest = fetchSpy.mock.calls[1]?.[1] as RequestInit;
    const firstAttempt = JSON.parse(firstRequest.body as string).attempt_id;
    const secondAttempt = JSON.parse(secondRequest.body as string).attempt_id;
    expect(firstAttempt).toBe(secondAttempt);
    expect(firstRequest.headers).toEqual({
      "Content-Type": "application/json",
      "Idempotency-Key": firstAttempt,
    });
    expect(secondRequest.headers).toEqual({
      "Content-Type": "application/json",
      "Idempotency-Key": secondAttempt,
    });
  });

  it("retains the attempt key after a service-unavailable 503 response", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "service_unavailable" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/retry" }), {
          status: 200,
        }),
      );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try monthly again" })).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try monthly again" }));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/retry",
      ),
    );

    const firstAttempt = JSON.parse(
      (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string,
    ).attempt_id;
    const secondAttempt = JSON.parse(
      (fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string,
    ).attempt_id;
    expect(secondAttempt).toBe(firstAttempt);
  });

  it("rotates the attempt key after a definitive 4xx response", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "invalid_request" }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/retry" }), {
          status: 200,
        }),
      );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try monthly again" })).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try monthly again" }));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/retry",
      ),
    );

    const firstAttempt = JSON.parse(
      (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string,
    ).attempt_id;
    const secondAttempt = JSON.parse(
      (fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string,
    ).attempt_id;
    expect(secondAttempt).not.toBe(firstAttempt);
  });

  it("retains the attempt key after an unsafe 2xx destination", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://example.com/not-stripe" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://checkout.stripe.com/retry" }), {
          status: 200,
        }),
      );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose monthly" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try monthly again" })).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try monthly again" }));
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        "https://checkout.stripe.com/retry",
      ),
    );

    const firstAttempt = JSON.parse(
      (fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string,
    ).attempt_id;
    const secondAttempt = JSON.parse(
      (fetchSpy.mock.calls[1]?.[1] as RequestInit).body as string,
    ).attempt_id;
    expect(secondAttempt).toBe(firstAttempt);
  });

  it("attributes anonymous-session choice separately from a logged-out visitor", async () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "anon-1", is_anonymous: true },
      isLoading: false,
      error: null,
    });
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "anon",
        caps: { summariesUsed: 0, summariesLimit: 1 },
        subscriptionPresentation: { state: "anonymous" },
      },
      subscriptionPresentation: { state: "anonymous" },
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Choose yearly" }));

    await waitFor(() =>
      expect(analyticsMocks.capture).toHaveBeenCalledWith(
        "plan_choice_attempted",
        expect.objectContaining({
          authentication_state: "anonymous_session",
          plan: "yearly",
        }),
      ),
    );
    expect((await getRouterPush()).mock.calls.at(-1)?.[0]).toContain(
      "/auth/sign-up",
    );
  });

  it("uses direct_pricing for an unapproved source and preserves a selected return intent", async () => {
    window.location.search =
      "?intent=upgrade&plan=yearly&source_surface=not-approved";
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "registered-1", is_anonymous: false },
      isLoading: false,
      error: null,
    });
    renderPage();

    expect(screen.getByText(/continue with pro yearly/i)).not.toBeNull();
    expect(screen.getByText(/you're signed in/i)).not.toBeNull();
    expect(analyticsMocks.capture).toHaveBeenCalledWith("pricing_viewed", {
      source_surface: "direct_pricing",
      presentation_state: "upgrade_to_pro",
      authentication_state: "registered",
      device_class: "desktop",
    });
  });

  it("explains a canceled Checkout return without changing plan state", () => {
    window.location.search = "?canceled=1";
    renderPage();

    expect(screen.getByRole("status").textContent).toMatch(
      /checkout was canceled/i,
    );
    expect(screen.getByRole("button", { name: "Choose monthly" })).not.toBeNull();
  });

  it("renders all five FAQ items", () => {
    renderPage();

    expect(
      screen.getAllByText(/What is included in each plan\?/i).length,
    ).toBeGreaterThan(0);
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

  it("links Pro management guidance to Plan & Billing and the Stripe portal flow", () => {
    renderPage();
    fireEvent.click(screen.getByText("Can I cancel anytime?"));

    const billingLink = screen.getByRole("link", { name: "Plan & Billing" });
    expect(billingLink.getAttribute("href")).toBe("/account/billing");
    expect(screen.getByText(/stripe customer portal/i)).not.toBeNull();
  });
});
