// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { AnonSignupWall } from "../AnonSignupWall";

afterEach(cleanup);

describe("AnonSignupWall", () => {
  it("renders hit-cap copy by default", () => {
    render(<AnonSignupWall />);
    expect(screen.getByText(/try unlimited free/i)).not.toBeNull();
  });

  it("renders feature-locked variant", () => {
    render(<AnonSignupWall reason="feature-locked" />);
    expect(screen.getByText(/sign up to keep using/i)).not.toBeNull();
  });

  it("provides both signup and login links", () => {
    render(<AnonSignupWall />);
    const links = screen.getAllByRole("link");
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.startsWith("/auth/sign-up"))).toBe(true);
    expect(hrefs.some((h) => h?.startsWith("/auth/login"))).toBe(true);
  });

  it("exposes the reason via data attribute", () => {
    const { container } = render(<AnonSignupWall reason="hit-cap" />);
    expect(
      container.querySelector('[data-paywall-variant="anon-hit-cap"]'),
    ).not.toBeNull();
  });
});
