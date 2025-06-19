"use client";

import { Download, FileText, Brain, CheckCircle, Clock } from "lucide-react";
import { StreamingProgress } from "../utils";

/**
 * Progress indicator component that shows the current stage of the streaming process
 */
export function StreamingProgressIndicator({
  progress,
}: {
  progress: StreamingProgress;
}) {
  const stageIcons = {
    downloading: Download,
    transcribing: FileText,
    summarizing: Brain,
    complete: CheckCircle,
  };

  const stageColors = {
    downloading: "from-blue-500 to-cyan-500",
    transcribing: "from-yellow-500 to-orange-500",
    summarizing: "from-purple-500 to-pink-500",
    complete: "from-green-500 to-emerald-500",
  };

  const Icon = stageIcons[progress.stage];
  const colorGradient = stageColors[progress.stage];

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-r ${colorGradient} flex items-center justify-center`}
          >
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="text-lg font-semibold text-white capitalize">
              {progress.stage.replace("_", " ")}
            </span>
            {progress.elapsed && (
              <div className="flex items-center gap-1 text-sm text-gray-400">
                <Clock className="w-3 h-3" />
                {progress.elapsed.toFixed(1)}s elapsed
              </div>
            )}
          </div>
        </div>
        <span className="text-lg font-mono text-white">
          {Math.round(progress.progress)}%
        </span>
      </div>

      <div className="w-full bg-gray-700/50 rounded-full h-3 mb-3 overflow-hidden">
        <div
          className={`bg-gradient-to-r ${colorGradient} h-3 rounded-full transition-all duration-500 ease-out relative`}
          style={{ width: `${progress.progress}%` }}
        >
          <div className="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
        </div>
      </div>

      <p className="text-sm text-gray-300 text-center">{progress.message}</p>
    </div>
  );
}
