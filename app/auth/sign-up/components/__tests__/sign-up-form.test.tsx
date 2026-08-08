// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
  push: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithOAuth: mocks.signInWithOAuth,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: mocks.capture,
}));

import { SignUpForm } from "../sign-up-form";

beforeEach(() => {
  mocks.signUp.mockReset();
  mocks.signInWithOAuth.mockReset();
  mocks.push.mockReset();
  mocks.capture.mockReset();
  window.history.replaceState({}, "", "/auth/sign-up");
});

afterEach(cleanup);

function submitValidForm() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret123" },
  });
  fireEvent.change(screen.getByLabelText("Repeat Password"), {
    target: { value: "secret123" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^sign up$/i }));
}

function setSignupLocation(redirectTo?: string) {
  const search = redirectTo
    ? `?redirect_to=${encodeURIComponent(redirectTo)}`
    : "";
  window.history.replaceState({}, "", `/auth/sign-up${search}`);
}

describe("SignUpForm analytics", () => {
  it("sends email confirmation to /auth/callback with the default dashboard destination", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { identities: [{ id: "identity-1" }] },
        session: null,
      },
      error: null,
    });
    render(<SignUpForm />);

    submitValidForm();

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled());

    const request = mocks.signUp.mock.calls[0][0];
    const emailRedirect = new URL(request.options.emailRedirectTo);
    expect(emailRedirect.pathname).toBe("/auth/callback");
    expect(emailRedirect.searchParams.get("next")).toBe("/dashboard");
    expect(request.options.emailRedirectTo).not.toContain("/protected");
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/auth/sign-up-success"),
    );
  });

  it("preserves the pricing intent for email confirmation and an immediate session", async () => {
    setSignupLocation("/pricing?intent=upgrade");
    mocks.signUp.mockResolvedValue({
      data: {
        user: { identities: [{ id: "identity-1" }] },
        session: { access_token: "access-token" },
      },
      error: null,
    });
    render(<SignUpForm />);

    submitValidForm();

    await waitFor(() => expect(mocks.signUp).toHaveBeenCalled());

    const request = mocks.signUp.mock.calls[0][0];
    const emailRedirect = new URL(request.options.emailRedirectTo);
    expect(emailRedirect.pathname).toBe("/auth/callback");
    expect(emailRedirect.searchParams.get("next")).toBe(
      "/pricing?intent=upgrade",
    );
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/pricing?intent=upgrade"),
    );
    expect(mocks.push).not.toHaveBeenCalledWith("/auth/sign-up-success");
  });

  it("includes the safe pricing intent in the Google OAuth callback URL", async () => {
    setSignupLocation("/pricing?intent=upgrade");
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    render(<SignUpForm />);

    fireEvent.click(screen.getByRole("button", { name: "Google" }));

    await waitFor(() => expect(mocks.signInWithOAuth).toHaveBeenCalled());

    const request = mocks.signInWithOAuth.mock.calls[0][0];
    const oauthRedirect = new URL(request.options.redirectTo);
    expect(oauthRedirect.pathname).toBe("/auth/callback");
    expect(oauthRedirect.searchParams.get("next")).toBe(
      "/pricing?intent=upgrade",
    );
  });

  it("captures signup_completed only when Supabase returns a created identity", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { identities: [{ id: "identity-1" }] },
        session: null,
      },
      error: null,
    });
    render(<SignUpForm />);

    submitValidForm();

    await waitFor(() =>
      expect(mocks.capture).toHaveBeenCalledWith("signup_completed", {
        auth_method: "email",
        email_confirmation_required: true,
        source_surface: "sign_up_form",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/auth/sign-up-success");
  });

  it("does not count an obfuscated existing-user response as a signup", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { identities: [] },
        session: null,
      },
      error: null,
    });
    render(<SignUpForm />);

    submitValidForm();

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith("/auth/sign-up-success"),
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
