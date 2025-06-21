import { getYoutubeVideoId } from "../utils";
import { Card } from "@/components/ui/card";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

interface YoutubeVideoProps {
  url: string;
  width: number;
  transcript?: string;
}

const YoutubeVideo = ({ url, width, transcript }: YoutubeVideoProps) => {
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState(false);
  const height = (width / 16) * 9;
  const videoId = getYoutubeVideoId(url);
  const videoUrl = `https://www.youtube.com/embed/${videoId}`;

  if (!url) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <iframe
        src={videoUrl}
        allowFullScreen
        loading="lazy"
        className="rounded-lg"
        title="Youtube Video"
        width={width}
        height={height}
      />

      {transcript && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-lg font-semibold">Video Transcript</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
              className="flex items-center gap-1"
            >
              {isTranscriptExpanded ? (
                <>
                  <ChevronUp size={16} />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown size={16} />
                  Show more
                </>
              )}
            </Button>
          </div>
          <div
            className={`overflow-y-auto whitespace-pre-line ${
              isTranscriptExpanded ? "max-h-[600px]" : "max-h-[150px]"
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
