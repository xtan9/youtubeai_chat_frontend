"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";
import type { SummaryResult } from "@/lib/types";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
  useStreaming?: boolean;
}

// Helper function to parse streaming data
function parseStreamingData(rawData: string): SummaryResult {
  let accumulatedSummary = "";
  let title = "Streaming Summary";
  let duration = "Streaming in progress";
  let transcriptionTime = 0;
  let summaryTime = 0;

  // Parse Server-Sent Events format
  const lines = rawData.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const jsonStr = line.slice(6); // Remove 'data: ' prefix
        const data = JSON.parse(jsonStr);

        // Handle different types of streaming data
        switch (data.type) {
          case "metadata":
            title = data.category
              ? `${data.category} Summary`
              : "Video Summary";
            break;

          case "content":
            if (data.text) {
              accumulatedSummary += data.text;
            }
            break;

          case "timing":
            if (data.stage === "total" || data.total_time) {
              duration = `${data.total_time?.toFixed(1) || 0}s total`;
            }
            break;

          case "summary":
            // Final summary with timing info
            duration = `${data.total_time?.toFixed(1) || 0}s total`;
            transcriptionTime = data.transcribe_time || 0;
            summaryTime = data.summarize_time || 0;
            break;
        }
      } catch (e) {
        // Skip invalid JSON lines
        console.warn("Failed to parse streaming data:", line);
      }
    }
  }

  return {
    title,
    duration,
    summary: accumulatedSummary,
    keyPoints: [],
    transcriptionTime,
    summaryTime,
  };
}

export function YouTubeSummarizerApp({
  initialUrl,
  useStreaming,
}: YouTubeSummarizerAppProps) {
  const router = useRouter();
  const [url, setUrl] = useState(initialUrl || "");

  // Use custom hooks for complex logic
  const { streamingSummarizationQuery, summarizationQuery } =
    useYouTubeSummarizer(url);
  const currentQuery = useStreaming
    ? streamingSummarizationQuery
    : summarizationQuery;
  const { data: rawData, error: queryError } = currentQuery;

  // Handle streaming data (array) vs regular data (single object)
  const data = useMemo(() => {
    if (useStreaming && Array.isArray(rawData) && rawData.length > 0) {
      const latestRawData = rawData[rawData.length - 1];
      if (latestRawData?.summary) {
        // Parse the streaming data to extract clean content
        return parseStreamingData(latestRawData.summary);
      }
      return latestRawData;
    }
    return rawData as SummaryResult | undefined;
  }, [useStreaming, rawData]);

  const { copied, copyToClipboard } = useClipboard();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    currentQuery.refetch();
  }, []);

  const handleCopySummary = async () => {
    if (!data) return;

    const textToCopy = `${data?.title}\n\n${
      data?.summary
    }\n\nKey Insights:\n${data?.keyPoints
      .map((point: string) => `• ${point}`)
      .join("\n")}`;
    await copyToClipboard(textToCopy);
    console.log("copy");
  };

  const handleNewSummary = () => {
    setUrl("");
    router.push("/");
  };

  return (
    data && (
      <>
        <AuthErrorBanner authError={queryError?.message} />
        <ResultsDisplay
          data={data}
          url={url}
          copied={copied}
          onCopySummary={handleCopySummary}
          onNewSummary={handleNewSummary}
        />
      </>
    )
  );
}
