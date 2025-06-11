import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getAuthErrorInfo } from '@/lib/utils/youtube';
import type { SummaryResult, StreamingStatus } from '@/app/components/types';

interface UseYouTubeSummarizerProps {
  user: { id: string };
}

export function useYouTubeSummarizer({ user }: UseYouTubeSummarizerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [useStreaming, setUseStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus | null>(null);
  const [streamingSummary, setStreamingSummary] = useState<string>("");
  const [currentRequestUrl, setCurrentRequestUrl] = useState<string>("");
  const [authError, setAuthError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingSummaryRef = useRef<string>("");
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

  const handleRegularSummarization = useCallback(async (url: string) => {
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
    
    setSummary({
      title: data.detected_category || "Video Summary",
      duration: `${data.timing?.total?.toFixed(1) || 0}s total`,
      summary: data.summary || "No summary available",
      keyPoints: [],
      transcriptionTime: data.timing?.transcribe || 0,
      summaryTime: data.timing?.summarize || 0,
    });
  }, [supabase.auth]);

  const handleStreamingSummarization = useCallback(async (url: string) => {
    const startTime = Date.now();
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }

    // First test if the API is reachable
    try {
      const healthResponse = await fetch("https://api.youtubeai.chat/health", {
        method: "GET",
        signal: AbortSignal.timeout(10000)
      });
    } catch (healthError) {
      throw new Error("API server is not reachable. Please check your internet connection.");
    }

    // Add timeout to the fetch request
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);
    
    let response;
    try {
      response = await fetch("https://api.youtubeai.chat/summarize/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ youtube_url: url }),
        signal: abortControllerRef.current?.signal || controller.signal,
      });
      
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }


    
    if (!response.ok) {
      let errorMessage = `Server error: ${response.status}`;
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch {
        // If we can't parse the error response, use the status
      }
      
      // If streaming fails, fallback to regular summarization
      if (response.status === 422 || response.status === 404) {
        setStreamingStatus({ 
          stage: 'downloading', 
          message: 'Streaming unavailable, using standard summarization...' 
        });
        await handleRegularSummarization(url);
        return;
      }
      
      throw new Error(errorMessage);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get response reader");
    }


    let chunkCount = 0;
    let totalBytesReceived = 0;
    const readStartTime = Date.now();
    
    try {
      const decoder = new TextDecoder();
      let buffer = "";
      let hasReceivedData = false;

      while (true) {
        const { done, value } = await reader.read();
        
        if (value) {
          chunkCount++;
          totalBytesReceived += value.length;
        }
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (line.trim() && line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;
            
            try {
              hasReceivedData = true;
              const data = JSON.parse(jsonStr);
              
              if (data.type === 'status') {
                // Determine stage and progress based on message content
                let stage: 'downloading' | 'transcribing' | 'summarizing' | 'complete' = 'downloading';
                let progress = 10;
                
                if (data.message?.includes('Downloading')) {
                  stage = 'downloading';
                  progress = 10;
                } else if (data.message?.includes('Transcribing')) {
                  stage = 'transcribing';
                  progress = 30;
                } else if (data.message?.includes('summary') || data.message?.includes('Generating')) {
                  stage = 'summarizing';
                  progress = 60;
                }
                
                setStreamingStatus({
                  stage,
                  message: data.message,
                  progress
                });
              } else if (data.type === 'cached') {
                // Handle cached results - show rapid progress then complete
                setStreamingStatus({
                  stage: 'downloading',
                  message: 'Found cached result...',
                  progress: 25
                });
                setTimeout(() => {
                  setStreamingStatus({
                    stage: 'complete',
                    message: 'Retrieved cached summary!',
                    progress: 100
                  });
                  if (data.summary) {
                    setSummary({
                      title: data.category || data.title || "Video Summary",
                      duration: `${data.total_time?.toFixed(1) || 0}s total`,
                      summary: data.summary,
                      keyPoints: data.key_points || [],
                      transcriptionTime: 0,
                      summaryTime: data.total_time || 0,
                    });
                  }
                }, 500);
              } else if (data.type === 'timing') {
                let stage: 'downloading' | 'transcribing' | 'summarizing' | 'complete';
                let progress = 0;
                switch (data.stage) {
                  case 'download':
                    stage = 'downloading';
                    progress = 25;
                    break;
                  case 'transcribe':
                    stage = 'transcribing';
                    progress = 50;
                    break;
                  case 'cache':
                    stage = 'complete';
                    progress = 100;
                    break;
                  case 'total':
                    stage = 'complete';
                    progress = 100;
                    break;
                  default:
                    stage = 'summarizing';
                    progress = 75;
                }
                setStreamingStatus({
                  stage,
                  message: data.message || `${data.stage} completed in ${data.time}s`,
                  progress
                });
              } else if (data.type === 'metadata') {
                const isCached = data.cached === true;
                setStreamingStatus({
                  stage: isCached ? 'complete' : 'summarizing',
                  message: isCached 
                    ? `Found cached ${data.category} summary!`
                    : `Generating summary for ${data.category} content...`,
                  progress: isCached ? 100 : 70
                });
              } else if (data.type === 'progress') {
                // Handle real-time progress updates from backend
                let stage: 'downloading' | 'transcribing' | 'summarizing' | 'complete' = 'downloading';
                if (data.stage === 'download') {
                  stage = 'downloading';
                } else if (data.stage === 'transcribe') {
                  stage = 'transcribing';
                }
                
                setStreamingStatus({
                  stage,
                  message: data.message,
                  progress: data.progress || Math.min(95, 20 + (data.elapsed || 0) * 2)
                });
              } else if (data.type === 'transcript') {
                setStreamingStatus({
                  stage: 'transcribing',
                  message: 'Transcription completed, starting summary...',
                  progress: 60
                });
              } else if (data.type === 'content') {
                streamingSummaryRef.current += data.text;
                setStreamingSummary(streamingSummaryRef.current);
                setStreamingStatus({
                  stage: 'summarizing',
                  message: 'Generating summary...',
                  progress: Math.min(95, 80 + (streamingSummaryRef.current.length / 10))
                });
              } else if (data.type === 'summary') {
                // Handle final summary - could be from streaming or cached
                const finalSummary = streamingSummaryRef.current || '';
                
                setSummary({
                  title: data.category || "Video Summary",
                  duration: `${data.total_time?.toFixed(1) || 0}s total`,
                  summary: finalSummary,
                  keyPoints: [], // Backend doesn't send key_points in streaming
                  transcriptionTime: data.transcribe_time || 0,
                  summaryTime: data.summarize_time || 0,
                });
                
                setStreamingStatus({ stage: 'complete', message: 'Summary complete!', progress: 100 });
              } else if (data.type === 'complete' || (data.summary && !data.type)) {
                // Handle immediate complete results (likely cached)
                setStreamingStatus({
                  stage: 'complete',
                  message: 'Summary retrieved!',
                  progress: 100
                });
                setSummary({
                  title: data.category || data.title || "Video Summary",
                  duration: `${data.total_time?.toFixed(1) || 0}s total`,
                  summary: data.summary,
                  keyPoints: data.key_points || [],
                  transcriptionTime: data.transcription_time || 0,
                  summaryTime: data.total_time || 0,
                });
              } else if (data.type === 'test') {
                // Handle test messages
                setStreamingStatus({
                  stage: 'downloading',
                  message: data.message,
                  progress: 5
                });
              }
            } catch (parseError) {
              // Silently handle parse errors
            }
          }
        }
      }
      
      // Handle case where stream ended without any data (possibly cached result returned as regular response)
      if (!hasReceivedData) {
        setStreamingStatus({ 
          stage: 'complete', 
          message: 'Summary retrieved!',
          progress: 100 
        });
        
        // For cases where no streaming data was received, fall back to regular summarization
        // This handles cached results that might be returned as regular JSON responses

        await handleRegularSummarization(url);
        return;
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        const apiError = error as { status: number; message: string };
        if (apiError.status === 401 || apiError.status === 429) {
          handleAuthError(apiError.status, apiError.message);
          throw error;
        }
        
        if (apiError.status === 422 || apiError.status === 404) {
          setStreamingStatus({ 
            stage: 'downloading', 
            message: 'Streaming unavailable, using standard summarization...' 
          });
          await handleRegularSummarization(url);
          return;
        }
      }
      
      throw error;
    }
  }, [supabase.auth, handleAuthError, handleRegularSummarization]);

  const summarizeVideo = useCallback(async (url: string) => {
    // Check authentication first
    if (user.id === "guest") {
      router.push("/auth/login");
      return;
    }
    
    // Prevent duplicate calls if already loading or same URL
    if (isLoading) {
      return;
    }
    
    if (currentRequestUrl === url.trim()) {
      return;
    }
    
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
    setStreamingStatus(useStreaming ? { stage: 'downloading', message: 'Starting video processing...', progress: 0 } : null);
    setStreamingSummary("");
    streamingSummaryRef.current = "";

    try {
      if (useStreaming) {
        await handleStreamingSummarization(url);
      } else {
        await handleRegularSummarization(url);
      }
    } catch (error) {
      // Don't show error if request was aborted
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      
      setError(error instanceof Error ? error.message : "Failed to summarize video. Please try again.");
    } finally {
      setIsLoading(false);
      // Don't clear streaming status immediately - let it show completion state briefly
      setTimeout(() => {
        setStreamingStatus(null);
      }, 1000);
      setCurrentRequestUrl("");
      abortControllerRef.current = null;
    }
  }, [user.id, router, isLoading, currentRequestUrl, useStreaming, handleStreamingSummarization, handleRegularSummarization]);

  const resetSummarization = useCallback(() => {
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
    streamingSummaryRef.current = "";
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
    streamingSummary,
    authError,
    
    // State setters
    setError,
    setAuthError,
    setUseStreaming,
    
    // Actions
    summarizeVideo,
    resetSummarization
  };
} 