import { Brain, Copy, Check, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SummaryStats } from "./summary-stats";
import type { SummaryResult } from "@/lib/types";
import type { SupportedLanguageCode } from "@/lib/constants/languages";
import { useTheme } from "next-themes";
import { RefObject, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { usePostHog } from "posthog-js/react";
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
  const posthog = usePostHog();
  const markdownComponents = buildSummaryMarkdownComponents({ isDark });

  // Wrap the onNewSummary callback to include PostHog tracking
  const handleNewSummary = useCallback(() => {
    // Track the "New Summary" button click
    posthog?.capture("new_summary_button_clicked", {
      summary_title: summary.title,
    });

    // Call the original onNewSummary callback
    onNewSummary?.();
  }, [onNewSummary, posthog, summary.title]);

  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-brand-soft rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
      <div
        className={`relative ${
          isDark
            ? "bg-white/10 border-white/20"
            : "bg-slate-100 border-slate-300"
        } backdrop-blur-sm border rounded-2xl p-8`}
      >
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-accent-brand-secondary rounded-xl flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2
                className={`text-2xl font-bold ${
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
            <div className="flex flex-wrap gap-3 mt-2 md:mt-0">
              {onSelectLanguage && browserLanguage && (
                <LanguagePicker
                  currentLanguage={outputLanguage ?? null}
                  browserLanguage={browserLanguage}
                  onSelect={onSelectLanguage}
                  isDark={isDark}
                  disabled={languageDisabled}
                />
              )}
              <Button
                variant="outline"
                onClick={onCopySummary}
                className={`${
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
                className="bg-gradient-brand-primary hover:bg-gradient-brand-primary-hover text-white"
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
            className={`${
              isDark
                ? "bg-slate-800/80 border-slate-600/50"
                : "bg-white border-slate-300"
            } rounded-xl p-6 border shadow-inner overflow-auto max-h-[calc(100vh-300px)]`}
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
