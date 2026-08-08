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
}));

import { LoginForm } from "../login-form";

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
  mocks.signInWithOAuth.mockReset();
  mocks.push.mockReset();
});

afterEach(cleanup);

describe("LoginForm", () => {
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
});
