"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import dynamic from "next/dynamic";
import type { YouTubePlayer } from "react-youtube";
import { usePlayerRef } from "@/lib/contexts/player-ref";

const YouTubeNoSSR = dynamic(() => import("react-youtube"), { ssr: false });

interface HeroPlayerProps {
  readonly videoId: string;
  readonly playerRef: MutableRefObject<YouTubePlayer | null>;
}

/**
 * Slim react-youtube wrapper for the hero demo widget. Mounts the
 * IFrame Player API for the active sample so the click-to-seek
 * transcript and the chat tab's [mm:ss] chips can drive it via the
 * page-level PlayerRefProvider.
 *
 * No autoplay — load-paused matches /summary's behavior and avoids
 * browser autoplay-policy noise. Width tracks the container; height
 * is 16:9 of width (the standard YouTube embed contract).
 */
export default function HeroPlayer({ videoId, playerRef }: HeroPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const { registerPlayer } = usePlayerRef();

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setWidth(containerRef.current.clientWidth || 320);
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Drop the registered handle on unmount so a chat tab still mounted
  // on the page doesn't seek a dead player after a sample change tears
  // the iframe down.
  useEffect(() => {
    return () => registerPlayer(null);
  }, [registerPlayer]);

  const height = Math.floor((width / 16) * 9);

  return (
    <div ref={containerRef} className="w-full">
      <YouTubeNoSSR
        videoId={videoId}
        iframeClassName="rounded-xl w-full aspect-video"
        opts={{
          width: String(width),
          height: String(height),
          playerVars: { playsinline: 1 },
        }}
        onReady={(event) => {
          playerRef.current = event.target;
          registerPlayer({
            seekTo: (seconds, allowSeekAhead) =>
              event.target.seekTo(seconds, allowSeekAhead ?? true),
            playVideo: () => event.target.playVideo(),
          });
        }}
        onError={(event) => {
          // YouTube fires this for unembeddable / removed / region-blocked
          // videos. Without surfacing it the iframe shows a YouTube error
          // UI but the chat tab's [mm:ss] chips silently no-op against a
          // player that never plays. Logged with a stable errorId so
          // a dead demo video is alertable rather than mysterious.
          console.error("[hero-player] HERO_PLAYER_ERROR", {
            errorId: "HERO_PLAYER_ERROR",
            videoId,
            ytErrorCode: event.data,
          });
        }}
      />
    </div>
  );
}
