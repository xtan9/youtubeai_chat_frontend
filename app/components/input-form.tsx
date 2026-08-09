"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import { X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { captureAnalyticsEvent } from "@/lib/analytics/client";

export function InputForm() {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

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
    captureAnalyticsEvent("summary_button_clicked", {
      source_surface: "homepage",
    });

    setError(null);
    setUrl(formUrl);
    router.push(`/summary?url=${encodeURIComponent(formUrl)}`);
  };

  const handleClearUrl = () => setUrl("");

  return (
    <div className="relative group mx-auto">
      {/* Animated gradient border — dark-mode-only accent (preserves the
          purple/pink/cyan halo that shipped pre-tokens). */}
      <div
        className="absolute -inset-1 hidden dark:block bg-gradient-brand-accent rounded-3xl blur-sm opacity-75 group-hover:opacity-100 transition duration-1000 animate-pulse"
      ></div>

      {/* Main container. Background/border switch via `dark:` Tailwind
          variants (no JS theme conditional). Light mode keeps a subtle
          shadow; dark mode drops it since the gradient halo carries the
          lift. */}
      <div className="relative backdrop-blur-xl border border-gray-200 dark:border-border-subtle rounded-3xl p-8 bg-white/80 shadow-lg dark:bg-slate-900/90 dark:shadow-none">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            {/* Soft brand-gradient backdrop — only visible in dark mode. */}
            <div
              className="absolute inset-0 hidden dark:block bg-gradient-brand-soft rounded-2xl blur-xl"
            ></div>

            {/* Input area */}
            <div className="relative backdrop-blur-sm border rounded-2xl p-1 bg-gray-50/80 border-gray-200 dark:bg-white/5 dark:border-white/20">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1 relative">
                  <Input
                    type="url"
                    name="url"
                    placeholder="Enter YouTube URL here..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-label="YouTube URL"
                    autoComplete="off"
                    className="h-16 text-lg bg-transparent border-0 focus:ring-0 focus:outline-none text-gray-900 placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400"
                  />

                  {url && (
                    <button
                      type="button"
                      onClick={handleClearUrl}
                      aria-label="Clear input"
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={isLoading}
                  aria-label="Summarize video"
                  className="self-center"
                >
                  {isLoading ? (
                    <div
                      className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent"
                      aria-hidden="true"
                    ></div>
                  ) : (
                    <span>Summarize</span>
                  )}
                </Button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="text-center mt-4">
                <p
                  role="alert"
                  className="text-accent-danger text-sm bg-accent-danger/10 border border-accent-danger/20 rounded-lg py-3 px-4 inline-block"
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
