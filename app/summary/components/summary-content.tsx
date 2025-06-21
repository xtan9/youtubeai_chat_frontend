import { Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SummaryStats } from "./summary-stats";
import type { SummaryResult } from "@/lib/types";
import { useTheme } from "next-themes";

interface SummaryContentProps {
  summary: SummaryResult;
}

export function SummaryContent({ summary }: SummaryContentProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-linear-to-r from-cyan-500/30 to-purple-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
      <div
        className={`relative ${
          isDark
            ? "bg-white/10 border-white/20"
            : "bg-slate-100 border-slate-300"
        } backdrop-blur-sm border rounded-2xl p-8`}
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-linear-to-r from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center">
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

        <div className="space-y-6">
          {/* Render summary with ReactMarkdown */}
          <div
            className={`${
              isDark
                ? "bg-slate-800/80 border-slate-600/50"
                : "bg-white border-slate-300"
            } rounded-xl p-6 border shadow-inner`}
          >
            <div className="prose prose-lg max-w-none dark:prose-invert">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1
                      className={`text-2xl font-bold ${
                        isDark
                          ? "text-white border-cyan-400/30"
                          : "text-slate-900 border-cyan-600/30"
                      } border-b pb-2 mb-4`}
                    >
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2
                      className={`text-xl font-semibold ${
                        isDark ? "text-cyan-400" : "text-cyan-700"
                      } mt-6 mb-3`}
                    >
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3
                      className={`text-lg font-medium ${
                        isDark ? "text-purple-400" : "text-purple-700"
                      } mt-4 mb-2`}
                    >
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p
                      className={`${
                        isDark ? "text-white" : "text-slate-800"
                      } leading-relaxed mb-4 text-lg`}
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
                    <strong
                      className={`font-semibold ${
                        isDark ? "text-cyan-200" : "text-cyan-800"
                      }`}
                    >
                      {children}
                    </strong>
                  ),
                  em: ({ children }) => (
                    <em
                      className={`italic ${
                        isDark ? "text-cyan-200" : "text-cyan-800"
                      }`}
                    >
                      {children}
                    </em>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote
                      className={`border-l-4 border-purple-400 pl-4 italic ${
                        isDark
                          ? "text-white bg-purple-500/10"
                          : "text-slate-800 bg-purple-500/5"
                      } py-2 rounded-r-lg`}
                    >
                      {children}
                    </blockquote>
                  ),
                  code: ({ children }) => (
                    <code
                      className={`${
                        isDark
                          ? "bg-slate-700 text-cyan-300"
                          : "bg-slate-100 text-cyan-700"
                      } px-2 py-1 rounded text-sm font-mono`}
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
