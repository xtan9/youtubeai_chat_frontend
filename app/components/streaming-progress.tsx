import type { StreamingStatus } from "./types";

interface StreamingProgressProps {
  streamingStatus: StreamingStatus | null;
}

export function StreamingProgress({ streamingStatus }: StreamingProgressProps) {
  if (!streamingStatus) return null;

  return (
    <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-white capitalize">
          {streamingStatus.stage.replace('_', ' ')}
        </span>
        {streamingStatus.progress && (
          <span className="text-sm text-gray-400">
            {Math.round(streamingStatus.progress)}%
          </span>
        )}
      </div>
      {streamingStatus.progress && (
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div 
            className="bg-gradient-to-r from-purple-500 to-cyan-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${streamingStatus.progress}%` }}
          ></div>
        </div>
      )}
      {streamingStatus.message && (
        <p className="text-sm text-gray-400 mt-2">{streamingStatus.message}</p>
      )}
    </div>
  );
} 