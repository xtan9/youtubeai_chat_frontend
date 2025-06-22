import { Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SummaryContent } from "./summary-content";
import type { SummaryResult } from "@/lib/types";
import { useTheme } from "next-themes";

interface ResultsDisplayProps {
  data: SummaryResult;
  url: string;
  copied: boolean;
  onCopySummary: () => void;
  onNewSummary: () => void;
}

export function ResultsDisplay({
  data,
  copied,
  onCopySummary,
  onNewSummary,
}: ResultsDisplayProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    data && (
      <div className="space-y-8">
        {/* AI Reasoning Section */}
        {data.keyPoints && data.keyPoints.length > 0 && (
          <div
            className={`${
              isDark
                ? "bg-slate-800/80 border-slate-600/50"
                : "bg-white border-slate-300"
            } rounded-xl p-6 border shadow-inner`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className={`text-xs font-semibold ${
                  isDark ? "text-cyan-300/80" : "text-cyan-700/80"
                } uppercase tracking-wider`}
              >
                AI Reasoning
              </span>
            </div>
            <div className="max-h-[150px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-transparent">
              <p
                className={`text-sm ${
                  isDark ? "text-gray-300" : "text-slate-600"
                } leading-relaxed`}
              >
                {data.keyPoints[0]}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-linear-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Video Summary Complete
            </h1>
            <p
              className={`${isDark ? "text-gray-200" : "text-slate-700"} mt-2`}
            >
              AI-powered insights and key takeaways
            </p>
          </div>
          <div className="flex gap-3">
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
                  <Check className="mr-2 h-4 w-4 text-green-500" />
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
              onClick={onNewSummary}
              className="bg-linear-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              New Summary
            </Button>
          </div>
        </div>
        <SummaryContent summary={data} />
      </div>
    )
  );
}
