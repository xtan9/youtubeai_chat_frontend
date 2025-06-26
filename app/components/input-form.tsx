"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import { ArrowRight, Brain, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { usePostHog } from "posthog-js/react";

export function InputForm() {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [enableReasoning, setEnableReasoning] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const posthog = usePostHog();

  // Mount after hydration to prevent mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Safe theme detection
  const isDarkMode = mounted && resolvedTheme === "dark";

  // Theme-specific style variables for better readability
  const containerBg = isDarkMode ? "bg-slate-900/90" : "bg-white/80 shadow-lg";

  const inputAreaBg = isDarkMode
    ? "bg-white/5 border-white/20"
    : "bg-gray-50/80 border-gray-200";

  const textColors = isDarkMode ? "text-white" : "text-gray-900";
  const placeholderColors = isDarkMode
    ? "placeholder:text-gray-400"
    : "placeholder:text-gray-500";
  const secondaryTextColors = isDarkMode ? "text-gray-300" : "text-gray-800";
  const tertiaryTextColors = isDarkMode ? "text-gray-400" : "text-gray-700";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

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

    // Track the summary button click with PostHog
    posthog?.capture("summary_button_clicked", {
      youtube_url: formUrl,
      reasoning_enabled: enableReasoning,
    });

    setError(null);
    setUrl(formUrl);
    router.push(
      `/summary?url=${encodeURIComponent(formUrl)}&reasoning=${enableReasoning}`
    );
  };

  const handleClearUrl = () => setUrl("");

  return (
    <div className="relative group mx-auto">
      {/* Animated gradient border - only visible in dark mode */}
      <div
        className={`absolute -inset-1 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-3xl blur-sm opacity-75 group-hover:opacity-100 transition duration-1000 animate-pulse ${
          isDarkMode ? "block" : "hidden"
        }`}
      ></div>

      {/* Main container */}
      <div
        className={`relative backdrop-blur-xl border ${
          isDarkMode ? "border-border" : "border-gray-200"
        } rounded-3xl p-8 ${containerBg}`}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            {/* Background blur effect - only in dark mode */}
            <div
              className={`absolute inset-0 bg-gradient-to-r from-purple-500/20 to-cyan-500/20 rounded-2xl blur-xl ${
                isDarkMode ? "block" : "hidden"
              }`}
            ></div>

            {/* Input area */}
            <div
              className={`relative backdrop-blur-sm border rounded-2xl p-1 ${inputAreaBg}`}
            >
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Input
                    type="url"
                    name="url"
                    placeholder="Enter YouTube URL here..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-label="YouTube URL"
                    className={`h-16 text-lg bg-transparent border-0 focus:ring-0 focus:outline-none ${textColors} ${placeholderColors}`}
                  />

                  {url && (
                    <button
                      type="button"
                      onClick={handleClearUrl}
                      aria-label="Clear input"
                      className={`absolute right-3 top-1/2 transform -translate-y-1/2 text-sm ${tertiaryTextColors} hover:${
                        isDarkMode ? "text-white" : "text-gray-900"
                      }`}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={isLoading}
                  aria-label="Summarize video"
                  className="h-16 px-8 bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white font-semibold text-lg rounded-xl border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-300 cursor-pointer"
                >
                  {isLoading ? (
                    <div
                      className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-2"
                      aria-hidden="true"
                    ></div>
                  ) : (
                    <>
                      Summarize
                      <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Reasoning Toggle */}
            <div className="flex flex-col items-center gap-2 text-sm mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
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
                      : isDarkMode
                      ? "bg-gray-600"
                      : "bg-gray-300"
                  }`}
                  role="switch"
                  aria-checked={enableReasoning}
                >
                  <div
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      enableReasoning ? "translate-x-5" : "translate-x-0"
                    }`}
                  ></div>
                </div>
                <span
                  className={`flex items-center gap-2 ${secondaryTextColors} font-medium`}
                >
                  <Brain
                    size={16}
                    className={tertiaryTextColors}
                    aria-hidden="true"
                  />
                  Enable Reasoning
                </span>
              </label>
              <p
                className={`text-xs text-center max-w-md font-medium ${tertiaryTextColors}`}
              >
                {enableReasoning
                  ? "🧠 Reasoning mode will provide deeper insights and explanations (Free)"
                  : "✅ Standard summary (Free, Faster response time)"}
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="text-center mt-4">
                <p
                  role="alert"
                  className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg py-3 px-4 inline-block"
                >
                  {error}
                </p>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
