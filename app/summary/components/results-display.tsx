import { SummaryContent } from "./summary-content";
import type { SummaryResult } from "@/lib/types";

interface ResultsDisplayProps {
  data: SummaryResult;
  url: string;
  copied: boolean;
  onCopySummary: () => void;
  onNewSummary: () => void;
}

export function ResultsDisplay({
  data,
  copied,
  onCopySummary,
  onNewSummary,
}: ResultsDisplayProps) {
  return (
    data && (
      <div className="space-y-8">
        <SummaryContent
          summary={data}
          copied={copied}
          onCopySummary={onCopySummary}
          onNewSummary={onNewSummary}
        />
      </div>
    )
  );
}
