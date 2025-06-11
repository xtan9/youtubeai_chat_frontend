import { Download, FileText, Brain, CheckCircle, Zap } from "lucide-react";
import type { StreamingStatus } from "./types";

interface StreamingProgressProps {
  streamingStatus: StreamingStatus | null;
}

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

export function StreamingProgress({ streamingStatus }: StreamingProgressProps) {
  if (!streamingStatus) return null;

  const Icon = stageIcons[streamingStatus.stage];
  const colorGradient = stageColors[streamingStatus.stage];
  const progress = streamingStatus.progress || 0;
  const isCached = streamingStatus.message?.toLowerCase().includes('cached') || 
                   streamingStatus.message?.toLowerCase().includes('found cached');

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full bg-gradient-to-r ${colorGradient} flex items-center justify-center`}>
            {isCached ? <Zap className="w-4 h-4 text-white" /> : <Icon className="w-4 h-4 text-white" />}
          </div>
          <span className="text-sm font-medium text-white capitalize">
            {isCached ? 'Cached Result' : streamingStatus.stage.replace('_', ' ')}
          </span>
          {isCached && (
            <span className="text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
              Instant
            </span>
          )}
        </div>
        <span className="text-sm text-gray-400 font-mono">
          {Math.round(progress)}%
        </span>
      </div>
      
      <div className="w-full bg-gray-700/50 rounded-full h-3 mb-3 overflow-hidden">
        <div 
          className={`bg-gradient-to-r ${isCached ? 'from-green-500 to-emerald-500' : colorGradient} h-3 rounded-full transition-all duration-500 ease-out relative`}
          style={{ width: `${progress}%` }}
        >
          <div className="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
        </div>
      </div>
      
      {streamingStatus.message && (
        <p className="text-sm text-gray-300 text-center animate-pulse">
          {streamingStatus.message}
        </p>
      )}
    </div>
  );
} 