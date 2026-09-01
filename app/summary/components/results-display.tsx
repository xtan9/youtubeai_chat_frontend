import { SummaryContent } from "./summary-content";
import type { SummaryResult } from "@/lib/types";
import type { SupportedLanguageCode } from "@/lib/constants/languages";

interface ResultsDisplayProps {
  data: SummaryResult;
  copied: boolean;
  onCopySummary: () => void;
  onNewSummary: () => void;
  outputLanguage: SupportedLanguageCode | null;
  browserLanguage: SupportedLanguageCode;
  onSelectLanguage: (code: SupportedLanguageCode) => void;
  languageDisabled: boolean;
  sourceUrl?: string;
  continueLearningEnabled?: boolean;
  channelReleaseStatus?: "open" | "blocked";
}

export function ResultsDisplay({
  data,
  copied,
  onCopySummary,
  onNewSummary,
  outputLanguage,
  browserLanguage,
  onSelectLanguage,
  languageDisabled,
  sourceUrl,
  continueLearningEnabled = false,
  channelReleaseStatus = "blocked",
}: ResultsDisplayProps) {
  return (
    data && (
      <div className="space-y-8" data-testid="summary-results">
        <SummaryContent
          summary={data}
          copied={copied}
          onCopySummary={onCopySummary}
          onNewSummary={onNewSummary}
          outputLanguage={outputLanguage}
          browserLanguage={browserLanguage}
          onSelectLanguage={onSelectLanguage}
          languageDisabled={languageDisabled}
          sourceUrl={sourceUrl}
          continueLearningEnabled={continueLearningEnabled}
          channelReleaseStatus={channelReleaseStatus}
        />
      </div>
    )
  );
}
