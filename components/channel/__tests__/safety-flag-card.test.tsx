// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { axe } from "@/tests-utils/axe";
import { SafetyFlagCard } from "../safety-flag-card";

afterEach(() => {
  cleanup();
});

const MASKED_EVIDENCE =
  "I know where you live: [REDACTED ADDRESS]. Contact: [REDACTED EMAIL].";
const RAW_EVIDENCE =
  "I know where you live: 123 Main Street. Contact: steward@example.com.";

function renderCard(revealEvidence = vi.fn().mockResolvedValue(RAW_EVIDENCE)) {
  return {
    revealEvidence,
    ...render(
      <SafetyFlagCard
        flagId="flag-474"
        reasonCodes={["threat", "doxxing"]}
        maskedEvidence={MASKED_EVIDENCE}
        revealEvidence={revealEvidence}
      />,
    ),
  };
}

describe("SafetyFlagCard", () => {
  it("presents a private response-blocking status without a danger score or draft action", () => {
    renderCard();

    expect(
      screen.getByRole("region", { name: /safety flag/i }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: /safety flag/i })).toBeTruthy();
    expect(screen.getByText(/reply drafts are blocked/i)).toBeTruthy();
    expect(screen.getByText(MASKED_EVIDENCE)).toBeTruthy();
    expect(screen.queryByText(RAW_EVIDENCE)).toBeNull();
    expect(screen.queryByText(/author danger score/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /reply draft/i })).toBeNull();
  });

  it("directs the Steward to YouTube and real-world safety paths", () => {
    renderCard();

    expect(screen.getByRole("heading", { name: "YouTube actions" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /^Report on YouTube/ }).getAttribute(
        "href",
      ),
    ).toBe("https://support.google.com/youtube/answer/2802027");
    expect(
      screen.getByRole("link", { name: /^Open YouTube Studio/ }).getAttribute(
        "href",
      ),
    ).toBe("https://studio.youtube.com/");
    expect(
      screen.getByRole("heading", { name: "Real-world safety" }),
    ).toBeTruthy();
    expect(screen.getByText(/local emergency services/i)).toBeTruthy();
    expect(screen.getByText(/trusted crisis service/i)).toBeTruthy();
  });

  it("requires the warned reveal control, announces revealed evidence, and restores focus when re-masked", async () => {
    const user = userEvent.setup();
    const { revealEvidence } = renderCard();
    const revealButton = screen.getByRole("button", {
      name: "Show sensitive evidence",
    });
    const warning = screen.getByText(/may reveal personal information/i);

    expect(revealButton.getAttribute("aria-expanded")).toBe("false");
    expect(revealButton.getAttribute("aria-describedby")).toBe(
      warning.id,
    );
    expect(revealEvidence).not.toHaveBeenCalled();

    await user.click(revealButton);

    expect(revealEvidence).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(RAW_EVIDENCE)).toBeTruthy();
    expect(revealButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(RAW_EVIDENCE).getAttribute("aria-live")).toBe(
      "polite",
    );

    const maskButton = screen.getByRole("button", {
      name: "Mask sensitive evidence",
    });
    await user.click(maskButton);

    expect(screen.queryByText(RAW_EVIDENCE)).toBeNull();
    expect(screen.getByText(MASKED_EVIDENCE)).toBeTruthy();
    expect(document.activeElement).toBe(revealButton);
  });

  it("passes automated accessibility checks while masked", async () => {
    const { container } = renderCard();

    expect(await axe(container)).toHaveNoViolations();
  });
});
