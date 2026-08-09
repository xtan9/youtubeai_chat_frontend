// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureAnalyticsEvent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent,
}));

import { AnonSignupWall } from "../AnonSignupWall";

beforeEach(() => {
  captureAnalyticsEvent.mockReset();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("preserves a safe homepage return and attributes the Summary limit action", () => {
    render(<AnonSignupWall />);

    expect(captureAnalyticsEvent).toHaveBeenCalledWith(
      "subscription_discovery_viewed",
      {
        source_surface: "summary_limit",
        presentation_state: "pricing",
        authentication_state: "anonymous_session",
        device_class: "desktop",
      },
    );

    const signupLink = screen.getByRole("link", { name: /sign up free/i });
    const href = new URL(
      signupLink.getAttribute("href")!,
      "https://example.test",
    );
    expect(href.searchParams.get("redirect_to")).toBe("/");

    fireEvent.click(signupLink);
    expect(captureAnalyticsEvent).toHaveBeenLastCalledWith(
      "subscription_discovery_clicked",
      expect.objectContaining({ source_surface: "summary_limit" }),
    );
  });

  it("exposes the reason via data attribute", () => {
    const { container } = render(<AnonSignupWall reason="hit-cap" />);
    expect(
      container.querySelector('[data-paywall-variant="anon-hit-cap"]'),
    ).not.toBeNull();
  });
});
