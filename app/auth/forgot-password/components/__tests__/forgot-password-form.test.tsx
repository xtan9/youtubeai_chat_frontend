// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { ForgotPasswordForm } from "../forgot-password-form";

afterEach(cleanup);

describe("ForgotPasswordForm navigation", () => {
  it("keeps the selected plan when returning to login", () => {
    window.history.replaceState({}, "", "/auth/forgot-password?redirect_to=%2Fpricing%3Fintent%3Dupgrade%26plan%3Dmonthly");
    render(<ForgotPasswordForm />);

    const login = new URL(
      screen.getByRole("link", { name: "Login" }).getAttribute("href")!,
      window.location.origin,
    );
    expect(login.pathname).toBe("/auth/login");
    expect(login.searchParams.get("redirect_to")).toBe("/pricing?intent=upgrade&plan=monthly");
  });
});
