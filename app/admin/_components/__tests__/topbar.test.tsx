// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminTopbar } from "../topbar";

afterEach(cleanup);

const signOutSpy = vi.fn();
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: signOutSpy } }),
}));

vi.mock("../admin-context", () => ({
  useAdmin: () => ({ email: "admin@example.com" }),
}));

function openMenu() {
  const trigger = document.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="menu"]',
  );
  if (!trigger) throw new Error("admin avatar trigger not found");
  fireEvent.click(trigger);
}

beforeEach(() => {
  vi.clearAllMocks();
  signOutSpy.mockResolvedValue({ error: null });
});

describe("AdminTopbar sign out", () => {
  it("signs out only the current browser session before routing home", async () => {
    const { container } = render(<AdminTopbar />);
    expect(container).not.toBeNull();

    openMenu();
    fireEvent.click(screen.getByText(/^Sign out$/i));

    await waitFor(() => {
      expect(signOutSpy).toHaveBeenCalledWith({ scope: "local" });
      expect(mockPush).toHaveBeenCalledWith("/");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it("shows an actionable error when local sign out fails", async () => {
    signOutSpy.mockResolvedValueOnce({ error: new Error("Auth unavailable") });
    render(<AdminTopbar />);

    openMenu();
    fireEvent.click(screen.getByText(/^Sign out$/i));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't sign you out/i));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
