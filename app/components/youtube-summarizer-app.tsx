"use client";

import { useState, useEffect, useRef } from "react";
import { Header } from "./header";
import { AuthErrorBanner } from "./auth-error-banner";
import { InputForm } from "./input-form";
import { ResultsDisplay } from "./results-display";
import { useYouTubeSummarizer } from "@/lib/hooks/useYouTubeSummarizer";
import { useClipboard } from "@/lib/hooks/useClipboard";
import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import type { YouTubeSummarizerAppProps } from "./types";

export function YouTubeSummarizerApp({ initialUrl, user }: YouTubeSummarizerAppProps) {
  const [url, setUrl] = useState(initialUrl || "");
  const hasAutoStarted = useRef(false);

  // Use custom hooks for complex logic
  const {
    isLoading,
    error,
    summary,
    useStreaming,
    streamingStatus,
    authError,
    setError,
    setAuthError,
    setUseStreaming,
    summarizeVideo,
    resetSummarization
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
  };

  const handleCopySummary = async () => {
    if (!summary) return;
    
    const textToCopy = `${summary.title}\n\n${summary.summary}\n\nKey Insights:\n${summary.keyPoints.map(point => `• ${point}`).join('\n')}`;
    await copyToClipboard(textToCopy);
  };

  const handleNewSummary = () => {
    setUrl("");
    resetSummarization();
  };

  // Auto-start summarization if initial URL is provided
  useEffect(() => {
    if (initialUrl && isValidYouTubeUrl(initialUrl) && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      setUrl(initialUrl);
      
      // Use setTimeout to avoid race conditions with state updates
      setTimeout(() => {
        summarizeVideo(initialUrl);
      }, 100);
    }
  }, [initialUrl, summarizeVideo]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      {/* Animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-blob animation-delay-2000"></div>
      </div>

      {/* Header */}
      <Header user={user} />

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-6 py-12 max-w-6xl">
        {/* Authentication Error Banner */}
        <AuthErrorBanner authError={authError} user={user} />

        {!summary ? (
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
            user={user}
          />
        ) : (
          /* Results Interface */
          <ResultsDisplay
            summary={summary}
            url={url}
            copied={copied}
            onCopySummary={handleCopySummary}
            onNewSummary={handleNewSummary}
          />
        )}
      </div>
    </div>
  );
} 