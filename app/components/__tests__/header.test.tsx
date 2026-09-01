// @vitest-environment happy-dom
import { act, render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { axe } from "@/tests-utils/axe";
import { Header } from "../header";
import { setBillingActivationOutcome } from "@/lib/billing/activation-pending";
import { CheckoutActivationGuard } from "../checkout-activation-guard";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

const {
  analyticsCapture,
  mockPush,
  navigationState,
  signOutSpy,
  useEntitlementsMock,
  userState,
} = vi.hoisted(() => ({
  analyticsCapture: vi.fn(),
  mockPush: vi.fn(),
  navigationState: {
    suspendSearchParams: false,
    pendingSearchParams: new Promise<never>(() => {}),
  },
  signOutSpy: vi.fn(),
  useEntitlementsMock: vi.fn(),
  userState: {
    value: {
      user: {
        id: "u1",
        is_anonymous: false,
        email: "test@example.com",
        app_metadata: { project_beta_access: "invited" },
      } as {
        id: string;
        is_anonymous: boolean;
        email?: string;
        app_metadata?: Record<string, unknown>;
      } | null,
      session: { access_token: "tok" } as { access_token: string } | null,
      isLoading: false,
      error: null as Error | null,
    },
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => {
    if (navigationState.suspendSearchParams) {
      throw navigationState.pendingSearchParams;
    }
    return new URLSearchParams(window.location.search);
  },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: signOutSpy },
  }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => userState.value,
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: useEntitlementsMock,
}));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analyticsCapture,
}));

vi.mock("@/components/profile-avatar", () => ({
  ProfileAvatar: () => <span>Avatar</span>,
}));

vi.mock("@/components/theme-switcher", () => ({
  ThemeSwitcher: () => null,
}));

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// Radix DropdownMenu requires the full pointer event sequence to open.
function openDropdown(trigger: Element) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.pointerUp(trigger, { button: 0, pointerType: "mouse" });
  fireEvent.click(trigger);
}

beforeEach(() => {
  vi.clearAllMocks();
  navigationState.suspendSearchParams = false;
  signOutSpy.mockResolvedValue({ error: null });
  userState.value = {
    user: {
      id: "u1",
      is_anonymous: false,
      email: "test@example.com",
      app_metadata: { project_beta_access: "invited" },
    },
    session: { access_token: "tok" },
    isLoading: false,
    error: null,
  };
  useEntitlementsMock.mockReturnValue({
    subscriptionPresentation: { state: "free" },
  });
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

describe("Header navigation", () => {
  it("keeps Blog and FAQ out of the header", () => {
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(screen.queryByRole("link", { name: "Blog" })).toBeNull();
    expect(screen.queryByRole("link", { name: "FAQ" })).toBeNull();
  });

  it("shows Workspace navigation to every registered Researcher", () => {
    userState.value = {
      ...userState.value,
      user: {
        id: "uninvited-1",
        is_anonymous: false,
        email: "uninvited@example.com",
        app_metadata: {},
      },
    };
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(screen.getByRole("link", { name: "Workspace" })).not.toBeNull();
    openDropdown(screen.getByRole("button", { name: /user menu/i }));
    expect(screen.getByRole("menuitem", { name: "Workspace" })).not.toBeNull();
    expect(screen.getByRole("menuitem", { name: "Account" })).not.toBeNull();
  });

  it("shows the uniformly gated Channel destination on desktop and mobile", () => {
    const qc = freshQueryClient();
    render(<Header channelReleaseStatus="open" />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(screen.getByRole("link", { name: "Channel" }).getAttribute("href"))
      .toBe("/channel");
    openDropdown(screen.getByRole("button", { name: /open navigation menu/i }));
    expect(screen.getAllByRole("link", { name: "Channel" })).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: "Channel" })[1].getAttribute("href"),
    ).toBe("/channel");
  });

  it("does not expose Channel navigation while the launch packet is blocked", () => {
    const qc = freshQueryClient();
    render(<Header channelReleaseStatus="blocked" />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(screen.queryByRole("link", { name: "Channel" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /open navigation menu/i }),
    ).not.toBeNull();
  });
});

describe("Header plan control", () => {
  it.each([
    {
      name: "logged-out learner",
      user: null,
      authenticationState: "logged_out",
    },
    {
      name: "anonymous-session learner",
      user: {
        id: "anon-1",
        is_anonymous: true,
        email: undefined,
      },
      authenticationState: "anonymous_session",
    },
  ])("shows attributed Pricing for a $name", async ({ user, authenticationState }) => {
    userState.value = {
      user,
      session: user ? { access_token: "anon-token" } : null,
      isLoading: false,
      error: null,
    };
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    const pricing = screen.getByRole("link", { name: "Pricing" });
    expect(pricing.getAttribute("href")).toBe(
      "/pricing?source_surface=global_header",
    );
    expect(useEntitlementsMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(analyticsCapture).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        {
          source_surface: "global_header",
          presentation_state: "pricing",
          authentication_state: authenticationState,
          device_class: "desktop",
        },
      ),
    );
  });

  it.each([
    {
      name: "Free Plan",
      presentation: { state: "free" } as const,
      label: "Upgrade to Pro",
      href: "/pricing?source_surface=global_header",
      analyticsState: "upgrade_to_pro",
    },
    {
      name: "active Pro Plan",
      presentation: {
        state: "active_pro",
        plan: "monthly",
        renewsAt: "2026-09-01T00:00:00.000Z",
      } as const,
      label: "Pro Plan",
      href: "/account/billing",
      analyticsState: "pro_plan",
    },
    {
      name: "pending-cancellation Pro Plan",
      presentation: {
        state: "pro_pending_cancellation",
        plan: "yearly",
        accessEndsAt: "2027-01-01T00:00:00.000Z",
      } as const,
      label: "Pro Plan",
      href: "/account/billing",
      analyticsState: "pro_plan",
    },
    {
      name: "recoverable billing issue",
      presentation: {
        state: "billing_issue",
        plan: "monthly",
      } as const,
      label: "Billing issue",
      href: "/account/billing",
      analyticsState: "billing_issue",
    },
    {
      name: "lookup failure",
      presentation: { state: "lookup_failure" } as const,
      label: "Plans",
      href: "/pricing?source_surface=global_header",
      analyticsState: "plans",
    },
  ])(
    "shows the truthful registered control for $name",
    async ({ presentation, label, href, analyticsState }) => {
      useEntitlementsMock.mockReturnValue({
        subscriptionPresentation: presentation,
      });
      const qc = freshQueryClient();
      render(<Header />, {
        wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
      });

      const control = screen.getByRole("link", { name: label });
      expect(control.getAttribute("href")).toBe(href);
      await waitFor(() =>
        expect(analyticsCapture).toHaveBeenCalledWith(
          "subscription_discovery_viewed",
          {
            source_surface: "global_header",
            presentation_state: analyticsState,
            authentication_state: "registered",
            device_class: "desktop",
          },
        ),
      );

      fireEvent.click(control);
      expect(analyticsCapture).toHaveBeenLastCalledWith(
        "subscription_discovery_clicked",
        {
          source_surface: "global_header",
          presentation_state: analyticsState,
          authentication_state: "registered",
          device_class: "desktop",
        },
      );
    },
  );

  it("reserves plan-control space while auth resolves", () => {
    userState.value = {
      user: null,
      session: null,
      isLoading: true,
      error: null,
    };
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    const loading = screen.getByRole("status", {
      name: "Loading plan status",
    });
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByRole("link", { name: "Pricing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
    expect(analyticsCapture).not.toHaveBeenCalled();
  });

  it("reserves plan-control space while checkout-return route state resolves", () => {
    navigationState.suspendSearchParams = true;
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(
      screen.getByRole("status", { name: "Loading plan status" }),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Pricing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
    expect(analyticsCapture).not.toHaveBeenCalled();
  });

  it("never flashes a Free action while a registered Pro lookup resolves", () => {
    useEntitlementsMock.mockReturnValue({
      subscriptionPresentation: { state: "loading" },
    });
    const qc = freshQueryClient();
    const rendered = render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(
      screen.getByRole("status", { name: "Loading plan status" }),
    ).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
    expect(analyticsCapture).not.toHaveBeenCalled();

    useEntitlementsMock.mockReturnValue({
      subscriptionPresentation: {
        state: "active_pro",
        plan: "yearly",
        renewsAt: "2027-01-01T00:00:00.000Z",
      },
    });
    rendered.rerender(<Header />);

    expect(screen.getByRole("link", { name: "Pro Plan" })).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Upgrade to Pro" })).toBeNull();
  });

  it("keeps an auth failure neutral and out of discovery analytics", async () => {
    userState.value = {
      user: null,
      session: null,
      isLoading: false,
      error: new Error("auth unavailable"),
    };
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(screen.getByRole("link", { name: "Plans" })).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyticsCapture).not.toHaveBeenCalled();
  });

  it("uses native link semantics, visible keyboard focus, and accessible markup", async () => {
    useEntitlementsMock.mockReturnValue({
      subscriptionPresentation: {
        state: "billing_issue",
        plan: "monthly",
      },
    });
    const qc = freshQueryClient();
    const { container } = render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    const control = screen.getByRole("link", { name: "Billing issue" });
    control.focus();
    expect(document.activeElement).toBe(control);
    expect(control.className).toContain("focus-visible:ring");
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Header checkout activation guard", () => {
  it("suppresses purchase children in checkout-return server HTML", () => {
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_return",
    );

    const html = renderToString(
      <CheckoutActivationGuard>
        <a href="/pricing">Upgrade to Pro</a>
      </CheckoutActivationGuard>,
    );

    expect(html).toContain("Activating Pro");
    expect(html).not.toContain("Upgrade to Pro");
  });

  it("renders an actionless return status only until activation is terminal", () => {
    window.history.replaceState(
      null,
      "",
      "/billing/success?session_id=cs_test_return",
    );
    const qc = freshQueryClient();
    render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    expect(screen.getByRole("status").textContent).toBe("Activating Pro");
    expect(
      screen.queryByRole("link", { name: /pricing|upgrade|checkout|choose/i }),
    ).toBeNull();

    act(() => setBillingActivationOutcome("cs_test_return", "active"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Header user menu", () => {
  it("keeps Account and Plan & Billing as separate destinations", () => {
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));

    const account = screen.getByRole("menuitem", { name: "Account" });
    expect(account).not.toBeNull();
    const anchor = account.tagName.toLowerCase() === "a" ? account : account.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/account");
    const billing = screen.getByRole("menuitem", { name: "Plan & Billing" });
    const billingAnchor =
      billing.tagName.toLowerCase() === "a"
        ? billing
        : billing.querySelector("a");
    expect(billingAnchor?.getAttribute("href")).toBe("/account/billing");
    expect(screen.queryByText(/manage subscription/i)).toBeNull();
    expect(screen.getByText(/sign out/i)).not.toBeNull();
  });

  it("signs out only the current Remembered Session", async () => {
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => {
      expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" });
    });
  });

  it("leaves the dashboard for the homepage after successful sign out", async () => {
    window.history.replaceState(null, "", "/dashboard");
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("keeps the header actionable when local sign out fails", async () => {
    signOutSpy.mockResolvedValueOnce({ error: new Error("Auth unavailable") });
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't sign you out/i));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("Header brand link", () => {
  // Pins the home link's a11y label, target, and that *both* visual
  // elements of the lockup render — the YT AI mark (svg + aria-label)
  // and the "YouTube AI Chat" wordmark. A future accidental swap-out of
  // YtAiMark, or a regression that drops the wordmark span, would fail
  // here without us having to look at a screenshot.
  it("renders the brand link with the YT AI mark and the 'YouTube AI Chat' wordmark", () => {
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    const home = screen.getByRole("link", { name: /youtube ai chat home/i });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.querySelector('svg[aria-label="YT AI"]')).not.toBeNull();
    expect(home.textContent).toContain("YouTube AI Chat");
  });

  it("scrolls with the page instead of sticking to the viewport", () => {
    const qc = freshQueryClient();
    const { container } = render(<Header />, {
      wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper>,
    });

    const header = container.querySelector("header");
    expect(header?.classList.contains("sticky")).toBe(false);
    expect(header?.classList.contains("top-0")).toBe(false);
  });
});
