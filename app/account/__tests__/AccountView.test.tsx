// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AccountView } from "../AccountView";
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

const DEFAULT_USER = {
  id: "u1",
  is_anonymous: false,
  email: "test@example.com",
  user_metadata: { full_name: "Test User", avatar_url: undefined },
};

beforeEach(() => {
  signOutSpy.mockClear();
  signOutSpy.mockResolvedValue({});
  mockPush.mockClear();
  (useUser as unknown as Mock).mockReturnValue({
    user: DEFAULT_USER,
    session: { access_token: "tok" },
  });
});

describe("AccountView identity boundary", () => {
  it("shows the Learner's display name and email", () => {
    render(<AccountView />);

    expect(screen.getByRole("heading", { name: "Account" })).not.toBeNull();
    expect(screen.getByText("Test User")).not.toBeNull();
    expect(screen.getByText("test@example.com")).not.toBeNull();
  });

  it("falls back to the email prefix when a display name is absent", () => {
    (useUser as unknown as Mock).mockReturnValue({
      user: {
        id: "u2",
        is_anonymous: false,
        email: "alice@example.com",
        user_metadata: {},
      },
      session: { access_token: "tok" },
    });

    render(<AccountView />);

    expect(screen.getByText("alice")).not.toBeNull();
    expect(screen.getByText("alice@example.com")).not.toBeNull();
  });

  it("keeps plan management out of Account", () => {
    render(<AccountView />);

    expect(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    ).not.toBeNull();
    expect(screen.queryByText(/free plan|pro plan/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /upgrade to pro/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /manage subscription/i }),
    ).toBeNull();
  });
});

describe("AccountView session security boundary", () => {
  it("signs out only the current browser and returns home", async () => {
    render(<AccountView />);

    fireEvent.click(screen.getByRole("button", { name: /^sign out$/i }));

    await waitFor(() =>
      expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("keeps Account actionable when local sign out fails", async () => {
    signOutSpy.mockResolvedValueOnce({ error: new Error("Auth unavailable") });
    render(<AccountView />);

    fireEvent.click(screen.getByRole("button", { name: /^sign out$/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /couldn't sign you out/i,
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /^sign out$/i }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("offers a separate global sign-out action", async () => {
    render(<AccountView />);

    fireEvent.click(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    );

    await waitFor(() =>
      expect(signOutSpy).toHaveBeenCalledWith({ scope: "global" }),
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("explains the short-lived access-token window on other devices", () => {
    render(<AccountView />);

    expect(
      screen.getByText(
        /other devices may remain active until their already-issued short-lived access tokens expire/i,
      ),
    ).not.toBeNull();
  });

  it("reports a global sign-out failure and allows retry", async () => {
    signOutSpy.mockResolvedValueOnce({ error: new Error("Auth unavailable") });
    render(<AccountView />);

    fireEvent.click(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(
        /couldn't confirm that your other sessions were revoked.*try again/i,
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: /sign out everywhere/i }),
    );
    await waitFor(() => expect(signOutSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });
});
