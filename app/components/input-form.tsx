"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import { ArrowRight, Sparkles, Brain } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function InputForm() {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [enableReasoning, setEnableReasoning] = useState(true);
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const onSummarize = async (e: React.FormEvent) => {
    setIsLoading(true);
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const formUrl = formData.get("url") as string;

    if (!formUrl?.trim()) {
      setError("Please enter a video URL");
      setIsLoading(false);
      return;
    }
    if (!isValidYouTubeUrl(formUrl)) {
      setError("Please enter a valid YouTube URL");
      setIsLoading(false);
      return;
    }
    setError(null);
    setUrl(formUrl);
    router.push(
      `/summary?url=${encodeURIComponent(formUrl)}&reasoning=${enableReasoning}`
    );
  };

  return (
    <div className="space-y-12">
      <div className="text-center space-y-6">
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 border border-white/20 mt-5">
          <Sparkles size={16} className="text-purple-400" />
          <span className="text-sm font-medium">AI Video Intelligence</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
          Summarize Your Video
        </h1>
        <p className="text-xl text-gray-300 max-w-2xl mx-auto">
          Paste any YouTube URL below to unlock deep insights and intelligent
          summaries
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
                      name="url"
                      placeholder="Enter YouTube URL here..."
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                      }}
                      className="h-16 text-lg bg-transparent border-0 text-white placeholder:text-gray-400 focus:ring-0 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setUrl("");
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white text-sm"
                    >
                      ✕
                    </button>
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="h-16 px-8 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white font-semibold text-lg rounded-xl border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"></div>
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

              {/* Reasoning Toggle */}
              <div className="flex flex-col items-center gap-2 text-sm mt-4">
                <label className={`flex items-center gap-2`}>
                  <input
                    type="checkbox"
                    checked={enableReasoning}
                    onChange={(e) => setEnableReasoning(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      enableReasoning
                        ? "bg-gradient-to-r from-purple-500 to-cyan-500"
                        : "bg-gray-600"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        enableReasoning ? "translate-x-5" : "translate-x-0"
                      }`}
                    ></div>
                  </div>
                  <span className="text-gray-300 flex items-center gap-2">
                    <Brain size={16} className="text-gray-400" />
                    Enable Reasoning
                  </span>
                </label>
                <p className="text-xs text-gray-500 text-center max-w-md">
                  {enableReasoning
                    ? "🧠 Reasoning mode will provide deeper insights and explanations"
                    : "✅ Standard summary (recommended)"}
                </p>
              </div>

              {error && (
                <div className="text-center mt-4">
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg py-3 px-4 inline-block">
                    {error}
                  </p>
                </div>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
