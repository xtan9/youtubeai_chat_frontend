"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { AuthErrorBanner } from "./auth-error-banner";
import { ResultsDisplay } from "./results-display";

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
  const [summary, setSummary] = useState(null);

  // Use custom hooks for complex logic
  const { streamingSummarizationQuery, summarizationQuery } =
    useYouTubeSummarizer(url);
  const currentQuery = useStreaming
    ? streamingSummarizationQuery
    : summarizationQuery;
  const { data, isLoading, error: queryError } = currentQuery;

  const { copied, copyToClipboard } = useClipboard();

  useEffect(() => {
    currentQuery.refetch();
  }, []);

  const handleCopySummary = async () => {
    // if (!summary) return;

    // const textToCopy = `${data?.title}\n\n${
    //   data?.summary
    // }\n\nKey Insights:\n${data?.keyPoints
    //   .map((point) => `• ${point}`)
    //   .join("\n")}`;
    // await copyToClipboard(textToCopy);
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
