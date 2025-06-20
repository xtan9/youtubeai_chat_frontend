import type { SummaryResult } from "../../../lib/types";

interface SummaryStatsProps {
  summary: SummaryResult;
}

export function SummaryStats({ summary }: SummaryStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-6 border-t border-white/10">
      <div className="text-center p-4 bg-linear-to-r from-purple-500/10 to-purple-600/10 rounded-lg border border-purple-500/20">
        <div className="text-2xl font-bold text-purple-400">
          {summary.summary.split(" ").length}
        </div>
        <div className="text-sm text-gray-400">Words in Summary</div>
      </div>
      <div className="text-center p-4 bg-linear-to-r from-cyan-500/10 to-cyan-600/10 rounded-lg border border-cyan-500/20">
        <div className="text-2xl font-bold text-cyan-400">
          {summary.transcriptionTime.toFixed(1)}s
        </div>
        <div className="text-sm text-gray-400">Transcription</div>
      </div>
      <div className="text-center p-4 bg-linear-to-r from-green-500/10 to-green-600/10 rounded-lg border border-green-500/20">
        <div className="text-2xl font-bold text-green-400">
          {summary.summaryTime.toFixed(1)}s
        </div>
        <div className="text-sm text-gray-400">AI Processing</div>
      </div>
    </div>
  );
}
