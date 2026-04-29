"use client";

import { Sparkles } from "lucide-react";

interface ChatEmptyStateProps {
  readonly onPickSuggestion: (suggestion: string) => void;
}

/**
 * Static suggestions for v1 — three prompts that work across most YouTube
 * videos. Dynamic per-video suggestions are a follow-up that requires
 * extending the summary stream's structured output.
 */
const STATIC_SUGGESTIONS: readonly string[] = [
  "Summarize the key takeaways",
  "List any action items or next steps",
  "Quote the most important moment",
];

export function ChatEmptyState({ onPickSuggestion }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-stretch justify-center gap-3 p-4 text-center">
      <div className="flex justify-center">
        <Sparkles className="size-6 text-accent-brand" aria-hidden />
      </div>
      <p className="text-body-md text-text-secondary">
        Ask anything about this video, or start with a suggestion:
      </p>
      <ul className="flex flex-col gap-2">
        {STATIC_SUGGESTIONS.map((s) => (
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
