// @vitest-environment happy-dom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { HistoryFreeBanner } from "../HistoryFreeBanner";

afterEach(cleanup);

describe("HistoryFreeBanner", () => {
  it("renders under-cap copy without auto-replaced text", () => {
    render(<HistoryFreeBanner used={5} limit={10} />);
    expect(screen.getByText(/showing 5 of 10/i)).not.toBeNull();
    expect(screen.queryByText(/auto-replaced/i)).toBeNull();
  });

  it("renders at-cap copy with auto-replaced text", () => {
    render(<HistoryFreeBanner used={10} limit={10} />);
    expect(screen.getByText(/showing 10 of 10/i)).not.toBeNull();
    expect(screen.getByText(/auto-replaced/i)).not.toBeNull();
  });

  it("clamps used > limit via Math.min", () => {
    render(<HistoryFreeBanner used={12} limit={10} />);
    // Should show 10 (clamped), not 12
    const banner = screen.getByText(/showing 10 of 10/i);
    expect(banner).not.toBeNull();
    // Also shows the auto-replaced text since 12 >= 10
    expect(screen.getByText(/auto-replaced/i)).not.toBeNull();
  });

  it("provides an upgrade link to /pricing", () => {
    render(<HistoryFreeBanner used={3} limit={10} />);
    const link = screen.getByRole("link", { name: /upgrade for unlimited history/i });
    expect(link.getAttribute("href")).toBe("/pricing");
  });

  it("exposes the paywall variant data attribute", () => {
    const { container } = render(<HistoryFreeBanner used={5} limit={10} />);
    expect(
      container.querySelector('[data-paywall-variant="history-free-banner"]'),
    ).not.toBeNull();
  });
});
