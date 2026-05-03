// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Header } from "../header";

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
});

describe("Header user menu", () => {
  // The dropdown is now tier-agnostic — Account + Sign Out, regardless
  // of Free vs Pro. The Stripe portal redirect lives on /account itself.
  it("dropdown has 'Account' link to /account and 'Sign Out' for any signed-in user", () => {
    const qc = freshQueryClient();
    render(<Header />, { wrapper: ({ children }) => <Wrapper qc={qc}>{children}</Wrapper> });

    openDropdown(screen.getByRole("button", { name: /user menu/i }));

    const account = screen.getByRole("menuitem", { name: /account/i });
    expect(account).not.toBeNull();
    const anchor = account.tagName.toLowerCase() === "a" ? account : account.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/account");
    expect(screen.queryByText(/manage subscription/i)).toBeNull();
    expect(screen.getByText(/sign out/i)).not.toBeNull();
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
});
