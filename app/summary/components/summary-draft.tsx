"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTheme } from "next-themes";
import { buildSummaryMarkdownComponents } from "./summary-markdown-renderer";

interface SummaryDraftProps {
  readonly text: string;
}

/**
 * Incomplete output is intentionally a separate presentation. It can be
 * useful to read while a run is active (or after a failed run), but it has no
 * Summary actions and cannot unlock Video Chat.
 */
export function SummaryDraft({ text }: SummaryDraftProps) {
  const { resolvedTheme } = useTheme();
  const markdownComponents = buildSummaryMarkdownComponents({
    isDark: resolvedTheme === "dark",
  });

  return (
    <section
      aria-label="Summary Draft"
      aria-live="polite"
      data-summary-state="draft"
      data-testid="summary-draft"
      className="mb-5 rounded-xl border border-border-subtle bg-surface-raised p-5 shadow-inner"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-h5 text-text-primary">Summary Draft</h2>
        <span className="rounded-full bg-accent-warning/15 px-3 py-1 text-caption text-accent-warning">
          Not ready for actions
        </span>
      </div>
      <div className="prose max-w-none dark:prose-invert">
        {text ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {text}
          </ReactMarkdown>
        ) : (
          <p className="text-body-md text-text-secondary">
            Summary text will appear as this run progresses.
          </p>
        )}
      </div>
    </section>
  );
}
