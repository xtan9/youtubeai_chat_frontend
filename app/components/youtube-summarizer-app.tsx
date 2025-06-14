"use client";

import { useState, useRef, useEffect } from "react";
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
  const { data: rawData, isLoading, error: queryError } = currentQuery;

  // Handle streaming data (array) vs regular data (single object)
  const data =
    useStreaming && Array.isArray(rawData)
      ? rawData[rawData.length - 1] // Get the latest result from streaming array
      : (rawData as SummaryResult | undefined);

  const { copied, copyToClipboard } = useClipboard();

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
