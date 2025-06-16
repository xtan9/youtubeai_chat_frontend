import { Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoInfoCard } from "./video-info-card";
import { SummaryContent } from "./summary-content";
import { KeyInsights } from "./key-insights";
import type { SummaryResult } from "../../lib/types";

interface ResultsDisplayProps {
  data: SummaryResult;
  url: string;
  copied: boolean;
  onCopySummary: () => void;
  onNewSummary: () => void;
}

export function ResultsDisplay({
  data,
  url,
  copied,
  onCopySummary,
  onNewSummary,
}: ResultsDisplayProps) {
  return (
    data && (
      <div className="space-y-8">
        {/* AI Reasoning Section */}
        {data.keyPoints && data.keyPoints.length > 0 && (
          <div className="bg-white/10 border border-white/20 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-semibold text-gray-200 uppercase tracking-wider">
                AI Reasoning
              </span>
            </div>
            <p className="text-base text-gray-300 leading-relaxed">
              {data.keyPoints[0]}
            </p>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              Video Summary Complete
            </h1>
            <p className="text-gray-400 mt-2">
              AI-powered insights and key takeaways
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onCopySummary}
              className="bg-white/5 border-white/20 text-white hover:bg-white/10"
            >
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4 text-green-400" />
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
              className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              New Summary
            </Button>
          </div>
        </div>

        {/* Video Info Card */}
        <VideoInfoCard summary={data} url={url} />

        {/* Summary Content */}
        <SummaryContent summary={data} />

        {/* Key Insights */}
        <KeyInsights keyPoints={data.keyPoints} />
      </div>
    )
  );
}
