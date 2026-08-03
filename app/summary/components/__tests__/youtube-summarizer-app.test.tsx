// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryRunSnapshot } from "@/lib/summary-run/summary-run";

const analyticsMocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/analytics/client", () => ({
  captureAnalyticsEvent: analyticsMocks.capture,
}));
vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/summary",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@/lib/hooks/useYouTubeSummarizer");
vi.mock("@/lib/hooks/useClipboard", () => ({
  useClipboard: () => ({ copied: false, copyToClipboard: vi.fn() }),
}));
vi.mock("../results-display", () => ({
  ResultsDisplay: ({ data }: { data: { summary: string } }) => (
    <div data-testid="summary-results">{data.summary}</div>
  ),
}));
vi.mock("../chat-tab", () => ({ ChatTab: () => <div>chat</div> }));
vi.mock("../youtube-video", () => ({
  default: () => <div data-testid="youtube-video" />,
}));
vi.mock("@/components/paywall/UpgradeCard", () => ({
  UpgradeCard: ({ variant }: { variant: string }) => (
    <div data-paywall-variant={variant} />
  ),
}));
vi.mock("@/lib/contexts/user-context", () => ({
  useUser: () => ({
    user: { id: "u1", is_anonymous: false },
    session: { access_token: "tok" },
  }),
}));

import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { YouTubeSummarizerApp } from "../youtube-summarizer-app";

const mockUseYouTubeSummarizer = useYouTubeSummarizer as ReturnType<typeof vi.fn>;

function commonCommands() {
  return {
    start: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    isAnonymous: false,
    isAuthLoading: false,
  };
}

function runningSnapshot(): SummaryRunSnapshot {
  return {
    status: "running",
    runId: "run-1",
    input: {
      video: { youtubeUrl: "https://youtu.be/x" },
      outputLanguage: null,
      includeTranscript: true,
    },
    draft: { text: "A draft that is still being generated." },
    progress: {
      stage: "summarizing",
      message: "Generating summary...",
      elapsedSeconds: 2.4,
    },
    origin: "generated",
    transcript: { status: "unavailable", diagnostic: "not_received" },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  analyticsMocks.capture.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("YouTubeSummarizerApp Summary Run presentation", () => {
  it("renders a non-actionable Summary Draft and keeps Chat locked while running", () => {
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      snapshot: runningSnapshot(),
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    expect(screen.getByTestId("summary-draft")).not.toBeNull();
    expect(screen.getByText("A draft that is still being generated.")).not.toBeNull();
    expect(screen.queryByTestId("summary-results")).toBeNull();
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /copy summary/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /new summary/i })).toBeNull();
  });

  it.each([
    {
      label: "generated",
      origin: "generated" as const,
      summaryText: "A validated generated Summary.",
    },
    {
      label: "cached",
      origin: "cache" as const,
      summaryText: "A validated cached Summary.",
    },
  ])(
    "renders completed $label Summary presentation, unlocks Chat, and records validated origin",
    async ({ origin, summaryText }) => {
      mockUseYouTubeSummarizer.mockReturnValue({
        ...commonCommands(),
        isAnonymous: true,
        snapshot: {
          status: "succeeded",
          runId: "run-2",
          input: {
            video: { youtubeUrl: "https://youtu.be/x" },
            outputLanguage: null,
            includeTranscript: true,
          },
          summary: {
            title: "Video Summary",
            duration: "3.0s total",
            summary: summaryText,
            transcriptionTime: 1,
            summaryTime: 2,
            origin,
          },
          origin,
          progress: {
            stage: "complete",
            message: "Summary complete",
            elapsedSeconds: 3,
          },
          transcript: { status: "not_requested" },
        } satisfies SummaryRunSnapshot,
      });

      render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

      expect(screen.getByTestId("summary-results").textContent).toContain(
        summaryText,
      );
      expect(screen.queryByTestId("summary-draft")).toBeNull();
      expect(
        screen.getByRole("tab", { name: "Chat" }).getAttribute("disabled"),
      ).toBeNull();
      await waitFor(() =>
        expect(analyticsMocks.capture).toHaveBeenCalledWith(
          "summary_succeeded",
          expect.objectContaining({
            result_origin: origin,
            output_language: "video_native",
          }),
        ),
      );
    },
  );

  it("renders quota failure without exposing a completed Summary", () => {
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      snapshot: {
        status: "failed",
        runId: "run-3",
        input: {
          video: { youtubeUrl: "https://youtu.be/x" },
          outputLanguage: null,
          includeTranscript: true,
        },
        draft: { text: "" },
        progress: {
          stage: "preparing",
          message: "Preparing summary...",
          elapsedSeconds: 0,
        },
        origin: null,
        transcript: { status: "unavailable", diagnostic: "not_received" },
        error: {
          kind: "quota",
          code: "free_quota_exceeded",
          message: "Monthly summary limit reached",
          status: 402,
        },
      } satisfies SummaryRunSnapshot,
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    expect(document.querySelector('[data-paywall-variant="summary-cap"]')).not.toBeNull();
    expect(screen.queryByTestId("summary-results")).toBeNull();
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("disabled")).not.toBeNull();
  });
});
