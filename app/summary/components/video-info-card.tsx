// Not used
import { Clock, Zap, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SummaryResult } from "@/lib/types";
import { useTheme } from "next-themes";

interface VideoInfoCardProps {
  summary: SummaryResult;
  url: string;
}

export function VideoInfoCard({ summary, url }: VideoInfoCardProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-brand-soft rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
      <div
        className={`relative ${
          isDark
            ? "bg-white/10 border-white/20"
            : "bg-slate-100 border-slate-300"
        } backdrop-blur-sm border rounded-2xl p-6`}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h2
                className={`text-2xl font-bold ${
                  isDark ? "text-white" : "text-slate-900"
                }`}
              >
                {summary.title}
              </h2>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-brand-soft text-accent-brand-secondary border-accent-brand-secondary/30 border">
                {summary.title
                  .replace("Video Summary", "")
                  .replace("Summary", "")
                  .trim() || "Content"}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2 bg-accent-brand/15 border-accent-brand/30 rounded-lg p-3 border">
                <Clock size={16} className="text-accent-brand" />
                <div>
                  <div className="font-medium text-accent-brand">
                    Total Duration
                  </div>
                  <div className={isDark ? "text-white" : "text-slate-800"}>
                    {summary.duration}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-accent-brand-secondary/15 border-accent-brand-secondary/30 rounded-lg p-3 border">
                <Zap size={16} className="text-accent-brand-secondary" />
                <div>
                  <div className="font-medium text-accent-brand-secondary">
                    Processing
                  </div>
                  <div className={isDark ? "text-white" : "text-slate-800"}>
                    {(summary.transcriptionTime + summary.summaryTime).toFixed(
                      1
                    )}
                    s
                  </div>
                </div>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className={`${
              isDark
                ? "text-gray-200 hover:text-white hover:bg-white/10"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
            } rounded-lg p-2`}
          >
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <ExternalLink size={18} />
              <span className="hidden sm:inline">View Video</span>
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
