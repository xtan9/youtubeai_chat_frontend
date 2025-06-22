"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import { StreamingProgressIndicator } from "./streaming-progress";
import type { SummaryResult } from "@/lib/types";
import { parseStreamingData, type StreamingProgress } from "../utils";
import YoutubeVideo from "./youtube-video";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
  enableReasoning?: boolean;
}

export function YouTubeSummarizerApp({
  initialUrl,
  enableReasoning = false,
}: YouTubeSummarizerAppProps) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl || "");
  const [isProcessing, setIsProcessing] = useState(false);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Define the scroll function
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (resultsContainerRef.current) {
        resultsContainerRef.current.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      } else {
        // Fallback if ref is not available
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
      }
    });
  }, []);

  // Use custom hooks for complex logic
  const { summarizationQuery, registerScrollFunction } = useYouTubeSummarizer(
    url,
    enableReasoning,
    true
  );

  // Register the scroll function with the hook
  useEffect(() => {
    registerScrollFunction(scrollToBottom);
  }, [registerScrollFunction, scrollToBottom]);

  const {
    data: rawData,
    error: queryError,
    isLoading,
    isFetching,
  } = summarizationQuery;

  // Handle streaming data (array)
  const { data, streamingProgress } = useMemo(() => {
    if ((isLoading || isFetching) && !rawData) {
      setIsProcessing(true);
      return {
        data: undefined,
        streamingProgress: {
          stage: "downloading",
          message: "Initializing summary process...",
          progress: 5,
        } as StreamingProgress,
      };
    }

    if (Array.isArray(rawData) && rawData.length > 0) {
      const latestRawData = rawData[rawData.length - 1];

      if (latestRawData?.summary) {
        setIsProcessing(false);
        // Parse the streaming data to extract clean content and progress
        const parsed = parseStreamingData(latestRawData.summary);
        return {
          data: parsed.result,
          streamingProgress: parsed.progress,
        };
      }
      return {
        data: latestRawData,
        streamingProgress: null,
      };
    }

    return {
      data: rawData as SummaryResult | undefined,
      streamingProgress: null,
    };
  }, [rawData, isLoading, isFetching]);

  // Also scroll when new data or progress updates arrive
  useEffect(() => {
    if (streamingProgress || data) {
      scrollToBottom();
    }
  }, [streamingProgress, data, scrollToBottom]);

  const { copied, copyToClipboard } = useClipboard();

  // Fetch summary when component mounts
  useEffect(() => {
    if (url) {
      summarizationQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleCopySummary = async () => {
    if (!data) return;

    const textToCopy = `${data?.title}\n\n${
      data?.summary
    }\n\nKey Insights:\n${data?.keyPoints
      .map((point: string) => `• ${point}`)
      .join("\n")}`;
    await copyToClipboard(textToCopy);
  };

  const handleNewSummary = () => {
    setUrl("");
    router.push("/");
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2" ref={resultsContainerRef}>
          <AuthErrorBanner authError={queryError?.message} />
          {(streamingProgress || isProcessing) && (
            <StreamingProgressIndicator
              progress={
                streamingProgress || {
                  stage: "downloading",
                  message: "Starting summary process...",
                  progress: 5,
                }
              }
            />
          )}
          {data && (
            <ResultsDisplay
              data={data}
              url={url}
              copied={copied}
              onCopySummary={handleCopySummary}
              onNewSummary={handleNewSummary}
            />
          )}
        </div>
        <div className="sticky top-[138px] w-full">
          <YoutubeVideo url={url} width={600} transcript={data?.transcript} />
        </div>
      </div>
    </div>
  );
}
