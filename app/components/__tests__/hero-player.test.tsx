// @vitest-environment happy-dom
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { useEffect, useRef } from "react";
import type { YouTubePlayer } from "react-youtube";
import { PlayerRefProvider, usePlayerRef } from "@/lib/contexts/player-ref";
import HeroPlayer from "../hero-player";

// Module-scoped seekTo spy so the unmount-cleanup test can assert
// behaviour. Each test resets it via beforeEach.
const SHARED_SEEK_TO = vi.fn();

vi.mock("react-youtube", () => ({
  default: ({
    onReady,
  }: {
    onReady?: (e: { target: YouTubePlayer }) => void;
  }) => {
    const fakePlayer = {
      seekTo: SHARED_SEEK_TO,
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(0),
      getPlayerState: vi.fn().mockReturnValue(-1),
    } as unknown as YouTubePlayer;
    setTimeout(() => onReady?.({ target: fakePlayer }), 0);
    return <div data-testid="yt-iframe-stub" />;
  },
}));

beforeEach(() => {
  SHARED_SEEK_TO.mockClear();
});

afterEach(() => cleanup());

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
    seekRef.current?.(42);
    expect(SHARED_SEEK_TO).toHaveBeenCalledWith(42, true);
    SHARED_SEEK_TO.mockClear();
    unmount();
    // After unmount, registerPlayer(null) was called → context seekTo
    // is a no-op and the fake player MUST stay untouched.
    seekRef.current?.(99);
    expect(SHARED_SEEK_TO).not.toHaveBeenCalled();
  });
});
