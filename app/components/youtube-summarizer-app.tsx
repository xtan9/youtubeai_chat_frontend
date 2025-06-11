"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Header } from "./header";
import { AuthErrorBanner } from "./auth-error-banner";
import { InputForm } from "./input-form";
import { ResultsDisplay } from "./results-display";
import type { SummaryResult, StreamingStatus, YouTubeSummarizerAppProps } from "./types";

export function YouTubeSummarizerApp({ initialUrl, user }: YouTubeSummarizerAppProps) {
  const [url, setUrl] = useState(initialUrl || "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [useStreaming, setUseStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus | null>(null);
  const [streamingSummary, setStreamingSummary] = useState<string>("");
  const [currentRequestUrl, setCurrentRequestUrl] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);
  const hasAutoStarted = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const isValidYouTubeUrl = (url: string) => {
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
    return youtubeRegex.test(url);
  };

  const handleAuthError = useCallback((status: number, message: string) => {
    if (status === 401) {
      setAuthError("Authentication failed. Please sign in again.");
      // For authenticated users, redirect to sign in
      if (user.id !== "guest") {
        setTimeout(() => {
          router.push("/auth");
        }, 3000);
      }
    } else if (status === 429) {
      setAuthError("Rate limit exceeded. Please wait before trying again.");
    } else {
      setAuthError(message);
    }
  }, [user.id, router]);

  const handleAnalyze = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check authentication first
    if (user.id === "guest") {
      console.log("Unauthenticated user attempted analysis, redirecting to auth");
      router.push("/auth/login");
      return;
    }
    
    // Prevent duplicate calls if already loading or same URL
    if (isLoading) {
      console.log("Analysis already in progress, ignoring duplicate call");
      return;
    }
    
    if (currentRequestUrl === url.trim()) {
      console.log("Same URL already being processed, ignoring duplicate call");
      return;
    }
    
    if (!url.trim()) {
      setError("Please enter a video URL");
      return;
    }

    if (!isValidYouTubeUrl(url)) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    console.log("Starting analysis for:", url);
    
    // Abort any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    setCurrentRequestUrl(url.trim());
    setIsLoading(true);
    setError(null);
    setAuthError(null);
    setSummary(null);
    setStreamingStatus(null);
    setStreamingSummary("");

    try {
      if (useStreaming) {
        await handleStreamingAnalysis();
      } else {
        await handleRegularAnalysis();
      }
    } catch (error) {
      console.error("Error:", error);
      
      // Don't show error if request was aborted
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log("Request was aborted");
        return;
      }
      
      setError(error instanceof Error ? error.message : "Failed to analyze video. Please try again.");
    } finally {
      setIsLoading(false);
      setStreamingStatus(null);
      setCurrentRequestUrl(""); // Clear the current request URL when done
      abortControllerRef.current = null; // Clear the abort controller
    }
  }, [user.id, router, isLoading, currentRequestUrl, url, useStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegularAnalysis = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }

    const response = await fetch("https://api.youtubeai.chat/summarize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ youtube_url: url }),
      signal: abortControllerRef.current?.signal,
    });

    if (!response.ok) {
      // Try to get the error message from the response
      let errorMessage = `Server error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // If we can't parse the error response, use the status
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    console.log("API Response:", data);
    
    setSummary({
      title: data.detected_category || "Video Analysis",
      duration: `${data.timing?.total?.toFixed(1) || 0}s total`,
      summary: data.summary || "No summary available",
      keyPoints: [],
      transcriptionTime: data.timing?.transcribe || 0,
      summaryTime: data.timing?.summarize || 0,
    });
  }, [url, supabase.auth]);

  const handleStreamingAnalysis = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }

    const response = await fetch("https://api.youtubeai.chat/summarize/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ youtube_url: url }),
      signal: abortControllerRef.current?.signal,
    });

    if (!response.ok) {
      // Try to get the error message from the response
      let errorMessage = `Server error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // If we can't parse the error response, use the status
      }
      
      // If streaming fails, fallback to regular analysis
      if (response.status === 422 || response.status === 404) {
        console.warn("Streaming endpoint not available, falling back to regular analysis");
        setStreamingStatus({ 
          stage: 'downloading', 
          message: 'Streaming unavailable, using standard analysis...' 
        });
        await handleRegularAnalysis();
        return;
      }
      
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get response reader");
    }

    try {
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() && line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue; // Skip empty data lines
              
              const data = JSON.parse(jsonStr);
              
              // Handle different event types from backend
              if (data.type === 'status') {
                setStreamingStatus({
                  stage: 'downloading',
                  message: data.message
                });
              } else if (data.type === 'timing') {
                let stage: 'downloading' | 'transcribing' | 'summarizing' | 'complete';
                switch (data.stage) {
                  case 'download':
                    stage = 'downloading';
                    break;
                  case 'transcribe':
                    stage = 'transcribing';
                    break;
                  default:
                    stage = 'summarizing';
                }
                setStreamingStatus({
                  stage,
                  message: `${data.stage} completed in ${data.time}s`
                });
              } else if (data.type === 'metadata') {
                setStreamingStatus({
                  stage: 'summarizing',
                  message: `Generating summary for ${data.category} content...`
                });
              } else if (data.type === 'content') {
                // Build up the streaming summary
                setStreamingSummary(prev => prev + data.text);
                setStreamingStatus({
                  stage: 'summarizing',
                  message: 'Generating summary...'
                });
              } else if (data.type === 'summary') {
                // Final summary completion
                setSummary({
                  title: data.category || "Video Analysis",
                  duration: `${data.total_time.toFixed(1)}s total`,
                  summary: streamingSummary,
                  keyPoints: [],
                  transcriptionTime: 0,
                  summaryTime: data.total_time || 0,
                });
                setStreamingStatus({ stage: 'complete', message: 'Analysis complete!' });
              }
            } catch (parseError) {
              console.error("Failed to parse streaming data:", parseError);
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        const apiError = error as { status: number; message: string };
        if (apiError.status === 401 || apiError.status === 429) {
          handleAuthError(apiError.status, apiError.message);
          throw error;
        }
        
        // If streaming fails, fallback to regular analysis
        if (apiError.status === 422 || apiError.status === 404) {
          console.warn("Streaming endpoint not available, falling back to regular analysis");
          setStreamingStatus({ 
            stage: 'downloading', 
            message: 'Streaming unavailable, using standard analysis...' 
          });
          await handleRegularAnalysis();
          return;
        }
      }
      
      throw error;
    }
  }, [url, supabase.auth, streamingSummary, handleAuthError, handleRegularAnalysis]);

  const handleCopyAnalysis = async () => {
    if (!summary) return;
    
    const textToCopy = `${summary.title}\n\n${summary.summary}\n\nKey Insights:\n${summary.keyPoints.map(point => `• ${point}`).join('\n')}`;
    
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const handleNewAnalysis = () => {
    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    setUrl("");
    setSummary(null);
    setError(null);
    setAuthError(null);
    setStreamingStatus(null);
    setStreamingSummary("");
    setCurrentRequestUrl("");
    setIsLoading(false);
  };

  useEffect(() => {
    if (initialUrl && isValidYouTubeUrl(initialUrl) && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      setUrl(initialUrl);
      
      // Use setTimeout to avoid race conditions with state updates
      setTimeout(() => {
        handleAnalyze({ preventDefault: () => {} } as React.FormEvent);
      }, 100);
    }
  }, [initialUrl, handleAnalyze]);

  // Cleanup effect for component unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

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
            onAnalyze={handleAnalyze}
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
            onCopyAnalysis={handleCopyAnalysis}
            onNewAnalysis={handleNewAnalysis}
          />
        )}
      </div>
    </div>
  );
} 