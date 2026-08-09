// @vitest-environment happy-dom
import { act, render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { useEffect, useRef } from "react";
import type { YouTubePlayer } from "react-youtube";
import { PlayerRefProvider, usePlayerRef } from "@/lib/contexts/player-ref";
import HeroPlayer from "../hero-player";

// Module-scoped seekTo spy so the unmount-cleanup test can assert
// behaviour. Each test resets it via beforeEach.
const SHARED_SEEK_TO = vi.fn();
const SHARED_PAUSE_VIDEO = vi.fn();
const SHARED_GET_CURRENT_TIME = vi.fn();
const SHARED_GET_PLAYER_STATE = vi.fn();

vi.mock("react-youtube", () => ({
  default: function MockYouTube({
    onReady,
  }: {
    onReady?: (e: { target: YouTubePlayer }) => void;
  }) {
    const playerRef = useRef<YouTubePlayer | null>(null);
    if (!playerRef.current) {
      playerRef.current = {
        seekTo: SHARED_SEEK_TO,
        playVideo: vi.fn(),
        pauseVideo: SHARED_PAUSE_VIDEO,
        getCurrentTime: SHARED_GET_CURRENT_TIME,
        getPlayerState: SHARED_GET_PLAYER_STATE,
      } as unknown as YouTubePlayer;
    }
    const onReadyRef = useRef(onReady);
    useEffect(() => {
      const timer = setTimeout(
        () => onReadyRef.current?.({ target: playerRef.current! }),
        0,
      );
      return () => clearTimeout(timer);
    }, []);
    return <div data-testid="yt-iframe-stub" />;
  },
}));

beforeEach(() => {
  SHARED_SEEK_TO.mockClear();
  SHARED_PAUSE_VIDEO.mockClear();
  SHARED_GET_CURRENT_TIME.mockReset().mockReturnValue(0);
  SHARED_GET_PLAYER_STATE.mockReset().mockReturnValue(1);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness({
  videoId,
  externalRef,
}: {
  videoId: string;
  externalRef?: { current: YouTubePlayer | null };
}) {
  const localRef = useRef<YouTubePlayer | null>(null);
  const ref = externalRef ?? localRef;
  return (
    <PlayerRefProvider>
      <HeroPlayer videoId={videoId} playerRef={ref} />
    </PlayerRefProvider>
  );
}

describe("HeroPlayer", () => {
  it("renders the YouTube iframe stub for a given videoId", async () => {
    const { findByTestId } = render(<Harness videoId="abc12345678" />);
    expect(await findByTestId("yt-iframe-stub")).toBeTruthy();
  });

  it("captures the player handle into the playerRef on ready", async () => {
    const ref: { current: YouTubePlayer | null } = { current: null };
    const { findByTestId } = render(
      <Harness videoId="xyz12345678" externalRef={ref} />,
    );
    // next/dynamic + onReady setTimeout are both async; wait for the
    // iframe stub then a tick more for the onReady callback to fire.
    await findByTestId("yt-iframe-stub");
    await new Promise((r) => setTimeout(r, 10));
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.seekTo).toBe("function");
  });

  it("clears the registered handle on unmount so a still-mounted chat tab doesn't seek a torn-down iframe", async () => {
    // The PlayerRefProvider's seekTo is a no-op when no handle is
    // registered. After HeroPlayer unmounts and calls
    // registerPlayer(null), a sibling consumer's seekTo MUST NOT
    // invoke the now-detached fake player's seekTo. Loss of this
    // cleanup would let a chat-tab timestamp chip rendered on the
    // same page seek a dead iframe after the next sample switch.
    // Hold the consumer's seekTo on a ref-like cell so the eslint
    // react-hooks rule doesn't trip on a closed-over `let` reassignment
    // from inside a component.
    const seekRef: { current: ((s: number) => void) | null } = {
      current: null,
    };
    function Consumer() {
      const ctx = usePlayerRef();
      useEffect(() => {
        seekRef.current = ctx.seekTo;
      }, [ctx.seekTo]);
      return null;
    }
    const ref: { current: YouTubePlayer | null } = { current: null };
    const { unmount, findByTestId } = render(
      <PlayerRefProvider>
        <Consumer />
        <HeroPlayer videoId="zzz12345678" playerRef={ref} />
      </PlayerRefProvider>,
    );
    await findByTestId("yt-iframe-stub");
    await new Promise((r) => setTimeout(r, 10));
    // While mounted, a consumer seek reaches the fake player.
    expect(ref.current).not.toBeNull();
    seekRef.current?.(42);
    expect(SHARED_SEEK_TO).toHaveBeenCalledWith(42, true);
    SHARED_SEEK_TO.mockClear();
    unmount();
    expect(ref.current).toBeNull();
    // After unmount, registerPlayer(null) was called → context seekTo
    // is a no-op and the fake player MUST stay untouched.
    seekRef.current?.(99);
    expect(SHARED_SEEK_TO).not.toHaveBeenCalled();
  });

  it("registers the timing controls needed for range playback", async () => {
    const playRangeRef: {
      current: ((startSeconds: number, endSeconds: number) => void) | null;
    } = { current: null };
    function Consumer() {
      const ctx = usePlayerRef();
      useEffect(() => {
        playRangeRef.current = ctx.playRange;
      }, [ctx.playRange]);
      return null;
    }

    const { findByTestId } = render(
      <PlayerRefProvider>
        <Consumer />
        <HeroPlayer
          videoId="range123456"
          playerRef={{ current: null }}
        />
      </PlayerRefProvider>,
    );
    await findByTestId("yt-iframe-stub");
    await new Promise((resolve) => setTimeout(resolve, 10));

    vi.useFakeTimers();
    SHARED_GET_CURRENT_TIME
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(12)
      .mockReturnValueOnce(14)
      .mockReturnValueOnce(16)
      .mockReturnValueOnce(18)
      .mockReturnValueOnce(20)
      .mockReturnValue(21);
    act(() => playRangeRef.current?.(10, 20));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_750);
    });

    expect(SHARED_PAUSE_VIDEO).toHaveBeenCalledTimes(1);
  });

  it("clears range monitoring when videoId changes", async () => {
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

    function HarnessWithConsumer({ videoId }: { videoId: string }) {
      return (
        <PlayerRefProvider>
          <Consumer />
          <HeroPlayer videoId={videoId} playerRef={playerRef} />
        </PlayerRefProvider>
      );
    }

    const playerRef: { current: YouTubePlayer | null } = { current: null };

    const { findByTestId, rerender } = render(
      <HarnessWithConsumer videoId="first123456" />,
    );
    await findByTestId("yt-iframe-stub");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(playerRef.current).not.toBeNull();

    vi.useFakeTimers();
    act(() => playRangeRef.current?.(10, 20));
    expect(vi.getTimerCount()).toBe(1);

    rerender(<HarnessWithConsumer videoId="second12345" />);

    expect(vi.getTimerCount()).toBe(0);
    expect(playerRef.current).toBeNull();
  });
});
