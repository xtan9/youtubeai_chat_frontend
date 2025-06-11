import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getAuthErrorInfo } from '@/lib/utils/youtube';
import type { SummaryResult, StreamingStatus } from '@/app/components/types';

interface UseYouTubeAnalysisProps {
  user: { id: string };
}

export function useYouTubeAnalysis({ user }: UseYouTubeAnalysisProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [useStreaming, setUseStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus | null>(null);
  const [streamingSummary, setStreamingSummary] = useState<string>("");
  const [currentRequestUrl, setCurrentRequestUrl] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const handleAuthError = useCallback((status: number, message: string) => {
    const errorInfo = getAuthErrorInfo(status, message);
    setAuthError(errorInfo.message);
    
    if (errorInfo.shouldRedirect && user.id !== "guest") {
      setTimeout(() => {
        router.push("/auth");
      }, errorInfo.redirectDelay);
    }
  }, [user.id, router]);

  const handleRegularAnalysis = useCallback(async (url: string) => {
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
  }, [supabase.auth]);

  const handleStreamingAnalysis = useCallback(async (url: string) => {
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
        await handleRegularAnalysis(url);
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
              if (!jsonStr) continue;
              
              const data = JSON.parse(jsonStr);
              
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
                setStreamingSummary(prev => prev + data.text);
                setStreamingStatus({
                  stage: 'summarizing',
                  message: 'Generating summary...'
                });
              } else if (data.type === 'summary') {
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
        
        if (apiError.status === 422 || apiError.status === 404) {
          console.warn("Streaming endpoint not available, falling back to regular analysis");
          setStreamingStatus({ 
            stage: 'downloading', 
            message: 'Streaming unavailable, using standard analysis...' 
          });
          await handleRegularAnalysis(url);
          return;
        }
      }
      
      throw error;
    }
  }, [supabase.auth, streamingSummary, handleAuthError, handleRegularAnalysis]);

  const analyzeVideo = useCallback(async (url: string) => {
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
        await handleStreamingAnalysis(url);
      } else {
        await handleRegularAnalysis(url);
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
      setCurrentRequestUrl("");
      abortControllerRef.current = null;
    }
  }, [user.id, router, isLoading, currentRequestUrl, useStreaming, handleStreamingAnalysis, handleRegularAnalysis]);

  const resetAnalysis = useCallback(() => {
    // Abort any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    setSummary(null);
    setError(null);
    setAuthError(null);
    setStreamingStatus(null);
    setStreamingSummary("");
    setCurrentRequestUrl("");
    setIsLoading(false);
  }, []);

  return {
    // State
    isLoading,
    error,
    summary,
    useStreaming,
    streamingStatus,
    authError,
    
    // State setters
    setError,
    setAuthError,
    setUseStreaming,
    
    // Actions
    analyzeVideo,
    resetAnalysis
  };
} 