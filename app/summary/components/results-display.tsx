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
}: ResultsDisplayProps) {
  return (
    data && (
      <div className="space-y-8">
        <SummaryContent
          summary={data}
          copied={copied}
          onCopySummary={onCopySummary}
          onNewSummary={onNewSummary}
          outputLanguage={outputLanguage}
          browserLanguage={browserLanguage}
          onSelectLanguage={onSelectLanguage}
          languageDisabled={languageDisabled}
        />
      </div>
    )
  );
}
