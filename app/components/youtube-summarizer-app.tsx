"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import type { SummaryResult } from "@/lib/types";
import { Download, FileText, Brain, CheckCircle, Clock } from "lucide-react";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
}

interface StreamingProgress {
  stage: "downloading" | "transcribing" | "summarizing" | "complete";
  message: string;
  progress: number;
  elapsed?: number;
}

// Helper function to parse streaming data and extract progress info
function parseStreamingData(rawData: string): {
  result: SummaryResult;
  progress: StreamingProgress | null;
} {
  let accumulatedSummary = "";
  let title = "Streaming Summary";
  let duration = "Streaming in progress";
  let transcriptionTime = 0;
  let summaryTime = 0;
  let currentProgress: StreamingProgress | null = null;

  // Parse Server-Sent Events format
  const lines = rawData.split("\n");
  console.log("Raw streaming data lines:", lines);

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const jsonStr = line.slice(6).trim(); // Remove 'data: ' prefix and trim whitespace
        if (!jsonStr) continue; // Skip empty lines

        const data = JSON.parse(jsonStr);
        console.log("Parsed streaming data:", data);

        // Normalize data type to handle variations
        const type = (data.type || "").toLowerCase();

        // Determine progress based on multiple possible indicators
        const determineProgress = () => {
          const message = (data.message || "").toLowerCase();
          const stage = data.stage || "";

          if (message.includes("download") || stage === "download") {
            return {
              stage: "downloading" as const,
              message: data.message || "Downloading video...",
              progress: Math.min(30, 10 + (data.elapsed || 0) * 2),
              elapsed: data.elapsed,
            };
          }

          if (message.includes("caption") || message.includes("subtitle")) {
            return {
              stage: "transcribing" as const,
              message: data.message || "Processing captions...",
              progress: 30,
            };
          }

          if (message.includes("transcrib") || stage === "transcribe") {
            return {
              stage: "transcribing" as const,
              message: data.message || "Transcribing audio...",
              progress: 40,
            };
          }

          if (message.includes("summar") || stage === "summarize") {
            return {
              stage: "summarizing" as const,
              message: data.message || "Generating summary...",
              progress: 70,
            };
          }

          return null;
        };

        // Handle different types of streaming data
        switch (type) {
          case "metadata":
            title = data.category
              ? `${data.category} Summary`
              : "Video Summary";
            break;

          case "status":
          case "progress":
            const progressUpdate = determineProgress();
            if (progressUpdate) {
              currentProgress = progressUpdate;
            }
            break;

          case "content":
            if (data.text) {
              accumulatedSummary += data.text;
              currentProgress = {
                stage: "summarizing",
                message: "Generating summary...",
                progress: Math.min(95, 70 + accumulatedSummary.length / 50),
              };
            }
            break;

          case "timing":
            if (data.stage === "total" || data.total_time) {
              duration = `${data.total_time?.toFixed(1) || 0}s total`;
              currentProgress = {
                stage: "complete",
                message: data.performance || "Summary complete!",
                progress: 100,
              };
            }
            break;

          case "summary":
            // Final summary with timing info
            duration = `${data.total_time?.toFixed(1) || 0}s total`;
            transcriptionTime = data.transcribe_time || 0;
            summaryTime = data.summarize_time || 0;
            currentProgress = {
              stage: "complete",
              message: data.performance || "Summary complete!",
              progress: 100,
            };
            break;
        }
      } catch (e) {
        // Skip invalid JSON lines
        console.warn("Failed to parse streaming data:", e);
      }
    }
  }

  // Fallback progress if no progress was determined
  if (!currentProgress) {
    currentProgress = {
      stage: "downloading",
      message: "Processing video...",
      progress: 10,
    };
  }

  console.log("Final parsed result:", {
    title,
    duration,
    summary: accumulatedSummary,
    progress: currentProgress,
  });

  return {
    result: {
      title,
      duration,
      summary: accumulatedSummary,
      keyPoints: [],
      transcriptionTime,
      summaryTime,
    },
    progress: currentProgress,
  };
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
}: YouTubeSummarizerAppProps) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl || "");
  const [isProcessing, setIsProcessing] = useState(false);

  // Use custom hooks for complex logic
  const { summarizationQuery } = useYouTubeSummarizer(url);
  const {
    data: rawData,
    error: queryError,
    isLoading,
    isFetching,
  } = summarizationQuery;

  // Handle streaming data (array)
  const { data, streamingProgress } = useMemo(() => {
    console.log("Raw data received:", rawData);
    console.log("Is loading:", isLoading);
    console.log("Is fetching:", isFetching);

    // Show processing state when loading
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
      console.log("Latest raw data:", latestRawData);

      if (latestRawData?.summary) {
        setIsProcessing(false);
        // Parse the streaming data to extract clean content and progress
        const parsed = parseStreamingData(latestRawData.summary);
        console.log("Parsed result:", parsed);
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
