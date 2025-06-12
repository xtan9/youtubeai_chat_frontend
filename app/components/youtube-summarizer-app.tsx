"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import { Header } from "./header";
import { AuthErrorBanner } from "./auth-error-banner";
import { InputForm } from "./input-form";
import { ResultsDisplay } from "./results-display";

interface YouTubeSummarizerAppProps {
  initialUrl: string | undefined;
  user: { id: string };
  showInputOnly?: boolean;
  showResultsOnly?: boolean;
}

export function YouTubeSummarizerApp({
  initialUrl,
  user,
  showInputOnly = false,
  showResultsOnly = false,
}: YouTubeSummarizerAppProps) {
  const [url, setUrl] = useState(initialUrl || "");
  const hasAutoStarted = useRef(false);
  const router = useRouter();

  // Use custom hooks for complex logic
  const {
    isLoading,
    error,
    summary,
    useStreaming,
    streamingStatus,
    streamingSummary,
    authError,
    setError,
    setAuthError,
    setUseStreaming,
    summarizeVideo,
    resetSummarization,
  } = useYouTubeSummarizer({ user });

  const { copied, copyToClipboard } = useClipboard();

  const handleSummarize = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!url.trim()) {
      setError("Please enter a video URL");
      return;
    }

    if (!isValidYouTubeUrl(url)) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    await summarizeVideo(url);

    // After successful summarization, redirect to summary page
    if (!showResultsOnly) {
      router.push(`/summary?url=${encodeURIComponent(url)}`);
    }
  };

  const handleCopySummary = async () => {
    if (!summary) return;

    const textToCopy = `${summary.title}\n\n${
      summary.summary
    }\n\nKey Insights:\n${summary.keyPoints
      .map((point) => `• ${point}`)
      .join("\n")}`;
    await copyToClipboard(textToCopy);
  };

  const handleNewSummary = () => {
    setUrl("");
    resetSummarization();
  };

  // Auto-start summarization if URL is provided
  useEffect(() => {
    if (initialUrl && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      summarizeVideo(initialUrl);
    }
  }, [initialUrl, summarizeVideo]);

  return (
    <>
      {/* Authentication Error Banner */}
      <AuthErrorBanner authError={authError} user={user} />

      {(!showResultsOnly && !summary) || (showInputOnly && !summary) ? (
        /* Input Interface */
        <InputForm
          url={url}
          setUrl={setUrl}
          onSummarize={handleSummarize}
          isLoading={isLoading}
          error={error}
          authError={authError}
          setError={setError}
          setAuthError={setAuthError}
          useStreaming={useStreaming}
          setUseStreaming={setUseStreaming}
          streamingStatus={streamingStatus}
          streamingSummary={streamingSummary}
          user={user}
        />
      ) : (!showInputOnly && summary) || (showResultsOnly && summary) ? (
        /* Results Interface */
        <ResultsDisplay
          summary={summary}
          url={url}
          copied={copied}
          onCopySummary={handleCopySummary}
          onNewSummary={handleNewSummary}
        />
      ) : null}
    </>
  );
}
