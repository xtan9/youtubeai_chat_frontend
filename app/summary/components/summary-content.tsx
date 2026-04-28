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
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const posthog = usePostHog();

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
                components={{
                  h1: ({ children }) => (
                    <h1
                      className={`text-xl font-bold border-accent-brand-secondary/30 ${
                        isDark ? "text-white" : "text-slate-900"
                      } border-b pb-2 mb-4`}
                    >
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-lg font-semibold text-accent-brand-secondary mt-6 mb-3">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base font-medium text-accent-brand mt-4 mb-2">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p
                      className={`${
                        isDark ? "text-white" : "text-slate-800"
                      } leading-relaxed mb-4 text-base`}
                    >
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul
                      className={`list-disc list-inside space-y-2 ${
                        isDark ? "text-white" : "text-slate-800"
                      } mb-4 ml-4`}
                    >
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol
                      className={`list-decimal list-inside space-y-2 ${
                        isDark ? "text-white" : "text-slate-800"
                      } mb-4 ml-4`}
                    >
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li
                      className={`${
                        isDark ? "text-white" : "text-slate-800"
                      } leading-relaxed`}
                    >
                      {children}
                    </li>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-accent-brand-secondary">
                      {children}
                    </strong>
                  ),
                  em: ({ children }) => (
                    <em className="italic text-accent-brand-secondary">
                      {children}
                    </em>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote
                      className={`border-l-4 border-accent-brand pl-4 italic bg-accent-brand/10 ${
                        isDark ? "text-white" : "text-slate-800"
                      } py-2 rounded-r-lg`}
                    >
                      {children}
                    </blockquote>
                  ),
                  code: ({ children }) => (
                    <code
                      className={`${
                        isDark ? "bg-slate-700" : "bg-slate-100"
                      } text-accent-brand-secondary px-2 py-1 rounded text-sm font-mono`}
                    >
                      {children}
                    </code>
                  ),
                  pre: ({ children }) => (
                    <pre
                      className={`${
                        isDark
                          ? "bg-slate-900 text-white border-slate-600"
                          : "bg-slate-100 text-slate-800 border-slate-300"
                      } p-4 rounded-lg overflow-x-auto border`}
                    >
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
          <SummaryStats summary={summary} />
        </div>
      </div>
    </div>
  );
}
