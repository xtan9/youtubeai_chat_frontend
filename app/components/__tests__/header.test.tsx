// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Header } from "../header";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

afterEach(cleanup);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({
    user: { id: "u1", is_anonymous: false, email: "test@example.com" },
    session: { access_token: "tok" },
  }),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
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
  // Default: free tier — individual tests can override.
  (useEntitlements as unknown as Mock).mockReturnValue({
    data: { tier: "free", caps: { summariesUsed: 0, summariesLimit: 10 } },
  });
});

describe("Header user menu", () => {
  it("free tier — DropdownMenu has 'Account' link to /account and 'Sign Out'", () => {
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));

    const account = screen.getByRole("menuitem", { name: /account/i });
    expect(account).not.toBeNull();
    const anchor = account.tagName.toLowerCase() === "a" ? account : account.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/account");
    expect(screen.getByText(/sign out/i)).not.toBeNull();
  });

  it("pro tier — DropdownMenu has 'Account' and 'Sign Out' (no separate Manage Subscription item)", () => {
    (useEntitlements as unknown as Mock).mockReturnValue({
      data: { tier: "pro", caps: { summariesUsed: 0, summariesLimit: -1 } },
    });
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));

    expect(screen.getByRole("menuitem", { name: /account/i })).not.toBeNull();
    expect(screen.queryByText(/manage subscription/i)).toBeNull();
    expect(screen.getByText(/sign out/i)).not.toBeNull();
  });
});
