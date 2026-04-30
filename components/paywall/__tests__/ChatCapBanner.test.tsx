// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { ChatCapBanner } from "../ChatCapBanner";

afterEach(cleanup);

describe("ChatCapBanner", () => {
  it("renders free-cap variant by default with /pricing link", () => {
    render(<ChatCapBanner />);
    expect(screen.getByText(/used 5\/5 free chat messages/i)).not.toBeNull();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/pricing");
  });

  it("renders anon-blocked variant with signup link", () => {
    render(<ChatCapBanner variant="anon-blocked" />);
    expect(screen.getByText(/sign up to chat/i)).not.toBeNull();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/auth/sign-up");
  });

  it("exposes the variant via data attribute", () => {
    const { container } = render(<ChatCapBanner variant="free-cap" />);
    expect(
      container.querySelector('[data-paywall-variant="chat-free-cap"]'),
    ).not.toBeNull();
  });

  it("exposes anon-blocked via data attribute", () => {
    const { container } = render(<ChatCapBanner variant="anon-blocked" />);
    expect(
      container.querySelector('[data-paywall-variant="chat-anon-blocked"]'),
    ).not.toBeNull();
  });
});
