// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "@/tests-utils/renderWithProviders";
import { FAQ } from "../faq";

describe("homepage FAQ", () => {
  it("renders the live Free and Pro Plan limits, prices, and Pricing destination", () => {
    renderWithProviders(<FAQ />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /what's included in the free plan and pro plan/i,
      }),
    );

    expect(screen.getByText(/10 summaries per month/i)).not.toBeNull();
    expect(screen.getByText(/5 video chat messages per video/i)).not.toBeNull();
    expect(screen.getByText(/10-item history/i)).not.toBeNull();
    expect(screen.getByText(/\$6\.99 per month/i)).not.toBeNull();
    expect(screen.getByText(/\$4\.99 per month equivalent/i)).not.toBeNull();
    expect(screen.getByText(/\$59\.88 annually/i)).not.toBeNull();

    const pricingLink = screen.getByRole("link", { name: /view pricing/i });
    expect(pricingLink.getAttribute("href")).toBe("/pricing");
  });
});
