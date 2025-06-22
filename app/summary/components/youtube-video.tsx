import { getYoutubeVideoId } from "../utils";
import { Card } from "@/components/ui/card";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useTheme } from "next-themes";

interface YoutubeVideoProps {
  url: string;
  width: number; // This becomes the maximum width
  transcript?: string;
}

const YoutubeVideo = ({ url, width, transcript }: YoutubeVideoProps) => {
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const [containerWidth, setContainerWidth] = useState(width);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  // Calculate aspect ratio (16:9)
  const height = Math.floor((containerWidth / 16) * 9);
  const videoId = getYoutubeVideoId(url);
  const videoUrl = `https://www.youtube.com/embed/${videoId}`;

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const newWidth = Math.min(containerRef.current.clientWidth, width);
        setContainerWidth(newWidth);
      }
    };

    // Initial calculation
    updateWidth();

    // Add resize listener
    window.addEventListener("resize", updateWidth);

    // Clean up
    return () => window.removeEventListener("resize", updateWidth);
  }, [width]);

  if (!url) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 w-full" ref={containerRef}>
      <iframe
        src={videoUrl}
        allowFullScreen
        loading="lazy"
        className="rounded-lg w-full"
        title="Youtube Video"
        width={containerWidth}
        height={height}
      />

      {transcript && (
        <Card
          className={`p-4 w-full ${
            isDark
              ? "bg-slate-800/80 border-slate-700"
              : "bg-white border-slate-200"
          }`}
        >
          <div className="flex justify-between items-center mb-2">
            <h3
              className={`text-sm font-semibold ${
                isDark ? "text-slate-300" : "text-slate-600"
              }`}
            >
              Video Transcript
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
              className={`flex items-center gap-1 text-xs ${
                isDark
                  ? "text-slate-300 hover:text-white hover:bg-slate-700"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
              }`}
            >
              {isTranscriptExpanded ? (
                <>
                  <ChevronUp size={14} />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown size={14} />
                  Show more
                </>
              )}
            </Button>
          </div>
          <div
            className={`overflow-y-auto whitespace-pre-line text-sm ${
              isDark ? "text-slate-300" : "text-slate-600"
            } ${
              isTranscriptExpanded ? "max-h-[600px]" : "max-h-[300px]"
            } transition-all duration-300`}
          >
            {transcript}
          </div>
        </Card>
      )}
    </div>
  );
};

export default YoutubeVideo;
