import { Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoInfoCard } from "./video-info-card";
import { AnalysisContent } from "./analysis-content";
import { SummaryStats } from "./summary-stats";
import { KeyInsights } from "./key-insights";
import type { SummaryResult } from "./types";

interface ResultsDisplayProps {
  summary: SummaryResult;
  url: string;
  copied: boolean;
  onCopyAnalysis: () => void;
  onNewAnalysis: () => void;
}

export function ResultsDisplay({
  summary,
  url,
  copied,
  onCopyAnalysis,
  onNewAnalysis
}: ResultsDisplayProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            Video Analysis Complete
          </h1>
          <p className="text-gray-400 mt-2">AI-powered insights and key takeaways</p>
        </div>
        <div className="flex gap-3">
          <Button 
            variant="outline" 
            onClick={onCopyAnalysis}
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
                Copy Analysis
              </>
            )}
          </Button>
          <Button 
            onClick={onNewAnalysis}
            className="bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            New Analysis
          </Button>
        </div>
      </div>

      {/* Video Info Card */}
      <VideoInfoCard summary={summary} url={url} />

      {/* Analysis Content with Summary Stats */}
      <AnalysisContent summary={summary} />

      {/* Key Insights */}
      <KeyInsights keyPoints={summary.keyPoints} />
    </div>
  );
} 