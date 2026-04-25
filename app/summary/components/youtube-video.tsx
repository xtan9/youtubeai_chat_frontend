"use client";

import { useRef, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { YouTubePlayer } from "react-youtube";
import { getYoutubeVideoId } from "../utils";
import type { TranscriptSegment } from "@/lib/types";
import TranscriptParagraphs from "./transcript-paragraphs";

// next/dynamic with ssr:false because react-youtube touches `window` and
// PropTypes during render; importing it server-side trips the Next.js
// "ReferenceError: window is not defined" guard during the initial
// /summary route render.
const YouTubeNoSSR = dynamic(() => import("react-youtube"), { ssr: false });

interface YoutubeVideoProps {
  url: string;
  width: number; // becomes the maximum width
  segments?: readonly TranscriptSegment[];
  streamingComplete?: boolean;
}

const YoutubeVideo = ({ url, width, segments }: YoutubeVideoProps) => {
  const [containerWidth, setContainerWidth] = useState(width);
  const containerRef = useRef<HTMLDivElement>(null);
  // YouTubePlayer instance is captured on the IFrame Player API's `onReady`
  // event. The transcript card uses it to seek + play on timestamp click
  // and to poll getCurrentTime() for the active-paragraph highlight.
  const playerRef = useRef<YouTubePlayer | null>(null);

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

  if (!url || !videoId) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 w-full" ref={containerRef}>
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
        }}
      />
      {segments && segments.length > 0 && (
        <TranscriptParagraphs segments={segments} playerRef={playerRef} />
      )}
    </div>
  );
};

export default YoutubeVideo;
