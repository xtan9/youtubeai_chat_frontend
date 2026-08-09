// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef } from "react";
import type { YouTubePlayer } from "react-youtube";
import { PlayerRefProvider, usePlayerRef } from "@/lib/contexts/player-ref";
import YoutubeVideo from "../youtube-video";

const PLAYER = {
  seekTo: vi.fn(),
  playVideo: vi.fn(),
  pauseVideo: vi.fn(),
  getCurrentTime: vi.fn().mockReturnValue(0),
  getPlayerState: vi.fn().mockReturnValue(1),
} as unknown as YouTubePlayer;

vi.mock("react-youtube", () => ({
  default: function MockYouTube({
    onReady,
  }: {
    onReady?: (event: { target: YouTubePlayer }) => void;
  }) {
    const onReadyRef = useRef(onReady);
    useEffect(() => {
      onReadyRef.current?.({ target: PLAYER });
    }, []);
    return <div data-testid="youtube-player" />;
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("YoutubeVideo", () => {
  it("clears range monitoring when the video changes", async () => {
    const playRangeRef: {
      current: ((startSeconds: number, endSeconds: number) => void) | null;
    } = { current: null };
    function Consumer() {
      const { playRange } = usePlayerRef();
      useEffect(() => {
        playRangeRef.current = playRange;
      }, [playRange]);
      return null;
    }
    const playerRef: { current: YouTubePlayer | null } = { current: null };
    function Harness({ url }: { url: string }) {
      return (
        <PlayerRefProvider>
          <Consumer />
          <YoutubeVideo url={url} width={600} playerRef={playerRef} />
        </PlayerRefProvider>
      );
    }

    const { findByTestId, rerender } = render(
      <Harness url="https://www.youtube.com/watch?v=abcdefghijk" />,
    );
    await findByTestId("youtube-player");
    expect(playerRef.current).toBe(PLAYER);

    vi.useFakeTimers();
    act(() => playRangeRef.current?.(10, 20));
    expect(vi.getTimerCount()).toBe(1);

    rerender(
      <Harness url="https://www.youtube.com/watch?v=lmnopqrstuv" />,
    );

    expect(vi.getTimerCount()).toBe(0);
    expect(playerRef.current).toBeNull();
  });
});
