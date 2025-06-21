import type { SummaryResult } from "../../../lib/types";
import { useTheme } from "next-themes";

interface SummaryStatsProps {
  summary: SummaryResult;
}

export function SummaryStats({ summary }: SummaryStatsProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t ${
        isDark ? "border-white/20" : "border-slate-300"
      }`}
    >
      <div
        className={`text-center p-4 bg-linear-to-r ${
          isDark
            ? "from-purple-500/15 to-purple-600/15 border-purple-500/30"
            : "from-purple-200 to-purple-300/20 border-purple-300"
        } rounded-lg border`}
      >
        <div
          className={`text-2xl font-bold ${
            isDark ? "text-purple-300" : "text-purple-700"
          }`}
        >
          {summary.summary.split(" ").length}
        </div>
        <div
          className={`text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          Words in Summary
        </div>
      </div>
      <div
        className={`text-center p-4 bg-linear-to-r ${
          isDark
            ? "from-cyan-500/15 to-cyan-600/15 border-cyan-500/30"
            : "from-cyan-200 to-cyan-300/20 border-cyan-300"
        } rounded-lg border`}
      >
        <div
          className={`text-2xl font-bold ${
            isDark ? "text-cyan-300" : "text-cyan-700"
          }`}
        >
          {summary.transcriptionTime.toFixed(1)}s
        </div>
        <div
          className={`text-sm ${isDark ? "text-gray-200" : "text-slate-700"}`}
        >
          Transcription
        </div>
      </div>
      <div
        className={`text-center p-4 bg-linear-to-r ${
          isDark
            ? "from-green-500/15 to-green-600/15 border-green-500/30"
            : "from-green-200 to-green-300/20 border-green-300"
        } rounded-lg border`}
      >
        <div
          className={`text-2xl font-bold ${
            isDark ? "text-green-300" : "text-green-700"
          }`}
        >
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
