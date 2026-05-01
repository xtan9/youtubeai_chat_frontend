// @vitest-environment happy-dom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AccountView } from "../AccountView";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

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
  useUser: () => ({
    user: {
      id: "u1",
      is_anonymous: false,
      email: "test@example.com",
      user_metadata: { full_name: "Test User", avatar_url: undefined },
    },
    session: { access_token: "tok" },
  }),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

beforeEach(() => {
  signOutSpy.mockClear();
  mockPush.mockClear();
});

function freshQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function Wrapper({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("AccountView — profile card", () => {
  it("shows the user's email and display name", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText("Test User")).not.toBeNull();
    expect(screen.getByText("test@example.com")).not.toBeNull();
  });
});

describe("AccountView — Free plan", () => {
  it("renders Free plan label, usage line, and Upgrade CTA pointing to /pricing", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "free",
        caps: {
          summariesUsed: 3,
          summariesLimit: 10,
          historyUsed: 2,
          historyLimit: 10,
        },
      },
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
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
        subscription: {
          plan: "yearly",
          current_period_end: "2026-12-31T00:00:00.000Z",
          cancel_at_period_end: false,
        },
      },
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.getByText(/pro plan/i)).not.toBeNull();
    expect(screen.getByText(/billed yearly/i)).not.toBeNull();
    expect(screen.getByText(/renews on/i)).not.toBeNull();
    expect(screen.getByRole("button", { name: /manage subscription/i })).not.toBeNull();
  });

  it("shows a cancel-pending warning banner when cancel_at_period_end is true", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1, historyUsed: 0, historyLimit: -1 },
        subscription: {
          plan: "monthly",
          current_period_end: "2026-05-31T00:00:00.000Z",
          cancel_at_period_end: true,
        },
      },
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/will end on/i);
    expect(banner.textContent).toMatch(/billing portal/i);
  });

  it("does not render Free plan content for Pro users", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: {
        tier: "pro",
        caps: { summariesUsed: 0, summariesLimit: -1 },
        subscription: { plan: "monthly", current_period_end: null, cancel_at_period_end: false },
      },
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });
    expect(screen.queryByRole("link", { name: /upgrade to pro/i })).toBeNull();
  });
});

describe("AccountView — Sign Out", () => {
  it("calls supabase.auth.signOut and routes to / on click", async () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
    });
    const qc = freshQueryClient();
    render(<AccountView />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOutSpy).toHaveBeenCalled());
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });
});
