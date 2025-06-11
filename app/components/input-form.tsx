import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StreamingProgress } from "./streaming-progress";
import type { User, StreamingStatus } from "./types";

interface InputFormProps {
  url: string;
  setUrl: (url: string) => void;
  onSummarize: (e: React.FormEvent) => void;
  isLoading: boolean;
  error: string | null;
  authError: string | null;
  setError: (error: string | null) => void;
  setAuthError: (error: string | null) => void;
  useStreaming: boolean;
  setUseStreaming: (streaming: boolean) => void;
  streamingStatus: StreamingStatus | null;
  streamingSummary: string;
  user: User;
}

export function InputForm({
  url,
  setUrl,
  onSummarize,
  isLoading,
  error,
  authError,
  setError,
  setAuthError,
  useStreaming,
  setUseStreaming,
  streamingStatus,
  streamingSummary,
  user
}: InputFormProps) {
  return (
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
          Summarize Your Video
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto">
          Paste any YouTube URL below to unlock deep insights and intelligent summaries
          {user.id === "guest" && (
            <span className="block text-sm text-yellow-400 mt-2">
              🔐 Sign in required to summarize videos
            </span>
          )}
        </p>
      </div>

      <div className="relative group max-w-4xl mx-auto">
        <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-3xl blur-sm opacity-75 group-hover:opacity-100 transition duration-1000 animate-pulse"></div>
        <div className="relative bg-slate-900/90 backdrop-blur-xl border border-white/20 rounded-3xl p-8">
          <form onSubmit={onSummarize} className="space-y-6">
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
                        {streamingStatus ? streamingStatus.message || 'Summarizing...' : 'Summarizing...'}
                      </>
                    ) : user.id === "guest" ? (
                      <>
                        Sign In to Summarize
                        <ArrowRight className="ml-2 h-5 w-5" />
                      </>
                    ) : (
                      <>
                        Summarize
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
              <StreamingProgress streamingStatus={streamingStatus} />
              
              {/* Real-time Streaming Content */}
              {streamingSummary && streamingStatus && streamingStatus.stage === 'summarizing' && (
                <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-3 h-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium text-white">Live Summary</span>
                  </div>
                  <div className="bg-slate-800/50 rounded-lg p-4 border border-white/10 max-h-40 overflow-y-auto">
                    <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                      {streamingSummary}
                      <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-1"></span>
                    </p>
                  </div>
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
  );
} 