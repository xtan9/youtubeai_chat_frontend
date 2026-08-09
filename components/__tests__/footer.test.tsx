// @vitest-environment happy-dom
import { fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { Footer } from "../footer";

const analyticsMocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analyticsMocks.capture,
}));

vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({ user: null, isLoading: false }),
}));

beforeEach(() => {
  analyticsMocks.capture.mockReset();
  vi.stubGlobal("innerWidth", 1024);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      media: "(max-width: 767px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Footer", () => {
  it("is hidden on mobile and visible from the medium breakpoint", () => {
    const { container } = render(<Footer />);
    const footerClasses = container.querySelector("footer")?.className;

    expect(footerClasses).toContain("hidden");
    expect(footerClasses).toContain("md:block");
  });

  it("exposes a Contact mailto link to contact@youtubeai.chat", () => {
    render(<Footer />);
    const link = screen.getByRole("link", { name: /contact/i });
    expect(link.getAttribute("href")).toBe("mailto:contact@youtubeai.chat");
  });

  it("exposes Pricing with governed public-footer attribution", async () => {
    render(<Footer />);

    const link = screen.getByRole("link", { name: "Pricing" });
    expect(link.getAttribute("href")).toBe(
      "/pricing?source_surface=public_footer",
    );
    await waitFor(() =>
      expect(analyticsMocks.capture).toHaveBeenCalledWith(
        "subscription_discovery_viewed",
        {
          source_surface: "public_footer",
          presentation_state: "pricing",
          authentication_state: "logged_out",
          device_class: "desktop",
        },
      ),
    );

    fireEvent.click(link);
    expect(analyticsMocks.capture).toHaveBeenLastCalledWith(
      "subscription_discovery_clicked",
      {
        source_surface: "public_footer",
        presentation_state: "pricing",
        authentication_state: "logged_out",
        device_class: "desktop",
      },
    );
  });

  it("does not count the CSS-hidden mobile footer as a discovery view", async () => {
    vi.stubGlobal("innerWidth", 375);
    render(<Footer />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(analyticsMocks.capture).not.toHaveBeenCalled();
  });
});
