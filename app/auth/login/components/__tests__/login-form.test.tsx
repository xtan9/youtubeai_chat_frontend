// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOAuth: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signInWithOAuth: mocks.signInWithOAuth,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { LoginForm } from "../login-form";

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
  mocks.signInWithOAuth.mockReset();
  mocks.push.mockReset();
  window.history.replaceState({}, "", "/auth/login");
});

afterEach(cleanup);

describe("LoginForm", () => {
  it("keeps the selected plan in the Google login callback", async () => {
    window.history.replaceState({}, "", "/auth/login?redirect_to=%2Fpricing%3Fintent%3Dupgrade%26plan%3Dyearly");
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    render(<LoginForm />);

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalled());
    const callback = new URL(mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("next")).toBe("/pricing?intent=upgrade&plan=yearly");
  });

  it("keeps the selected plan through password login and alternate auth links", async () => {
    window.history.replaceState({}, "", "/auth/login?redirect_to=%2Fpricing%3Fintent%3Dupgrade%26plan%3Dmonthly%26source_surface%3Dglobal_header");
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm />);

    for (const [name, pathname] of [
      ["Sign up", "/auth/sign-up"],
      ["Forgot your password?", "/auth/forgot-password"],
    ]) {
      const link = new URL(
        screen.getByRole("link", { name }).getAttribute("href")!,
        window.location.origin,
      );
      expect(link.pathname).toBe(pathname);
      expect(link.searchParams.get("redirect_to")).toBe(
        "/pricing?intent=upgrade&plan=monthly&source_surface=global_header",
      );
    }

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "learner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^login$/i }));

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/pricing?intent=upgrade&plan=monthly&source_surface=global_header",
      ),
    );
  });

  it("redirects a successful password login to the dashboard", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "learner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^login$/i }));

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/dashboard"),
    );
    expect(mocks.push).not.toHaveBeenCalledWith("/");
  });

  it.each([
    "https://outside.example/account",
    "//outside.example/account",
    "/\\outside.example/account",
  ])("does not follow an unsafe return destination: %s", async (redirectTo) => {
    window.history.replaceState({}, "", `/auth/login?redirect_to=${encodeURIComponent(redirectTo)}`);
    mocks.signInWithPassword.mockResolvedValue({ error: null });
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    render(<LoginForm />);

    for (const name of ["Sign up", "Forgot your password?"]) {
      const link = new URL(
        screen.getByRole("link", { name }).getAttribute("href")!,
        window.location.origin,
      );
      expect(link.searchParams.get("redirect_to")).toBe("/dashboard");
    }

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "learner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery staple" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^login$/i }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));

    fireEvent.click(screen.getByRole("button", { name: "Google" }));
    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalled());
    const callback = new URL(mocks.signInWithOAuth.mock.calls[0][0].options.redirectTo);
    expect(callback.searchParams.get("next")).toBe("/dashboard");
  });
});
