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
  push: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signUp: mocks.signUp,
      signInWithOAuth: vi.fn(),
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
  mocks.push.mockReset();
  mocks.capture.mockReset();
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

describe("SignUpForm analytics", () => {
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
