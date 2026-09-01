// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { axe } from "@/tests-utils/axe";
import {
  getReviewStatusLabel,
  REVIEW_ITEM_STATUSES,
  type ChannelHubChannel,
  type ChannelHubState,
  type HubReviewItem,
} from "@/lib/channel-hub/contract";
import { ChannelHubExperience } from "../channel-hub-experience";

const CHANNEL: ChannelHubChannel = {
  channelId: "channel-481",
  connectedChannelId: "connected-channel-481",
  providerChannelId: "UC481",
  displayName: "The 481 Channel",
  active: true,
  grantStatus: "active",
  publishingAuthorization: "active",
};

const ITEM: HubReviewItem = {
  id: "assessment-481",
  channelId: CHANNEL.channelId,
  connectedChannelId: CHANNEL.connectedChannelId,
  video: { id: "video-481", title: "A video with useful context" },
  interactionText: "You are not helping anyone.",
  topLevelCommentText: "You are not helping anyone.",
  neighboringReplies: ["Here is the context from the same thread."],
  classification: "Actionable Abuse",
  target: "channel_steward",
  severity: "non_severe",
  targetEvidence: ["direct address"],
  draftEligible: true,
  status: "draft_ready",
  assessedAt: "2026-08-31T12:00:00.000Z",
  publishingIdentity: CHANNEL,
  youtubeUrl: "https://www.youtube.com/watch?v=video-481&lc=comment-481",
  draft: { text: "Please keep discussion focused on the video." },
};

const REVIEW_STATE: ChannelHubState = {
  kind: "review",
  channel: CHANNEL,
  queue: [ITEM],
  selectedItemId: ITEM.id,
};

const COVERAGE = {
  window: "recent_seven_days" as const,
  windowStart: "2026-08-24T12:00:00.000Z",
  windowEnd: "2026-08-31T12:00:00.000Z",
  oldestThreadAt: "2026-08-25T00:00:00.000Z",
  newestThreadAt: "2026-08-31T11:59:00.000Z",
  pages: 2,
  threadsDiscovered: 20,
  threadsAssessed: 18,
  threadsReused: 1,
  threadsFailed: 1,
  bound: null,
  boundPreventedCompleteCoverage: false,
  completeWithinBounds: true,
};

const SCAN_RUN = {
  id: "scan-481",
  status: "running" as const,
  progress: { processedThreads: 4, totalThreads: 20, percent: 20 },
  coverage: COVERAGE,
};

function stateFor(kind: ChannelHubState["kind"]): ChannelHubState {
  switch (kind) {
    case "disconnected":
      return { kind, phase: "first_visit", access: "registered", entitlement: "active_pro", canConnect: true };
    case "free_discovery":
      return { kind, upgradeHref: "/pricing?source_surface=channel" };
    case "pro_onboarding":
      return { kind, step: "authorize_read", canContinue: true };
    case "connected":
      return { kind, channel: CHANNEL, scanRun: { ...SCAN_RUN, status: "completed" }, queue: [] };
    case "scanning":
      return { kind, channel: CHANNEL, scanRun: SCAN_RUN, queue: [] };
    case "review":
      return { kind, channel: CHANNEL, coverage: COVERAGE, queue: [ITEM], selectedItemId: ITEM.id };
    case "grace_period":
      return { kind, channel: CHANNEL, expiresAt: "2026-09-07T12:00:00.000Z", coverage: COVERAGE, queue: [ITEM] };
    case "deletion":
      return { kind, phase: "in_progress", requestedAt: "2026-08-31T12:00:00.000Z" };
    case "deleted":
      return { kind, deletedAt: "2026-08-31T12:01:00.000Z" };
  }
}

afterEach(() => cleanup());

describe("ChannelHubExperience", () => {
  it("shows the active Channel, Video, coverage, review context, and publishing identity", () => {
    render(<ChannelHubExperience state={REVIEW_STATE} onAction={vi.fn()} />);

    expect(screen.getByRole("main", { name: "Channel Hub" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Channel Hub" })).toBeTruthy();
    expect(screen.getByText("Connected YouTube Channel")).toBeTruthy();
    expect(screen.getByText("The 481 Channel")).toBeTruthy();
    expect(screen.getByText("Video")).toBeTruthy();
    expect(screen.getAllByText("A video with useful context").length).toBe(2);
    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getAllByText("Publishing identity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft Ready").length).toBe(2);
    expect(screen.getByRole("textbox", { name: "Reply Draft" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Publish reviewed reply" }),
    ).toBeTruthy();
  });

  it.each([
    "disconnected",
    "free_discovery",
    "pro_onboarding",
    "connected",
    "scanning",
    "review",
    "grace_period",
    "deletion",
    "deleted",
  ] as const)("renders the %s state without inventing a production route", (kind) => {
    const { container } = render(<ChannelHubExperience state={stateFor(kind)} />);

    const main = screen.getByRole("main", { name: "Channel Hub" });
    expect(main.getAttribute("data-hub-state")).toBe(kind);
    expect(main.getAttribute("data-layout")).toBe("responsive-390");
    expect(container.querySelector('a[href="/channel"]')).toBeNull();
  });

  it("announces bounded async progress with a semantic progressbar", () => {
    render(<ChannelHubExperience state={stateFor("scanning")} />);

    expect(screen.getByRole("progressbar", { name: "Scan progress: 20%" })).toBeTruthy();
    expect(screen.getByRole("status", { name: /scan run in progress/i })).toBeTruthy();
    expect(screen.getByRole("status", { name: /scan progress: 20% — 4 of 20 threads processed/i })).toBeTruthy();
    expect(screen.getByText(/scan progress: 20% — 4 of 20 threads processed/i)).toBeTruthy();
  });

  it("supports keyboard selection, explicit review actions, and draft editing", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onDraftChange = vi.fn();
    render(<ChannelHubExperience state={REVIEW_STATE} onAction={onAction} onDraftChange={onDraftChange} />);

    await user.tab();
    expect(document.activeElement?.getAttribute("data-review-item")).toBe(ITEM.id);
    await user.keyboard("{Enter}");
    const draft = screen.getByRole("textbox", { name: "Reply Draft" });
    await user.clear(draft);
    await user.type(draft, "Please keep the conversation focused.");
    await user.click(screen.getByRole("button", { name: "Publish reviewed reply" }));

    expect(onDraftChange).toHaveBeenLastCalledWith(ITEM.id, "Please keep the conversation focused.");
    expect(onAction).toHaveBeenCalledWith("publish", ITEM.id);
  });

  it("updates the selected Review Queue item from the keyboard-accessible list", async () => {
    const user = userEvent.setup();
    const secondItem: HubReviewItem = {
      ...ITEM,
      id: "assessment-482",
      video: { id: "video-482", title: "A second video with context" },
      status: "reviewable",
    };

    render(
      <ChannelHubExperience
        state={{
          ...REVIEW_STATE,
          queue: [ITEM, secondItem],
        }}
      />,
    );

    const secondItemButton = screen.getByRole("button", { name: /a second video with context/i });
    await user.click(secondItemButton);

    expect(screen.getByRole("heading", { name: "A second video with context" })).toBeTruthy();
    expect(secondItemButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status", { name: /showing a second video with context/i })).toBeTruthy();
  });

  it("keeps Safety Flags at the front of the Review Queue", () => {
    const safetyItem: HubReviewItem = {
      ...ITEM,
      id: "assessment-safety-481",
      classification: "Safety Flag",
      severity: "severe",
      status: "safety_flag",
      draft: undefined,
    };
    const reviewableItem: HubReviewItem = {
      ...ITEM,
      id: "assessment-reviewable-481",
      classification: "Reviewable Interaction",
      status: "reviewable",
      draft: undefined,
    };
    const { container } = render(
      <ChannelHubExperience
        state={{
          ...REVIEW_STATE,
          queue: [reviewableItem, ITEM, safetyItem],
        }}
      />,
    );

    expect(
      [...container.querySelectorAll("[data-review-item]")].map((item) =>
        item.getAttribute("data-review-item"),
      ),
    ).toEqual([safetyItem.id, ITEM.id, reviewableItem.id]);
  });

  it.each([...REVIEW_ITEM_STATUSES])(
    "renders %s as a distinct review lifecycle status",
    (status) => {
      const state: ChannelHubState = {
        kind: "review",
        channel: CHANNEL,
        queue: [{ ...ITEM, status }],
        selectedItemId: ITEM.id,
      };

      render(<ChannelHubExperience state={state} />);

      expect(screen.getAllByText(getReviewStatusLabel(status)).length).toBeGreaterThan(0);
    },
  );

  it("keeps the grace-period review surface read-only", () => {
    render(<ChannelHubExperience state={stateFor("grace_period")} />);

    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByText("Reply Draft (read-only)")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Reply Draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish reviewed reply" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export Channel data" })).toBeTruthy();
  });

  it("keeps Safety Flags free of drafting and publishing controls", () => {
    const safetyState: ChannelHubState = {
      kind: "review",
      channel: CHANNEL,
      queue: [{
        ...ITEM,
        classification: "Safety Flag",
        severity: "severe",
        status: "safety_flag",
        draft: { text: "This stale draft must not render." },
        sensitiveEvidence: { maskedText: "[REDACTED ADDRESS]" },
      }],
      selectedItemId: ITEM.id,
    };

    render(<ChannelHubExperience state={safetyState} />);

    expect(screen.getAllByText("Safety Flag").length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: "Reply Draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: /draft|publish/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with safety guidance" })).toBeTruthy();
  });

  it("fails closed when a Safety Flag carries a forged draft-ready status", () => {
    const forgedSafetyState: ChannelHubState = {
      kind: "review",
      channel: CHANNEL,
      queue: [{
        ...ITEM,
        classification: "Safety Flag",
        severity: "severe",
        status: "draft_ready",
        sensitiveEvidence: { maskedText: "[REDACTED]" },
      }],
      selectedItemId: ITEM.id,
    };

    render(<ChannelHubExperience state={forgedSafetyState} />);

    expect(screen.queryByRole("textbox", { name: "Reply Draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish reviewed reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Request draft" })).toBeNull();
    expect(screen.getByText(/Safety Flags never produce a Reply Draft/i)).toBeTruthy();
  });

  it("reveals warned safety evidence and restores focus when it is masked again", async () => {
    const user = userEvent.setup();
    const revealSensitiveEvidence = vi.fn().mockResolvedValue("123 Main Street");
    const safetyState: ChannelHubState = {
      kind: "review",
      channel: CHANNEL,
      queue: [{
        ...ITEM,
        classification: "Safety Flag",
        severity: "severe",
        status: "safety_flag",
        sensitiveEvidence: { maskedText: "[REDACTED ADDRESS]" },
      }],
      selectedItemId: ITEM.id,
    };

    render(<ChannelHubExperience state={safetyState} revealSensitiveEvidence={revealSensitiveEvidence} />);
    const reveal = screen.getByRole("button", { name: "Show sensitive evidence" });
    expect(reveal.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/may reveal personal information/i)).toBeTruthy();

    await user.click(reveal);
    expect(await screen.findByText("123 Main Street")).toBeTruthy();
    expect(revealSensitiveEvidence).toHaveBeenCalledWith(ITEM.id);
    const mask = screen.getByRole("button", { name: "Mask sensitive evidence" });
    await user.click(mask);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show sensitive evidence" })));
    expect(screen.queryByText("123 Main Street")).toBeNull();
    expect(screen.getByText("[REDACTED ADDRESS]")).toBeTruthy();
  });

  it("passes automated accessibility checks and declares non-color and reduced-motion policies", async () => {
    const { container } = render(<ChannelHubExperience state={stateFor("scanning")} />);

    expect(await axe(container)).toHaveNoViolations();
    const main = screen.getByRole("main", { name: "Channel Hub" });
    expect(main.getAttribute("data-motion-policy")).toBe("reduced-motion-safe");
    expect(container.querySelector("[data-scan-status='running']")?.textContent).toContain("Running");
    expect(container.innerHTML).toContain("motion-reduce:animate-none");
    expect(container.innerHTML).toContain("motion-reduce:transition-none");
  });

  it.each(["review", "grace_period"] as const)(
    "passes automated accessibility checks for the %s work surface",
    async (kind) => {
      const { container } = render(<ChannelHubExperience state={stateFor(kind)} />);

      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it("keeps the 390px contract content reachable without a fixed-width surface", () => {
    const { container } = render(
      <div style={{ width: "390px" }}>
        <ChannelHubExperience state={REVIEW_STATE} />
      </div>,
    );

    const main = container.querySelector("main");
    expect(main?.getAttribute("data-layout")).toBe("responsive-390");
    expect(main?.className).toContain("min-w-0");
    expect(screen.getAllByText("The 481 Channel").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Publish reviewed reply" })).toBeTruthy();
  });
});
