import { TrendingUp } from "lucide-react";

interface KeyInsightsProps {
  keyPoints: string[];
}

export function KeyInsights({ keyPoints }: KeyInsightsProps) {
  if (keyPoints.length === 0) return null;

  return (
    <div className="relative group">
      <div className="absolute -inset-1 bg-gradient-to-r from-pink-500/30 to-purple-500/30 rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-all"></div>
      <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-r from-pink-500 to-purple-500 rounded-xl flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <h3 className="text-xl font-semibold text-white">Key Insights</h3>
        </div>
        <div className="space-y-4">
          {keyPoints.map((point, index) => (
            <div key={index} className="flex gap-4 items-start">
              <div className="w-6 h-6 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 mt-1">
                {index + 1}
              </div>
              <p className="text-gray-300 text-lg leading-relaxed">{point}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
} 