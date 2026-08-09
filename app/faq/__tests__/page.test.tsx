// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import FaqPage from "../page";

afterEach(cleanup);

describe("FaqPage", () => {
  it("renders truthful Free and Pro Plan guidance with real product destinations", () => {
    render(<FaqPage />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /what do the free plan and pro plan include/i,
      }),
    );

    expect(screen.getByText(/10 summaries per month/i)).not.toBeNull();
    expect(screen.getByText(/5 video chat messages per video/i)).not.toBeNull();
    expect(screen.getByText(/10-item history/i)).not.toBeNull();
    expect(screen.getByText(/\$6\.99 per month/i)).not.toBeNull();
    expect(screen.getByText(/\$4\.99 per month equivalent/i)).not.toBeNull();
    expect(screen.getByText(/\$59\.88 annually/i)).not.toBeNull();

    expect(
      screen.getByRole("link", { name: /compare plans on pricing/i }).getAttribute(
        "href",
      ),
    ).toBe("/pricing");
    expect(
      screen.getByRole("link", { name: /plan & billing/i }).getAttribute(
        "href",
      ),
    ).toBe("/account/billing");
    expect(screen.getByText(/stripe customer portal/i)).not.toBeNull();
  });
});
