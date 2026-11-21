"use client";

import { useTranslations } from "next-intl";
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
export function ChatEmptyState({
  onPickSuggestion,
  dynamicSuggestions,
}: ChatEmptyStateProps) {
  const t = useTranslations("home");
  const suggestions =
    dynamicSuggestions && dynamicSuggestions.length > 0
      ? dynamicSuggestions
      : [t("takeaways"), t("actions"), t("quote")];
  return (
    <div className="flex flex-1 flex-col items-stretch justify-center gap-3 p-4 text-center">
      <div className="flex justify-center">
        <Sparkles className="size-6 text-accent-brand" aria-hidden />
      </div>
      <p className="text-body-md text-text-secondary">
        {t("askAnything")}
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
