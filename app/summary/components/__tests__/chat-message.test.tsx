// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { ChatMessage } from "../chat-message";
import { PlayerRefProvider, usePlayerRef } from "@/lib/contexts/player-ref";
import { useEffect } from "react";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function PlayerRegister({
  seekTo,
  playVideo,
  pauseVideo,
  getCurrentTime,
}: {
  seekTo: (s: number, b?: boolean) => void;
  playVideo?: () => void;
  pauseVideo?: () => void;
  getCurrentTime?: () => number | Promise<number>;
}) {
  const { registerPlayer } = usePlayerRef();
  useEffect(() => {
    registerPlayer({ seekTo, playVideo, pauseVideo, getCurrentTime });
  }, [getCurrentTime, pauseVideo, playVideo, registerPlayer, seekTo]);
  return null;
}

describe("ChatMessage", () => {
  it("renders user content as plain text in a right-aligned bubble", () => {
    render(<ChatMessage role="user" content="What's the main argument?" />);
    expect(screen.getByText("What's the main argument?")).toBeTruthy();
  });

  it("renders assistant timestamps as clickable chips that seek the player", () => {
    const seekTo = vi.fn();
    const onTimestampActivated = vi.fn();
    render(
      <PlayerRefProvider>
        <PlayerRegister seekTo={seekTo} />
        <ChatMessage
          role="assistant"
          content="They explain it [4:32] very clearly."
          onTimestampActivated={onTimestampActivated}
        />
      </PlayerRefProvider>
    );
    const chip = screen.getByRole("button", { name: /Seek video to \[4:32\]/i });
    fireEvent.click(chip);
    expect(seekTo).toHaveBeenCalledWith(4 * 60 + 32, true);
    expect(onTimestampActivated).toHaveBeenCalledTimes(1);
  });

  it("plays a timestamp range from its start and pauses after its end", async () => {
    vi.useFakeTimers();
    const seekTo = vi.fn();
    const playVideo = vi.fn();
    const pauseVideo = vi.fn();
    render(
      <PlayerRefProvider>
        <PlayerRegister
          seekTo={seekTo}
          playVideo={playVideo}
          pauseVideo={pauseVideo}
          getCurrentTime={vi
            .fn()
            .mockReturnValueOnce(4 * 60 + 32)
            .mockReturnValueOnce(4 * 60 + 34)
            .mockReturnValueOnce(4 * 60 + 36)
            .mockReturnValueOnce(4 * 60 + 38)
            .mockReturnValueOnce(4 * 60 + 40)
            .mockReturnValueOnce(4 * 60 + 42)
            .mockReturnValueOnce(4 * 60 + 44)
            .mockReturnValueOnce(4 * 60 + 46)
            .mockReturnValueOnce(4 * 60 + 48)
            .mockReturnValueOnce(4 * 60 + 50)
            .mockReturnValueOnce(4 * 60 + 52)
            .mockReturnValueOnce(4 * 60 + 54)
            .mockReturnValueOnce(4 * 60 + 56)
            .mockReturnValueOnce(4 * 60 + 58)
            .mockReturnValueOnce(5 * 60)
            .mockReturnValueOnce(5 * 60 + 2)
            .mockReturnValueOnce(5 * 60 + 4)
            .mockReturnValueOnce(5 * 60 + 6)
            .mockReturnValueOnce(5 * 60 + 8)
            .mockReturnValueOnce(5 * 60 + 10)
            .mockReturnValueOnce(5 * 60 + 11)}
        />
        <ChatMessage
          role="assistant"
          content="The example runs from [4:32 - 5:10]."
        />
      </PlayerRefProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Seek video to \[4:32 - 5:10\]/i,
      }),
    );

    expect(seekTo).toHaveBeenCalledWith(4 * 60 + 32, true);
    expect(playVideo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_250);
    expect(pauseVideo).toHaveBeenCalledTimes(1);
  });

  it("renders timestamp citations as disabled when Transcript timing is unavailable", () => {
    const seekTo = vi.fn();
    const onTimestampActivated = vi.fn();
    render(
      <PlayerRefProvider>
        <PlayerRegister seekTo={seekTo} />
        <ChatMessage
          role="assistant"
          content="They explain it [4:32] clearly."
          transcriptTimingStatus="unavailable"
          onTimestampActivated={onTimestampActivated}
        />
      </PlayerRefProvider>,
    );

    const chip = screen.getByRole("button", {
      name: /timestamp \[4:32\].*unavailable/i,
    });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(chip);
    expect(seekTo).not.toHaveBeenCalled();
    expect(onTimestampActivated).not.toHaveBeenCalled();
  });

  it("keeps malformed timestamps as plain text (no chip)", () => {
    render(<ChatMessage role="assistant" content="Look at [99:99]" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
