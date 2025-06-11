import { Clock, Zap, Sparkles, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SummaryResult } from "./types";

interface VideoInfoCardProps {
  summary: SummaryResult;
  url: string;
}

export function VideoInfoCard({ summary, url }: VideoInfoCardProps) {
  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-to-r from-purple-500/30 to-cyan-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
      <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-white">{summary.title}</h2>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-purple-500/20 to-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                {summary.title.replace('Video Summary', '').replace('Summary', '').trim() || 'Content'}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2 bg-purple-500/10 rounded-lg p-3 border border-purple-500/20">
                <Clock size={16} className="text-purple-400" />
                <div>
                  <div className="text-purple-400 font-medium">Total Duration</div>
                  <div className="text-white">{summary.duration}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-cyan-500/10 rounded-lg p-3 border border-cyan-500/20">
                <Zap size={16} className="text-cyan-400" />
                <div>
                  <div className="text-cyan-400 font-medium">Processing</div>
                  <div className="text-white">{(summary.transcriptionTime + summary.summaryTime).toFixed(1)}s</div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-green-500/10 rounded-lg p-3 border border-green-500/20">
                <Sparkles size={16} className="text-green-400" />
                <div>
                  <div className="text-green-400 font-medium">AI Model</div>
                  <div className="text-white">qwen2.5:14b</div>
                </div>
              </div>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-gray-400 hover:text-white hover:bg-white/10 rounded-lg p-2">
            <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2">
              <ExternalLink size={18} />
              <span className="hidden sm:inline">View Video</span>
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
} 