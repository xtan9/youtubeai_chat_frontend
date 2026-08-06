import type { SummaryResult } from "@/lib/types";
import { useTheme } from "next-themes";
import { countWords } from "../utils";

interface SummaryStatsProps {
  summary: SummaryResult;
}

export function SummaryStats({ summary }: SummaryStatsProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <div
      className={`grid grid-cols-3 gap-2 border-t pt-4 sm:gap-4 sm:pt-6 ${
        isDark ? "border-white/20" : "border-slate-300"
      }`}
      data-testid="summary-stats"
    >
      <div className="rounded-lg border border-accent-brand/30 bg-accent-brand/15 p-2.5 text-center sm:p-4">
        <div className="text-xl font-bold text-accent-brand sm:text-2xl">
          {countWords(summary.summary)}
        </div>
        <div
          className={`text-xs leading-tight sm:text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          Words in Summary
        </div>
      </div>
      <div className="rounded-lg border border-accent-brand-secondary/30 bg-accent-brand-secondary/15 p-2.5 text-center sm:p-4">
        <div className="text-xl font-bold text-accent-brand-secondary sm:text-2xl">
          {summary.transcriptionTime.toFixed(1)}s
        </div>
        <div
          className={`text-xs leading-tight sm:text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          Transcription
        </div>
      </div>
      <div className="rounded-lg border border-accent-success/30 bg-accent-success/15 p-2.5 text-center sm:p-4">
        <div className="text-xl font-bold text-accent-success sm:text-2xl">
          {summary.summaryTime.toFixed(1)}s
        </div>
        <div
          className={`text-xs leading-tight sm:text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          AI Processing
        </div>
      </div>
    </div>
  );
}
