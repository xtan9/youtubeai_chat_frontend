"use client";

import { Sparkles } from "lucide-react";

interface ChatEmptyStateProps {
  readonly onPickSuggestion: (suggestion: string) => void;
  /**
   * Dynamic per-video suggestions when available. Falls back to the
   * static list below when undefined or empty so the empty state
   * always has *something* to click — generation latency or failure
   * is invisible to the user.
   */
  readonly dynamicSuggestions?: readonly string[];
}

/**
 * Static fallback suggestions — three prompts that work across most
 * YouTube videos. Used when the per-video dynamic generation hasn't
 * landed yet, failed, or produced an empty list.
 */
const STATIC_SUGGESTIONS: readonly string[] = [
  "Summarize the key takeaways",
  "List any action items or next steps",
  "Quote the most important moment",
];

export function ChatEmptyState({
  onPickSuggestion,
  dynamicSuggestions,
}: ChatEmptyStateProps) {
  const suggestions =
    dynamicSuggestions && dynamicSuggestions.length > 0
      ? dynamicSuggestions
      : STATIC_SUGGESTIONS;
  return (
    <div className="flex flex-1 flex-col items-stretch justify-center gap-3 p-4 text-center">
      <div className="flex justify-center">
        <Sparkles className="size-6 text-accent-brand" aria-hidden />
      </div>
      <p className="text-body-md text-text-secondary">
        Ask anything about this video, or start with a suggestion:
      </p>
      <ul className="flex flex-col gap-2">
        {suggestions.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPickSuggestion(s)}
              className="w-full rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-left text-body-sm text-text-primary transition-colors hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-state-focus"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
