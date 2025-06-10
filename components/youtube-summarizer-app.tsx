"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Brain,
  Clock, 
  LogOut,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  TrendingUp,
  Zap,
  ArrowRight,
  AlertCircle
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { ProfileAvatar } from "./profile-avatar";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';


interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

interface YouTubeSummarizerAppProps {
  initialUrl?: string;
  user: User;
}

interface SummaryResult {
  title: string;
  duration: string;
  summary: string;
  keyPoints: string[];
  transcriptionTime: number;
  summaryTime: number;
}

interface StreamingStatus {
  stage: 'downloading' | 'transcribing' | 'summarizing' | 'complete';
  progress?: number;
  message?: string;
}

// Removed unused interface - using direct response data

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

  const handleAuthError = (status: number, message: string) => {
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
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleAnalyze = async (e: React.FormEvent) => {
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
  };

  const handleRegularAnalysis = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }

    const response = await fetch("http://api.youtubeai.chat/summarize", {
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
  };

  const handleStreamingAnalysis = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error("Authentication required. Please log in.");
    }

    const response = await fetch("http://api.youtubeai.chat/summarize/stream", {
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
  };

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
  }, [initialUrl]);

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
      <header className="relative z-50 border-b border-white/10 backdrop-blur-md bg-white/5">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-xl flex items-center justify-center transform group-hover:scale-110 transition-transform">
                <Brain size={20} className="text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                youtubeai.chat
              </span>
            </Link>
            
            <div className="flex items-center gap-4">
              {/* Authentication Status and Actions */}
              {user.id === "guest" ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                    <span className="text-gray-300">Not authenticated</span>
                  </div>
                  <Button 
                    onClick={() => router.push("/auth/login")}
                    className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white rounded-full px-6"
                  >
                    Sign In
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-gray-300">Authenticated</span>
                  </div>
                  <ProfileAvatar user={user} />
                  <Button variant="ghost" size="sm" onClick={handleSignOut} className="text-gray-300 hover:text-white hover:bg-white/10 rounded-full">
                    <LogOut size={16} />
                    <span className="ml-2 hidden sm:inline">Sign Out</span>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-6 py-12 max-w-6xl">
        {/* Authentication Error Banner */}
        {authError && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-400 font-medium">Authentication Error</p>
                <p className="text-red-300 text-sm mt-1">{authError}</p>
                {user.id !== "guest" && (
                  <p className="text-red-300 text-xs mt-2">Redirecting to sign in page in 3 seconds...</p>
                )}
              </div>
            </div>
          </div>
        )}

        {!summary ? (
          /* Input Interface */
          <div className="space-y-12">
            <div className="text-center space-y-6">
              <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 border border-white/20">
                <Sparkles size={16} className="text-purple-400" />
                <span className="text-sm font-medium">AI Video Intelligence</span>
                {user.id !== "guest" && (
                  <span className="text-xs text-green-400">• Authenticated</span>
                )}
              </div>
              <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
                Analyze Your Video
              </h1>
              <p className="text-xl text-gray-300 max-w-2xl mx-auto">
                Paste any YouTube URL below to unlock deep insights and intelligent analysis
                {user.id === "guest" && (
                  <span className="block text-sm text-yellow-400 mt-2">
                    🔐 Sign in required to analyze videos
                  </span>
                )}
              </p>
            </div>

            <div className="relative group max-w-4xl mx-auto">
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-3xl blur-sm opacity-75 group-hover:opacity-100 transition duration-1000 animate-pulse"></div>
              <div className="relative bg-slate-900/90 backdrop-blur-xl border border-white/20 rounded-3xl p-8">
                <form onSubmit={handleAnalyze} className="space-y-6">
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl"></div>
                    <div className="relative bg-white/5 backdrop-blur-sm border border-white/20 rounded-2xl p-1">
                      <div className="flex flex-col md:flex-row gap-3">
                        <div className="flex-1 relative">
                          <Input
                            type="url"
                            placeholder="Enter YouTube URL here..."
                            value={url}
                            onChange={(e) => {
                              setUrl(e.target.value);
                              setError(null);
                              setAuthError(null);
                            }}
                            className="h-16 text-lg bg-transparent border-0 text-white placeholder:text-gray-400 focus:ring-0 focus:outline-none"
                          />
                        </div>
                        <Button 
                          type="submit" 
                          size="lg" 
                          className="h-16 px-8 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white font-semibold text-lg rounded-xl border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
                          disabled={isLoading || !!authError}
                        >
                          {isLoading ? (
                            <>
                              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"></div>
                              {streamingStatus ? streamingStatus.message || 'Analyzing...' : 'Analyzing...'}
                            </>
                          ) : user.id === "guest" ? (
                            <>
                              Sign In to Analyze
                              <ArrowRight className="ml-2 h-5 w-5" />
                            </>
                          ) : (
                            <>
                              Analyze
                              <ArrowRight className="ml-2 h-5 w-5" />
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Streaming Mode Toggle */}
                    <div className="flex flex-col items-center gap-2 text-sm">
                      <label className={`flex items-center gap-2 ${user.id === "guest" ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
                        <input
                          type="checkbox"
                          checked={useStreaming}
                          onChange={(e) => setUseStreaming(e.target.checked)}
                          disabled={user.id === "guest"}
                          className="sr-only"
                        />
                        <div className={`relative w-11 h-6 rounded-full transition-colors ${useStreaming && user.id !== "guest" ? 'bg-gradient-to-r from-purple-500 to-cyan-500' : 'bg-gray-600'}`}>
                          <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${useStreaming && user.id !== "guest" ? 'translate-x-5' : 'translate-x-0'}`}></div>
                        </div>
                        <span className="text-gray-300">Real-time progress</span>
                      </label>
                      <p className="text-xs text-gray-500 text-center max-w-md">
                        {user.id === "guest" 
                          ? "🔐 Sign in required for streaming mode"
                          : useStreaming 
                            ? "🚧 Streaming mode (under development - may have issues)"
                            : "✅ Standard processing (recommended)"
                        }
                      </p>
                    </div>

                    {/* Streaming Progress */}
                    {streamingStatus && (
                      <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-white capitalize">
                            {streamingStatus.stage.replace('_', ' ')}
                          </span>
                          {streamingStatus.progress && (
                            <span className="text-sm text-gray-400">
                              {Math.round(streamingStatus.progress)}%
                            </span>
                          )}
                        </div>
                        {streamingStatus.progress && (
                          <div className="w-full bg-gray-700 rounded-full h-2">
                            <div 
                              className="bg-gradient-to-r from-purple-500 to-cyan-500 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${streamingStatus.progress}%` }}
                            ></div>
                          </div>
                        )}
                        {streamingStatus.message && (
                          <p className="text-sm text-gray-400 mt-2">{streamingStatus.message}</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {error && (
                    <div className="text-center">
                      <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg py-3 px-4 inline-block">
                        {error}
                      </p>
                    </div>
                  )}
                </form>
              </div>
            </div>
          </div>
        ) : (
          /* Results Interface */
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                  Video Analysis Complete
                </h1>
                <p className="text-gray-400 mt-2">AI-powered insights and key takeaways</p>
              </div>
              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  onClick={handleCopyAnalysis}
                  className="bg-white/5 border-white/20 text-white hover:bg-white/10"
                >
                  {copied ? (
                    <>
                      <Check className="mr-2 h-4 w-4 text-green-400" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy Analysis
                    </>
                  )}
                </Button>
                <Button 
                  onClick={handleNewAnalysis}
                  className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  New Analysis
                </Button>
              </div>
            </div>

            {/* Video Info Card */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/30 to-cyan-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
              <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                <div className="flex items-start justify-between">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-bold text-white">{summary.title}</h2>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                        {summary.title.replace('Video Analysis', '').replace('Analysis', '').trim() || 'Content'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                      <div className="flex items-center gap-2 bg-purple-500/10 rounded-lg p-3 border border-purple-500/20">
                        <Clock size={16} className="text-purple-400" />
                        <div>
                          <div className="text-purple-400 font-medium">Total Duration</div>
                          <div className="text-white">{summary.duration}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 bg-cyan-500/10 rounded-lg p-3 border border-cyan-500/20">
                        <Zap size={16} className="text-cyan-400" />
                        <div>
                          <div className="text-cyan-400 font-medium">Processing</div>
                          <div className="text-white">{(summary.transcriptionTime + summary.summaryTime).toFixed(1)}s</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 bg-green-500/10 rounded-lg p-3 border border-green-500/20">
                        <Sparkles size={16} className="text-green-400" />
                        <div>
                          <div className="text-green-400 font-medium">AI Model</div>
                          <div className="text-white">qwen2.5:14b</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" asChild className="text-gray-400 hover:text-white hover:bg-white/10 rounded-lg p-2">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
                      <ExternalLink size={18} />
                      <span className="hidden sm:inline">View Video</span>
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            {/* Analysis Content */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500/30 to-purple-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
              <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-8">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-12 h-12 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center">
                    <Brain className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold text-white">AI Summary</h3>
                    <p className="text-sm text-gray-400">Intelligent analysis and key insights</p>
                  </div>
                </div>
                
                <div className="space-y-6">
                  {/* Render summary with ReactMarkdown */}
                  <div className="bg-gradient-to-r from-slate-800/50 to-slate-700/50 rounded-xl p-6 border border-white/10">
                    <div className="prose prose-lg prose-invert max-w-none">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                        h1: ({children}) => <h1 className="text-2xl font-bold text-white border-b border-cyan-400/30 pb-2 mb-4">{children}</h1>,
                        h2: ({children}) => <h2 className="text-xl font-semibold text-cyan-400 mt-6 mb-3">{children}</h2>,
                        h3: ({children}) => <h3 className="text-lg font-medium text-purple-400 mt-4 mb-2">{children}</h3>,
                        p: ({children}) => <p className="text-gray-200 leading-relaxed mb-4 text-lg">{children}</p>,
                        ul: ({children}) => <ul className="list-disc list-inside space-y-2 text-gray-200 mb-4 ml-4">{children}</ul>,
                        ol: ({children}) => <ol className="list-decimal list-inside space-y-2 text-gray-200 mb-4 ml-4">{children}</ol>,
                        li: ({children}) => <li className="text-gray-200 leading-relaxed">{children}</li>,
                        strong: ({children}) => <strong className="font-semibold text-white">{children}</strong>,
                        em: ({children}) => <em className="italic text-cyan-300">{children}</em>,
                        blockquote: ({children}) => (
                          <blockquote className="border-l-4 border-purple-400 pl-4 italic text-gray-300 bg-purple-500/5 py-2 rounded-r-lg">
                            {children}
                          </blockquote>
                        ),
                        code: ({children}) => (
                          <code className="bg-slate-700 text-cyan-300 px-2 py-1 rounded text-sm font-mono">
                            {children}
                          </code>
                        ),
                        pre: ({children}) => (
                          <pre className="bg-slate-900 text-gray-200 p-4 rounded-lg overflow-x-auto border border-slate-600">
                            {children}
                          </pre>
                        ),
                      }}
                                            >
                          {summary.summary}
                        </ReactMarkdown>
                      </div>
                    </div>

                  {/* Summary Stats */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-white/10">
                    <div className="text-center p-4 bg-gradient-to-r from-purple-500/10 to-purple-600/10 rounded-lg border border-purple-500/20">
                      <div className="text-2xl font-bold text-purple-400">{summary.summary.split(' ').length}</div>
                      <div className="text-sm text-gray-400">Words in Summary</div>
                    </div>
                    <div className="text-center p-4 bg-gradient-to-r from-cyan-500/10 to-cyan-600/10 rounded-lg border border-cyan-500/20">
                      <div className="text-2xl font-bold text-cyan-400">{summary.transcriptionTime.toFixed(1)}s</div>
                      <div className="text-sm text-gray-400">Transcription</div>
                    </div>
                    <div className="text-center p-4 bg-gradient-to-r from-green-500/10 to-green-600/10 rounded-lg border border-green-500/20">
                      <div className="text-2xl font-bold text-green-400">{summary.summaryTime.toFixed(1)}s</div>
                      <div className="text-sm text-gray-400">AI Processing</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Key Insights */}
            {summary.keyPoints.length > 0 && (
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-pink-500/30 to-purple-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-white">Key Insights</h3>
                  </div>
                  <div className="space-y-4">
                    {summary.keyPoints.map((point, index) => (
                      <div key={index} className="flex gap-4 items-start">
                        <div className="w-6 h-6 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-1">
                          {index + 1}
                        </div>
                        <p className="text-gray-300 text-lg leading-relaxed">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 