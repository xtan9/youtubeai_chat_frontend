// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { YouTubePlayer } from "react-youtube";
import { TranscriptPanel } from "../transcript-panel";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

afterEach(() => cleanup());

const playerRef = { current: null as YouTubePlayer | null };

describe("TranscriptPanel", () => {
  it("explains that the Transcript is still processing", () => {
    render(
      <TranscriptPanel
        phase="processing"
        playerRef={playerRef}
        onRetry={vi.fn()}
        onRevealVideo={vi.fn()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Transcript will appear when processing is complete",
    );
  });

  it.each(["failed", "cancelled"] as const)(
    "offers the Summary retry path when processing is %s",
    (phase) => {
      const onRetry = vi.fn();
      render(
        <TranscriptPanel
          phase={phase}
          playerRef={playerRef}
          onRetry={onRetry}
          onRevealVideo={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Retry summary" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the unavailable timing explanation after completion", () => {
    render(
      <TranscriptPanel
        phase="complete"
        transcript={{ status: "unavailable", diagnostic: "not_received" }}
        playerRef={playerRef}
        onRetry={vi.fn()}
        onRevealVideo={vi.fn()}
      />,
    );

    expect(screen.getByTestId("transcript-timing-notice").textContent).toContain(
      "Transcript timing is unavailable",
    );
  });

  it("renders available Transcript content without a nested mobile scroller", () => {
    render(
      <TranscriptPanel
        phase="complete"
        transcript={{
          status: "available",
          source: "manual_captions",
          segments: [{ start: 0, duration: 12, text: "Opening argument" }],
        }}
        playerRef={playerRef}
        onRetry={vi.fn()}
        onRevealVideo={vi.fn()}
      />,
    );

    const transcript = screen.getByTestId("transcript-container");
    expect(transcript.textContent).toContain("Opening argument");
    expect(transcript.className).toContain("max-h-none");
    expect(transcript.className).toContain("md:max-h-[600px]");
  });

  it("reveals the Video after a timestamp successfully seeks", async () => {
    const onRevealVideo = vi.fn();
    const seekTo = vi.fn().mockResolvedValue(undefined);
    const playVideo = vi.fn().mockResolvedValue(undefined);
    const interactivePlayerRef = {
      current: {
        seekTo,
        playVideo,
        getCurrentTime: vi.fn().mockResolvedValue(0),
      } as unknown as YouTubePlayer,
    };
    render(
      <TranscriptPanel
        phase="complete"
        transcript={{
          status: "available",
          source: "manual_captions",
          segments: [{ start: 12, duration: 8, text: "The key point" }],
        }}
        playerRef={interactivePlayerRef}
        onRetry={vi.fn()}
        onRevealVideo={onRevealVideo}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Jump to 00:12" }));

    await waitFor(() => expect(onRevealVideo).toHaveBeenCalledTimes(1));
    expect(seekTo).toHaveBeenCalledWith(12, true);
    expect(playVideo).toHaveBeenCalledTimes(1);
  });
});
