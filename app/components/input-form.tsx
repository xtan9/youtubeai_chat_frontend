"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidYouTubeUrl } from "@/lib/utils/youtube";
import { X } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { cn } from "@/lib/utils";

type InputFormProps = {
  variant?: "default" | "compact";
};

export function InputForm({ variant = "default" }: InputFormProps) {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const isCompact = variant === "compact";

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
    <div className={cn("relative mx-auto", isCompact ? "w-full" : "group")}>
      {!isCompact ? (
        <div className="absolute -inset-1 hidden animate-pulse rounded-3xl bg-gradient-brand-accent opacity-75 blur-sm transition duration-1000 group-hover:opacity-100 dark:block" />
      ) : null}

      <div
        className={cn(
          "relative",
          !isCompact &&
            "rounded-3xl border border-gray-200 bg-white/80 p-8 shadow-lg backdrop-blur-xl dark:border-border-subtle dark:bg-slate-900/90 dark:shadow-none",
        )}
      >
        <form onSubmit={handleSubmit}>
          <div className="relative">
            {!isCompact ? (
              <div className="absolute inset-0 hidden rounded-2xl bg-gradient-brand-soft blur-xl dark:block" />
            ) : null}

            <div
              className={cn(
                "relative",
                !isCompact &&
                  "rounded-2xl border border-gray-200 bg-gray-50/80 p-1 backdrop-blur-sm dark:border-white/20 dark:bg-white/5",
              )}
            >
              <div
                className={
                  isCompact
                    ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pe-2"
                    : "flex flex-col gap-3 md:flex-row"
                }
              >
                <div className={cn("relative min-w-0", !isCompact && "flex-1")}>
                  <Input
                    type="url"
                    name="url"
                    placeholder="Enter YouTube URL here..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    aria-label="YouTube URL"
                    autoComplete="off"
                    className={cn(
                      isCompact && "pr-9",
                      !isCompact &&
                        "h-16 border-0 bg-transparent text-lg text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-0 dark:text-white dark:placeholder:text-gray-400",
                    )}
                  />

                  {url ? (
                    isCompact ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleClearUrl}
                        aria-label="Clear input"
                        className="absolute end-1 top-1/2 size-8 -translate-y-1/2 text-text-muted hover:text-text-primary"
                      >
                        <X size={16} />
                      </Button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleClearUrl}
                        aria-label="Clear input"
                        className="absolute right-3 top-1/2 -translate-y-1/2 transform text-sm text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                      >
                        <X size={16} />
                      </button>
                    )
                  ) : null}
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
                    />
                  ) : (
                    <span>Summarize</span>
                  )}
                </Button>
              </div>
            </div>

            {error ? (
              <div
                className={cn(
                  "mt-4 text-center",
                  isCompact && "mt-2 text-start",
                )}
              >
                <p
                  role="alert"
                  className="inline-block rounded-lg border border-accent-danger/20 bg-accent-danger/10 px-4 py-3 text-sm text-accent-danger"
                >
                  {error}
                </p>
              </div>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}
