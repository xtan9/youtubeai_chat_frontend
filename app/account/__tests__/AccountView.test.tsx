// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AccountView } from "../AccountView";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { useUser } from "@/lib/contexts/user-context";

afterEach(cleanup);

const signOutSpy = vi.fn().mockResolvedValue({});
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: signOutSpy } }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: vi.fn(),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

const DEFAULT_USER = {
  id: "u1",
  is_anonymous: false,
  email: "test@example.com",
  user_metadata: { full_name: "Test User", avatar_url: undefined },
};

beforeEach(() => {
  signOutSpy.mockClear();
  mockPush.mockClear();
  // Default user; tests can override with mockReturnValueOnce / mockReturnValue
  (useUser as unknown as Mock).mockReturnValue({
    user: DEFAULT_USER,
    session: { access_token: "tok" },
  });
});

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setEntitlements(value: unknown) {
  (useEntitlements as unknown as Mock).mockReturnValue(value);
}

describe("AccountView — profile card", () => {
  it("shows the user's email and display name from full_name", () => {
    setEntitlements({
      data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText("Test User")).not.toBeNull();
    expect(screen.getByText("test@example.com")).not.toBeNull();
  });

  it("falls back to email-prefix when user_metadata.full_name is absent", () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "u2", is_anonymous: false, email: "alice@example.com", user_metadata: {} },
      session: { access_token: "tok" },
    });
    setEntitlements({
      data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText("alice")).not.toBeNull();
    expect(screen.getByText("alice@example.com")).not.toBeNull();
  });

  it("falls back to email-prefix when user_metadata is undefined", () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: { id: "u3", is_anonymous: false, email: "bob@example.com" },
      session: { access_token: "tok" },
    });
    setEntitlements({
      data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText("bob")).not.toBeNull();
  });
});

describe("AccountView — Free plan", () => {
  it("renders Free plan label, usage line, and Upgrade CTA pointing to /pricing", () => {
    setEntitlements({
      data: {
        tier: "free",
        caps: {
          summariesUsed: 3,
          summariesLimit: 10,
          historyUsed: 2,
          historyLimit: 10,
        },
      },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText(/free plan/i)).not.toBeNull();
    expect(screen.getByText(/3 of 10 summaries used this month/i)).not.toBeNull();
    expect(screen.getByText(/2 of 10 saved videos in history/i)).not.toBeNull();
    const upgrade = screen.getByRole("link", { name: /upgrade to pro/i });
    expect(upgrade.getAttribute("href")).toBe("/pricing");
  });
});

describe("AccountView — Pro plan", () => {
  it("renders Pro plan label, billing cadence, renewal date, and Manage Subscription button", () => {
    setEntitlements({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
        subscription: {
          plan: "yearly",
          current_period_end: "2026-12-31T00:00:00.000Z",
          cancel_at_period_end: false,
        },
      },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText(/pro plan/i)).not.toBeNull();
    expect(screen.getByText(/billed yearly/i)).not.toBeNull();
    expect(screen.getByText(/renews on/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: /manage subscription/i })).not.toBeNull();
  });

  it("shows a cancel-pending warning banner with the renewal date when present", () => {
    setEntitlements({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
        subscription: {
          plan: "monthly",
          current_period_end: "2026-05-31T00:00:00.000Z",
          cancel_at_period_end: true,
        },
      },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/will end on/i);
    expect(banner.textContent).toMatch(/billing portal/i);
    // Critical: when cancellation is pending, do NOT also render the
    // "Renews on …" line — that would contradict the banner.
    expect(screen.queryByText(/renews on/i)).toBeNull();
  });

  it("shows a cancel-pending banner without a date when current_period_end is missing", () => {
    setEntitlements({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
        subscription: {
          plan: "monthly",
          current_period_end: null,
          cancel_at_period_end: true,
        },
      },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/has been cancelled/i);
    expect(banner.textContent).toMatch(/end of the current billing period/i);
  });

  it("renders Manage Subscription button + syncing note when subscription metadata is missing (webhook-lag escape hatch)", () => {
    setEntitlements({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1 },
        subscription: null,
      },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByRole("button", { name: /manage subscription/i })).not.toBeNull();
    expect(screen.getByText(/still syncing/i)).not.toBeNull();
  });

  it("does not render Free plan content for Pro users", () => {
    setEntitlements({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1 },
        subscription: { plan: "monthly", current_period_end: null, cancel_at_period_end: false },
      },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.queryByRole("link", { name: /upgrade to pro/i })).toBeNull();
  });
});

describe("AccountView — entitlements loading and error states", () => {
  it("renders a plan-card skeleton while entitlements are pending", () => {
    setEntitlements({
      data: undefined,
      isPending: true,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    // The skeleton announces itself to assistive tech via role="status"
    // and aria-busy. We assert both the accessible name and the
    // testid so a future restyle that drops the a11y attrs fails.
    const skeleton = screen.getByRole("status", { name: /loading plan details/i });
    expect(skeleton.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByTestId("plan-card-skeleton")).not.toBeNull();
    // Sign out is always reachable.
    expect(screen.getByRole("button", { name: /sign out/i })).not.toBeNull();
  });

  it("renders an explicit error message when entitlements fetch errors", () => {
    setEntitlements({
      data: undefined,
      isPending: false,
      isError: true,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/couldn't load your plan details/i);
    expect(screen.getByRole("button", { name: /sign out/i })).not.toBeNull();
  });

  it("renders the error card on an unknown tier", () => {
    setEntitlements({
      data: { tier: "anon", caps: { summariesUsed: 0, summariesLimit: 1 } },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByRole("alert")).not.toBeNull();
  });
});

describe("AccountView — Sign Out", () => {
  it("calls supabase.auth.signOut and routes to / on click", async () => {
    setEntitlements({
      data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
      isPending: false,
      isError: false,
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOutSpy).toHaveBeenCalled());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });
});
