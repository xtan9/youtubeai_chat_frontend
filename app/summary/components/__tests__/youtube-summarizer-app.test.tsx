// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SummaryRunSnapshot } from "@/lib/summary-run";

const { navigationSearchParams } = vi.hoisted(() => ({
  navigationSearchParams: { value: new URLSearchParams() },
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/summary",
  useSearchParams: () => navigationSearchParams.value,
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@/lib/hooks/useYouTubeSummarizer");
vi.mock("@/lib/hooks/useClipboard", () => ({
  useClipboard: () => ({ copied: false, copyToClipboard: vi.fn() }),
}));
vi.mock("../results-display", () => ({
  ResultsDisplay: ({
    data,
    onSelectLanguage,
  }: {
    data: { summary: string };
    onSelectLanguage: (code: "es") => void;
  }) => (
    <>
      <div data-testid="summary-results">{data.summary}</div>
      <button onClick={() => onSelectLanguage("es")}>switch language</button>
    </>
  ),
}));
vi.mock("../chat-tab", () => ({
  ChatTab: ({
    youtubeUrl,
    active,
    className,
    onTimestampActivated,
  }: {
    youtubeUrl: string | null;
    active: boolean;
    className?: string;
    onTimestampActivated?: () => void;
  }) => (
    <div
      data-testid="chat-tab"
      data-youtube-url={youtubeUrl}
      data-active={String(active)}
      className={className}
    >
      chat
      <button
        type="button"
        data-testid="chat-timestamp"
        onClick={onTimestampActivated}
      >
        [0:12]
      </button>
    </div>
  ),
}));
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
import { setViewportWidth } from "./viewport";

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

function succeededSnapshot(): SummaryRunSnapshot {
  return {
    status: "succeeded",
    runId: "run-succeeded",
    input: {
      video: { youtubeUrl: "https://youtu.be/x" },
      outputLanguage: null,
      includeTranscript: true,
    },
    summary: {
      title: "Video Summary",
      duration: "3.0s total",
      summary: "A completed Summary.",
      transcriptionTime: 1,
      summaryTime: 2,
      origin: "generated",
    },
    origin: "generated",
    progress: {
      stage: "complete",
      message: "Summary complete",
      elapsedSeconds: 3,
    },
    transcript: {
      status: "available",
      source: "manual_captions",
      segments: [{ start: 12, duration: 8, text: "The key point" }],
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  navigationSearchParams.value = new URLSearchParams();
  setViewportWidth(1024);
});

afterEach(() => {
  cleanup();
});

describe("YouTubeSummarizerApp Summary Run presentation", () => {
  it("places the persistent Video before the three-tab workspace on mobile", () => {
    setViewportWidth(390);
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      snapshot: runningSnapshot(),
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    const videoRegion = screen.getByTestId("summary-video-region");
    const tabRail = screen.getByTestId("summary-tab-rail");
    expect(
      videoRegion.compareDocumentPosition(tabRail) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(screen.getByRole("tab", { name: "Transcript" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("reveals the Video when a Chat timestamp is activated on mobile", () => {
    setViewportWidth(390);
    navigationSearchParams.value = new URLSearchParams({ tab: "chat" });
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      snapshot: succeededSnapshot(),
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    const scrollIntoView = vi.fn();
    screen.getByTestId("summary-video-region").scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByTestId("chat-timestamp"));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("keeps a processing Chat deep link inert until the Summary succeeds", () => {
    navigationSearchParams.value = new URLSearchParams({ tab: "chat" });
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      snapshot: runningSnapshot(),
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    expect(
      screen.getByRole("tab", { name: "Chat" }).getAttribute("data-state"),
    ).toBe("active");
    expect(
      screen.getByTestId("chat-tab").getAttribute("data-youtube-url"),
    ).toBeNull();
    expect(screen.getByTestId("chat-tab").getAttribute("data-active")).toBe(
      "false",
    );
  });

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

  it("exposes the controller's explicit cancellation command while running", () => {
    const commands = commonCommands();
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commands,
      snapshot: runningSnapshot(),
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    fireEvent.click(screen.getByRole("button", { name: /cancel summary/i }));
    expect(commands.cancel).toHaveBeenCalledTimes(1);
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
          code: "QUOTA_EXCEEDED",
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

  it.each([
    {
      kind: "authentication" as const,
      code: "AUTHENTICATION_FAILED" as const,
      message: "private authentication payload",
      safeMessage: "Authentication failed. Please sign in again.",
    },
    {
      kind: "rate_limit" as const,
      code: "RATE_LIMITED" as const,
      message: "private rate limit payload",
      safeMessage: "Too many summary requests. Please wait a moment and try again.",
    },
    {
      kind: "request" as const,
      code: "REQUEST_FAILED" as const,
      message: "private request payload",
      safeMessage: "The summary request could not be completed. Please try again.",
    },
    {
      kind: "network" as const,
      code: "NETWORK_FAILURE" as const,
      message: "private network payload",
      safeMessage: "Couldn't connect to the summary service. Please try again.",
    },
    {
      kind: "processing" as const,
      code: "PROCESSING_FAILURE" as const,
      message: "private processing payload",
      safeMessage:
        "Couldn't process this video. Please try again or try a different URL.",
    },
    {
      kind: "protocol" as const,
      code: "PROTOCOL_FAILURE" as const,
      message: "private protocol payload",
      safeMessage: "The summary stream was invalid. Please try again.",
    },
  ])(
    "renders safe $kind recovery copy, keeps the Draft non-actionable, and retries only on explicit action",
    ({ kind, code, message, safeMessage }) => {
      const retry = vi.fn();
      mockUseYouTubeSummarizer.mockReturnValue({
        ...commonCommands(),
        retry,
        snapshot: {
          status: "failed",
          runId: `run-${kind}`,
          input: {
            video: { youtubeUrl: "https://youtu.be/x" },
            outputLanguage: null,
            includeTranscript: true,
          },
          draft: { text: "Retained but incomplete draft" },
          progress: {
            stage: "summarizing",
            message: "Generating summary...",
            elapsedSeconds: 4,
          },
          origin: "generated",
          transcript: { status: "unavailable", diagnostic: "not_received" },
          error: { kind, code, message },
        } satisfies SummaryRunSnapshot,
      });

      render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

      const failureSurface =
        kind === "authentication"
          ? screen.getByText(safeMessage)
          : screen.getByTestId("stream-error-banner");
      expect(failureSurface.textContent).toContain(safeMessage);
      expect(screen.queryByText(message)).toBeNull();
      expect(screen.getByTestId("summary-draft").textContent).toContain(
        "Not ready for actions",
      );
      expect(screen.queryByTestId("summary-results")).toBeNull();
      expect(
        screen.getByRole("tab", { name: "Chat" }).getAttribute("disabled"),
      ).not.toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /retry summary/i }));
      expect(retry).toHaveBeenCalledTimes(1);
    },
  );
  it("renders cancellation as a non-failure Draft without completed actions", () => {
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      snapshot: {
        status: "cancelled",
        runId: "run-cancelled",
        input: {
          video: { youtubeUrl: "https://youtu.be/x" },
          outputLanguage: null,
          includeTranscript: true,
        },
        draft: { text: "A retained cancelled draft." },
        progress: {
          stage: "summarizing",
          message: "Generating summary...",
          elapsedSeconds: 1.5,
        },
        origin: "generated",
        transcript: { status: "unavailable", diagnostic: "not_received" },
      } satisfies SummaryRunSnapshot,
    });

    render(<YouTubeSummarizerApp initialUrl="https://youtu.be/x" />);

    expect(screen.getByTestId("summary-draft")).not.toBeNull();
    expect(screen.getByText("A retained cancelled draft.")).not.toBeNull();
    expect(screen.queryByTestId("summary-results")).toBeNull();
    expect(screen.queryByTestId("stream-error-banner")).toBeNull();
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("disabled")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /copy summary/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /new summary/i })).toBeNull();
  });

  it("hides a previous-language Summary and locks Chat before its replacement starts", () => {
    const start = vi.fn();
    mockUseYouTubeSummarizer.mockReturnValue({
      ...commonCommands(),
      start,
      snapshot: {
        status: "succeeded",
        runId: "native-run",
        input: {
          video: { youtubeUrl: "https://youtu.be/x" },
          outputLanguage: null,
          includeTranscript: true,
        },
        summary: {
          title: "Video Summary",
          duration: "3.0s total",
          summary: "Native-language Summary that must disappear.",
          transcriptionTime: 1,
          summaryTime: 2,
          origin: "generated",
        },
        origin: "generated",
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
      "Native-language Summary",
    );

    fireEvent.click(screen.getByRole("button", { name: "switch language" }));

    expect(screen.queryByTestId("summary-results")).toBeNull();
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("disabled")).not.toBeNull();
    expect(start).toHaveBeenLastCalledWith({
      video: { youtubeUrl: "https://youtu.be/x" },
      outputLanguage: "es",
      includeTranscript: true,
    });
  });
});
