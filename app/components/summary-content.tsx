import { Clock, FileText, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SummaryResult } from "./types";

interface SummaryContentProps {
  summary: SummaryResult;
}

export function SummaryContent({ summary }: SummaryContentProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Summary */}
      <div className="lg:col-span-2">
        <Card className="bg-white/5 border-white/20 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <FileText className="h-5 w-5 text-purple-400" />
              Summary
            </CardTitle>
            <p className="text-sm text-gray-400">Intelligent summary and key insights</p>
          </CardHeader>
          <CardContent>
            <div className="prose prose-invert max-w-none">
              <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">
                {summary.summary}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Processing Stats */}
      <div className="space-y-4">
        <Card className="bg-white/5 border-white/20 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              Processing Time
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">Transcription</span>
              <span className="text-sm text-white font-medium">
                {summary.transcriptionTime.toFixed(1)}s
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-400">Summarization</span>
              <span className="text-sm text-white font-medium">
                {summary.summaryTime.toFixed(1)}s
              </span>
            </div>
            <div className="border-t border-white/10 pt-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-400">Total</span>
                <span className="text-sm text-cyan-400 font-semibold">
                  {summary.duration}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/20 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-green-400" />
              Content Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-white font-medium">
              {summary.title.replace('Video Summary', '').replace('Summary', '').trim() || 'General Content'}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 