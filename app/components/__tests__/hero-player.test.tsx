// @vitest-environment happy-dom
import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import type { YouTubePlayer } from "react-youtube";
import { PlayerRefProvider } from "@/lib/contexts/player-ref";
import HeroPlayer from "../hero-player";

vi.mock("react-youtube", () => ({
  default: ({
    onReady,
  }: {
    onReady?: (e: { target: YouTubePlayer }) => void;
  }) => {
    const fakePlayer = {
      seekTo: vi.fn(),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(0),
      getPlayerState: vi.fn().mockReturnValue(-1),
    } as unknown as YouTubePlayer;
    setTimeout(() => onReady?.({ target: fakePlayer }), 0);
    return <div data-testid="yt-iframe-stub" />;
  },
}));

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
});
