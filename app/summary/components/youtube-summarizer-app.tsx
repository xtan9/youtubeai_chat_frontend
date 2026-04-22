"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import { StreamingProgressIndicator } from "./streaming-progress";
import { StreamErrorBanner } from "./stream-error-banner";
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
  const firstRenderRef = useRef(true);

  // Use custom hooks for complex logic
  const { summarizationQuery } = useYouTubeSummarizer(
    url,
    enableReasoning,
    true
  );

  const {
    data: rawData,
    error: queryError,
    isLoading,
    isFetching,
    fetchStatus,
  } = summarizationQuery;

  // Handle streaming data (array)
  const { data, streamingProgress, isCached, streamError } = useMemo(() => {
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
        streamError: null as string | null,
      };
    }

    if (Array.isArray(rawData) && rawData.length > 0) {
      const latestRawData = rawData[rawData.length - 1];

      if (latestRawData?.summary) {
        setIsProcessing(false);
        // Parse the streaming data to extract clean content and progress
        const parsed = parseStreamingData(latestRawData.summary);

        // Check if streaming is complete OR errored — either way the
        // stream has finished and the progress indicator should stop.
        if (
          parsed.streamError ||
          (parsed.progress?.stage === "complete" &&
            parsed.progress.progress === 100)
        ) {
          setStreamingComplete(true);
        }

        return {
          data: parsed.result,
          streamingProgress: parsed.progress,
          isCached: parsed.isCached,
          streamError: parsed.streamError,
        };
      }
      return {
        data: latestRawData,
        streamingProgress: null,
        isCached: false,
        streamError: null as string | null,
      };
    }

    return {
      data: rawData as SummaryResult | undefined,
      streamingProgress: null,
      isCached: false,
      streamError: null as string | null,
    };
  }, [rawData, isLoading, isFetching]);

  // Detect if this is a cached result from query status
  useEffect(() => {
    // If we already detected it's cached from metadata, don't change it
    if (isCached) {
      setStreamingComplete(true);
      return;
    }

    // Otherwise check the query status
    if (rawData && !isLoading && !isFetching && fetchStatus === "idle") {
      setStreamingComplete(true);
    }
  }, [rawData, isLoading, isFetching, fetchStatus, isCached]);

  // Handle first render with cached results
  useEffect(() => {
    if (isCached && firstRenderRef.current) {
      firstRenderRef.current = false;
      setStreamingComplete(true);
    }
  }, [isCached]);

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
        <div className="lg:col-span-2">
          <AuthErrorBanner authError={queryError?.message} />
          {streamError && <StreamErrorBanner message={streamError} />}
          {/* Suppress the progress indicator once the stream has errored —
              the error banner is the terminal UI, not a stalled 70% bar. */}
          {!streamError && (streamingProgress || isProcessing) && (
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
          {data && !streamError && (
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
          <YoutubeVideo
            url={url}
            width={600}
            transcript={data?.transcript}
            streamingComplete={streamingComplete}
          />
        </div>
      </div>
    </div>
  );
}
