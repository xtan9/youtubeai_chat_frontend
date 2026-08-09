"use client";

import {
  useRef,
  useEffect,
  useState,
  type MutableRefObject,
} from "react";
import dynamic from "next/dynamic";
import type { YouTubePlayer } from "react-youtube";
import { getYoutubeVideoId } from "../utils";
import {
  createYouTubePlayerHandle,
  usePlayerRef,
} from "@/lib/contexts/player-ref";

// next/dynamic with ssr:false because react-youtube touches `window` and
// PropTypes during render; importing it server-side trips the Next.js
// "ReferenceError: window is not defined" guard during the initial
// /summary route render.
const YouTubeNoSSR = dynamic(() => import("react-youtube"), { ssr: false });

interface YoutubeVideoProps {
  url: string;
  width: number; // becomes the maximum width
  playerRef?: MutableRefObject<YouTubePlayer | null>;
}

const YoutubeVideo = ({
  url,
  width,
  playerRef: providedPlayerRef,
}: YoutubeVideoProps) => {
  const [containerWidth, setContainerWidth] = useState(width);
  const containerRef = useRef<HTMLDivElement>(null);
  // YouTubePlayer instance is captured on the IFrame Player API's `onReady`
  // event. The transcript card uses it to seek + play on timestamp click
  // and to poll getCurrentTime() for the active-paragraph highlight.
  const internalPlayerRef = useRef<YouTubePlayer | null>(null);
  const playerRef = providedPlayerRef ?? internalPlayerRef;
  // Register the player handle with the page-level context so the chat
  // tab's timestamp chips can seek it (no prop-drilling from this leaf).
  // Falls back to a no-op when the page isn't wrapped in PlayerRefProvider
  // — keeps test renderers that mount this component standalone working.
  const { clearPlaybackBoundary, registerPlayer } = usePlayerRef();

  // Match the iframe to the container width up to a max. 16:9 aspect ratio
  // for the height — that's the default YouTube embed contract.
  const height = Math.floor((containerWidth / 16) * 9);
  const videoId = getYoutubeVideoId(url);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const newWidth = Math.min(containerRef.current.clientWidth, width);
        setContainerWidth(newWidth);
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [width]);

  // Drop the registered player handle on unmount so a chat tab still
  // mounted on the same page doesn't seek a dead player after the video
  // tears down (e.g. on URL change).
  useEffect(() => {
    return () => registerPlayer(null);
  }, [registerPlayer]);

  useEffect(() => {
    clearPlaybackBoundary();
  }, [clearPlaybackBoundary, videoId]);

  if (!url || !videoId) {
    return null;
  }

  return (
    <div className="w-full" ref={containerRef}>
      <YouTubeNoSSR
        videoId={videoId}
        iframeClassName="rounded-lg w-full"
        opts={{
          width: String(containerWidth),
          height: String(height),
          // Enable the JS Player API so `seekTo`/`playVideo`/`getCurrentTime`
          // work. Origin matches the page so postMessage handshakes pass.
          playerVars: {
            playsinline: 1,
          },
        }}
        onReady={(event) => {
          playerRef.current = event.target;
          registerPlayer(createYouTubePlayerHandle(event.target));
        }}
      />
    </div>
  );
};

export default YoutubeVideo;
