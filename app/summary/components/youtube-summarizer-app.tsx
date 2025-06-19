"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import type { SummaryResult } from "@/lib/types";
import { Download, FileText, Brain, CheckCircle, Clock } from "lucide-react";
import { parseStreamingData, type StreamingProgress } from "../utils";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
  enableReasoning?: boolean;
}

// Progress indicator component
function StreamingProgressIndicator({
  progress,
}: {
  progress: StreamingProgress;
}) {
  const stageIcons = {
    downloading: Download,
    transcribing: FileText,
    summarizing: Brain,
    complete: CheckCircle,
  };

  const stageColors = {
    downloading: "from-blue-500 to-cyan-500",
    transcribing: "from-yellow-500 to-orange-500",
    summarizing: "from-purple-500 to-pink-500",
    complete: "from-green-500 to-emerald-500",
  };

  const Icon = stageIcons[progress.stage];
  const colorGradient = stageColors[progress.stage];

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-r ${colorGradient} flex items-center justify-center`}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-lg font-semibold text-white capitalize">
              {progress.stage.replace("_", " ")}
            </span>
            {progress.elapsed && (
              <div className="flex items-center gap-1 text-sm text-gray-400">
                <Clock className="w-3 h-3" />
                {progress.elapsed.toFixed(1)}s elapsed
              </div>
            )}
          </div>
        </div>
        <span className="text-lg font-mono text-white">
          {Math.round(progress.progress)}%
        </span>
      </div>

      <div className="w-full bg-gray-700/50 rounded-full h-3 mb-3 overflow-hidden">
        <div
          className={`bg-gradient-to-r ${colorGradient} h-3 rounded-full transition-all duration-500 ease-out relative`}
          style={{ width: `${progress.progress}%` }}
        >
          <div className="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
        </div>
      </div>

      <p className="text-sm text-gray-300 text-center">{progress.message}</p>
    </div>
  );
}

export function YouTubeSummarizerApp({
  initialUrl,
  enableReasoning = false,
}: YouTubeSummarizerAppProps) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl || "");
  const [isProcessing, setIsProcessing] = useState(false);

  // Use custom hooks for complex logic
  const { summarizationQuery } = useYouTubeSummarizer(url, enableReasoning);
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
    <>
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
    </>
  );
}
