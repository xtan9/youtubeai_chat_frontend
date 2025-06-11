import { Loader2, Play, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { StreamingStatus, User } from "./types";

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
  setUseStreaming: (use: boolean) => void;
  streamingStatus: StreamingStatus | null;
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
  user
}: InputFormProps) {
  const handleUrlChange = (value: string) => {
    setUrl(value);
    if (error) setError(null);
    if (authError) setAuthError(null);
  };

  return (
    <div className="max-w-4xl mx-auto text-center space-y-8">
      <div className="space-y-4">
        <h1 className="text-5xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          Summarize Your Video
        </h1>
        <p className="text-xl text-gray-300 max-w-3xl mx-auto">
          Paste any YouTube URL below to unlock deep insights and intelligent summaries
        </p>
        {user.id === "guest" && (
          <p className="text-sm text-yellow-400 bg-yellow-400/10 rounded-lg p-3 max-w-md mx-auto">
            🔐 Sign in required to summarize videos
          </p>
        )}
      </div>

      <div className="max-w-2xl mx-auto space-y-6">
        {/* URL Input Form */}
        <form onSubmit={onSummarize} className="space-y-6">
          <div className="space-y-2">
            <Input
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="h-14 text-lg bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-purple-400"
              disabled={isLoading}
            />
            {error && (
              <p className="text-red-400 text-sm text-left">{error}</p>
            )}
          </div>

          {/* Streaming Option */}
          <div className="flex items-center space-x-2 justify-center">
            <Checkbox
              id="streaming"
              checked={useStreaming}
              onCheckedChange={(checked) => setUseStreaming(checked === true)}
              disabled={isLoading}
            />
            <label htmlFor="streaming" className="text-sm text-gray-300">
              Enable real-time streaming (beta)
            </label>
          </div>

          {/* Streaming Status */}
          {streamingStatus && (
            <div className="text-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <div className="flex items-center justify-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-blue-300">
                  {streamingStatus ? streamingStatus.message || 'Summarizing...' : 'Summarizing...'}
                </span>
              </div>
            </div>
          )}

          {user.id === "guest" ? (
            <Button size="lg" className="w-full h-14 text-lg bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600" disabled>
              <Lock className="mr-2 h-5 w-5" />
              Sign In to Summarize
            </Button>
          ) : (
            <Button 
              type="submit" 
              size="lg" 
              disabled={isLoading || !url.trim()} 
              className="w-full h-14 text-lg bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Summarizing...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-5 w-5" />
                  Summarize
                </>
              )}
            </Button>
          )}
        </form>
      </div>
    </div>
  );
} 