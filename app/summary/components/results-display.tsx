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

        <SummaryContent
          summary={data}
          copied={copied}
          onCopySummary={onCopySummary}
          onNewSummary={onNewSummary}
        />
      </div>
    )
  );
}
