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
      className={`grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t ${
        isDark ? "border-white/20" : "border-slate-300"
      }`}
    >
      <div className="text-center p-4 bg-accent-brand/15 border-accent-brand/30 rounded-lg border">
        <div className="text-2xl font-bold text-accent-brand">
          {countWords(summary.summary)}
        </div>
        <div
          className={`text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          Words in Summary
        </div>
      </div>
      <div className="text-center p-4 bg-accent-brand-secondary/15 border-accent-brand-secondary/30 rounded-lg border">
        <div className="text-2xl font-bold text-accent-brand-secondary">
          {summary.transcriptionTime.toFixed(1)}s
        </div>
        <div
          className={`text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          Transcription
        </div>
      </div>
      <div className="text-center p-4 bg-accent-success/15 border-accent-success/30 rounded-lg border">
        <div className="text-2xl font-bold text-accent-success">
          {summary.summaryTime.toFixed(1)}s
        </div>
        <div
          className={`text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          AI Processing
        </div>
      </div>
    </div>
  );
}
