import { Brain, Copy, Check, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SummaryStats } from "./summary-stats";
import type { SummaryResult } from "@/lib/types";
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { useTheme } from "next-themes";
import { RefObject, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { LanguagePicker } from "./language-picker";
import { buildSummaryMarkdownComponents } from "./summary-markdown-renderer";

interface SummaryContentProps {
  summary: SummaryResult;
  contentRef?: RefObject<HTMLDivElement | null>;
  copied?: boolean;
  onCopySummary?: () => void;
  onNewSummary?: () => void;
  // Language controls — only rendered when all four are provided. The
  // detail view (standalone SummaryContent without the picker chrome) can
  // omit these and render identically to before.
  outputLanguage?: SupportedLanguageCode | null;
  browserLanguage?: SupportedLanguageCode;
  onSelectLanguage?: (code: SupportedLanguageCode) => void;
  languageDisabled?: boolean;
}

export function SummaryContent({
  summary,
  copied = false,
  onCopySummary,
  onNewSummary,
  outputLanguage,
  browserLanguage,
  onSelectLanguage,
  languageDisabled,
}: SummaryContentProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const markdownComponents = buildSummaryMarkdownComponents({ isDark });

  // Wrap the onNewSummary callback to include PostHog tracking
  const handleNewSummary = useCallback(() => {
    // Track the "New Summary" button click
    captureAnalyticsEvent("new_summary_button_clicked", {
      source_surface: "summary",
    });

    // Call the original onNewSummary callback
    onNewSummary?.();
  }, [onNewSummary]);

  return (
    <div className="group relative" data-testid="summary-reading-surface">
      <div className="absolute -inset-1 hidden rounded-2xl bg-gradient-brand-soft opacity-0 blur-lg transition-all sm:block sm:group-hover:opacity-100"></div>
      <div
        data-testid="summary-card"
        className={`relative ${
          isDark
            ? "bg-white/10 border-white/20"
            : "bg-slate-100 border-slate-300"
        } -mx-4 rounded-none border-y p-4 backdrop-blur-sm sm:mx-0 sm:rounded-2xl sm:border sm:p-8`}
      >
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-brand-secondary sm:h-12 sm:w-12">
              <Brain className="h-5 w-5 text-white sm:h-6 sm:w-6" />
            </div>
            <div className="min-w-0">
              <h2
                className={`text-xl font-bold leading-tight sm:text-2xl ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                AI-Generated Video Summary
              </h2>
              <p
                className={`text-sm ${
                  isDark ? "text-gray-300" : "text-slate-700"
                }`}
              >
                Key points and insights extracted by AI
              </p>
            </div>
          </div>

          {onCopySummary && onNewSummary && (
            <div
              className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:gap-3 md:mt-0"
              data-testid="summary-actions"
            >
              {onSelectLanguage && browserLanguage && (
                <LanguagePicker
                  currentLanguage={outputLanguage ?? null}
                  browserLanguage={browserLanguage}
                  onSelect={onSelectLanguage}
                  isDark={isDark}
                  disabled={languageDisabled}
                  triggerClassName="w-full sm:w-auto"
                />
              )}
              <Button
                variant="outline"
                onClick={onCopySummary}
                className={`w-full sm:w-auto ${
                  isDark
                    ? "bg-white/5 border-white/20 text-white hover:bg-white/10"
                    : "bg-slate-100 border-slate-300 text-slate-800 hover:bg-slate-200"
                }`}
              >
                {copied ? (
                  <>
                    <Check className="mr-2 h-4 w-4 text-accent-success" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy Summary
                  </>
                )}
              </Button>
              <Button
                onClick={handleNewSummary}
                className="col-span-2 w-full bg-gradient-brand-primary text-white hover:bg-gradient-brand-primary-hover sm:w-auto"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                New Summary
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Render summary with ReactMarkdown */}
          <div
            data-testid="summary-markdown-surface"
            className={`${
              isDark
                ? "bg-slate-800/80 border-slate-600/50"
                : "bg-white border-slate-300"
            } -mx-4 max-h-none overflow-visible rounded-none border-y p-4 shadow-inner sm:mx-0 sm:max-h-[calc(100vh-300px)] sm:overflow-auto sm:rounded-xl sm:border sm:p-6`}
          >
            <div className="prose max-w-none dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {summary.summary}
              </ReactMarkdown>
            </div>
          </div>

          {/* Summary Stats */}
          <SummaryStats summary={summary} />
        </div>
      </div>
    </div>
  );
}
