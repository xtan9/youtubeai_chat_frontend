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
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [isCachedResult, setIsCachedResult] = useState(false);
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const summaryContentRef = useRef<HTMLDivElement>(null);
  const firstRenderRef = useRef(true);

  // Define the scroll function
  const scrollToBottom = useCallback(() => {
    // Don't scroll for cached results
    if (isCachedResult) return;

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
  }, [isCachedResult]);

  // Define function to scroll to top
  const scrollToTop = useCallback(() => {
    // Don't scroll for cached results
    if (isCachedResult) return;

    requestAnimationFrame(() => {
      // Scroll page to top
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      // Also reset scroll position of any scrollable containers
      if (summaryContentRef.current) {
        summaryContentRef.current.scrollTop = 0;
      }

      // Find and reset any other scrollable elements
      document
        .querySelectorAll(".overflow-auto, .overflow-y-auto")
        .forEach((el) => {
          if (el instanceof HTMLElement) {
            el.scrollTop = 0;
          }
        });
    });
  }, [isCachedResult]);

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
    fetchStatus,
  } = summarizationQuery;

  // Handle streaming data (array)
  const { data, streamingProgress, isCached } = useMemo(() => {
    if ((isLoading || isFetching) && !rawData) {
      setIsProcessing(true);
      setStreamingComplete(false);
      return {
        data: undefined,
        streamingProgress: {
          stage: "downloading",
          message: "Initializing summary process...",
          progress: 5,
        } as StreamingProgress,
        isCached: false,
      };
    }

    if (Array.isArray(rawData) && rawData.length > 0) {
      const latestRawData = rawData[rawData.length - 1];

      if (latestRawData?.summary) {
        setIsProcessing(false);
        // Parse the streaming data to extract clean content and progress
        const parsed = parseStreamingData(latestRawData.summary);

        // Set cached status from the parsed data
        if (parsed.isCached) {
          setIsCachedResult(true);
        }

        // Check if streaming is complete
        if (
          parsed.progress?.stage === "complete" &&
          parsed.progress.progress === 100
        ) {
          setStreamingComplete(true);
        }

        return {
          data: parsed.result,
          streamingProgress: parsed.progress,
          isCached: parsed.isCached,
        };
      }
      return {
        data: latestRawData,
        streamingProgress: null,
        isCached: false,
      };
    }

    return {
      data: rawData as SummaryResult | undefined,
      streamingProgress: null,
      isCached: false,
    };
  }, [rawData, isLoading, isFetching]);

  // Detect if this is a cached result from query status
  useEffect(() => {
    // If we already detected it's cached from metadata, don't change it
    if (isCached) {
      setIsCachedResult(true);
      setStreamingComplete(true);
      return;
    }

    // Otherwise check the query status
    if (rawData && !isLoading && !isFetching && fetchStatus === "idle") {
      setIsCachedResult(true);
      setStreamingComplete(true);
    }
  }, [rawData, isLoading, isFetching, fetchStatus, isCached]);

  // Handle first render with cached results
  useEffect(() => {
    if (isCached && firstRenderRef.current) {
      firstRenderRef.current = false;
      // For cached results on first render, we don't want any scroll animations
      setIsCachedResult(true);
      setStreamingComplete(true);
    }
  }, [isCached]);

  // Scroll when new data or progress updates arrive during streaming
  useEffect(() => {
    if ((streamingProgress || data) && !streamingComplete && !isCachedResult) {
      scrollToBottom();
    }
  }, [
    streamingProgress,
    data,
    scrollToBottom,
    streamingComplete,
    isCachedResult,
  ]);

  // Scroll to top when streaming completes
  useEffect(() => {
    if (
      streamingComplete &&
      streamingProgress?.stage === "complete" &&
      !isCachedResult
    ) {
      // Add a small delay to ensure all content is rendered
      const timeoutId = setTimeout(() => {
        scrollToTop();
      }, 500);

      return () => clearTimeout(timeoutId);
    }
  }, [
    streamingComplete,
    streamingProgress?.stage,
    scrollToTop,
    isCachedResult,
  ]);

  const { copied, copyToClipboard } = useClipboard();

  // Fetch summary when component mounts
  useEffect(() => {
    if (url) {
      firstRenderRef.current = true;
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
          {(streamingProgress || isProcessing) && !isCachedResult && (
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
              summaryContentRef={summaryContentRef}
              isCachedResult={isCachedResult}
            />
          )}
        </div>
        <div className="sticky top-[138px] w-full">
          <YoutubeVideo
            url={url}
            width={600}
            transcript={data?.transcript}
            streamingComplete={streamingComplete}
            isCachedResult={isCachedResult}
          />
        </div>
      </div>
    </div>
  );
}
