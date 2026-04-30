// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { UpgradeCard } from "../UpgradeCard";

describe("UpgradeCard", () => {
  it("renders the summary-cap variant copy + CTAs", () => {
    render(<UpgradeCard variant="summary-cap" />);
    // getByText throws if not found — that IS the assertion
    expect(screen.getByText(/used your 10 free summaries/i)).not.toBeNull();
    // Two upgrade-route links (primary + secondary)
    const links = screen.getAllByRole("link");
    const upgradeLinks = links.filter((a) => a.getAttribute("href") === "/pricing");
    expect(upgradeLinks.length).toBeGreaterThanOrEqual(1);
  });

  it("renders the chat-cap variant copy", () => {
    render(<UpgradeCard variant="chat-cap" />);
    expect(screen.getByText(/free chat messages on this video/i)).not.toBeNull();
  });

  it("renders the history-cap variant copy", () => {
    render(<UpgradeCard variant="history-cap" />);
    expect(screen.getByText(/older summaries auto-replaced/i)).not.toBeNull();
    expect(screen.getByText(/unlimited history/i)).not.toBeNull();
  });

  it("exposes the variant via data attribute (for paywall analytics later)", () => {
    const { container } = render(<UpgradeCard variant="summary-cap" />);
    expect(container.querySelector('[data-paywall-variant="summary-cap"]')).not.toBeNull();
  });
});
