// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePasswordForm } from "../update-password-form";

afterEach(cleanup);

const updateUserSpy = vi.fn();
const signOutSpy = vi.fn();
const setSessionSpy = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      setSession: setSessionSpy,
      updateUser: updateUserSpy,
      signOut: signOutSpy,
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  updateUserSpy.mockResolvedValue({ error: null });
  signOutSpy.mockResolvedValue({ error: null });
  setSessionSpy.mockResolvedValue({ error: null });
  window.history.replaceState(null, "", "/auth/update-password");
});

function enterPassword() {
  fireEvent.change(screen.getByLabelText(/new password/i), {
    target: { value: "A-new-password-123!" },
  });
  fireEvent.click(screen.getByRole("button", { name: /save new password/i }));
}

describe("UpdatePasswordForm recovery session", () => {
  it("keeps the recovery session while revoking other sessions", async () => {
    render(<UpdatePasswordForm />);

    enterPassword();

    await waitFor(() => {
      expect(updateUserSpy).toHaveBeenCalledWith({ password: "A-new-password-123!" });
      expect(signOutSpy).toHaveBeenCalledWith({ scope: "others" });
      expect(mockPush).toHaveBeenCalledWith("/");
    });
    expect(updateUserSpy.mock.invocationCallOrder[0]).toBeLessThan(
      signOutSpy.mock.invocationCallOrder[0],
    );
  });

  it("reports password-update failure without attempting session revocation", async () => {
    updateUserSpy.mockResolvedValueOnce({ error: new Error("Password rejected") });
    render(<UpdatePasswordForm />);

    enterPassword();

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/password rejected/i));
    expect(signOutSpy).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("preserves the recovery session and offers global sign out after partial failure", async () => {
    signOutSpy.mockResolvedValueOnce({ error: new Error("Other-session revoke failed") });
    render(<UpdatePasswordForm />);

    enterPassword();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/password was changed/i);
      expect(screen.getByRole("button", { name: /sign out everywhere/i })).not.toBeNull();
    });
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /sign out everywhere/i }));

    await waitFor(() => {
      expect(signOutSpy).toHaveBeenNthCalledWith(2, { scope: "global" });
      expect(mockPush).toHaveBeenCalledWith("/");
    });
  });

  it("offers global sign out when other-session revocation throws", async () => {
    signOutSpy.mockRejectedValueOnce(new Error("Other-session revoke unavailable"));
    render(<UpdatePasswordForm />);

    enterPassword();

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/password was changed/i);
      expect(screen.getByRole("button", { name: /sign out everywhere/i })).not.toBeNull();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
