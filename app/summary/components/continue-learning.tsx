"use client";

import { ArrowUpRight, BookOpen, ExternalLink } from "lucide-react";
import { useTheme } from "next-themes";
import { useContinueLearning } from "@/lib/hooks/useContinueLearning";

const RELATIONSHIP_LABELS = {
  deeper_explanation: "Deeper explanation",
  prerequisite: "Prerequisite",
  practical_application: "Practical application",
  credible_alternative: "Credible alternative",
} as const;

interface ContinueLearningSectionProps {
  readonly sourceUrl: string;
  readonly enabled: boolean;
}

export function ContinueLearningSection({
  sourceUrl,
  enabled,
}: ContinueLearningSectionProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const state = useContinueLearning(sourceUrl, { enabled });

  if (state.status === "idle" || state.status === "unavailable") return null;

  const headingId = "continue-learning-heading";
  if (state.status === "pending") {
    return (
      <section
        aria-labelledby={headingId}
        data-testid="continue-learning-section"
        className="space-y-3"
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-accent-brand" aria-hidden="true" />
          <h3
            id={headingId}
            className={`text-lg font-semibold ${isDark ? "text-white" : "text-slate-900"}`}
          >
            Continue learning
          </h3>
        </div>
        <div
          data-testid="continue-learning-skeleton"
          role="status"
          aria-live="polite"
          aria-busy="true"
          className={`motion-safe:animate-pulse motion-reduce:animate-none rounded-xl border p-4 ${
            isDark
              ? "border-white/15 bg-white/5"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <span className="sr-only">Preparing Continue Learning recommendations</span>
          <div className="h-5 w-2/3 rounded bg-current opacity-10" />
          <div className="mt-3 h-4 w-full rounded bg-current opacity-10" />
          <div className="mt-2 h-4 w-4/5 rounded bg-current opacity-10" />
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="continue-learning-section"
      className="space-y-3"
    >
      <div className="flex items-center gap-2">
        <BookOpen className="h-5 w-5 text-accent-brand" aria-hidden="true" />
        <h3
          id={headingId}
          className={`text-lg font-semibold ${isDark ? "text-white" : "text-slate-900"}`}
        >
          Continue learning
        </h3>
      </div>
      <ul
        role="list"
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
        data-testid="continue-learning-cards"
      >
        {state.data.items.map((item) => (
          <li
            key={item.token}
            className={`flex min-w-0 flex-col rounded-xl border p-4 ${
              isDark
                ? "border-white/15 bg-white/5"
                : "border-slate-200 bg-white"
            }`}
          >
            {item.thumbnailUrl ? (
              // Recommendation thumbnails are server-validated YouTube URLs;
              // Next Image's remote allow-list is intentionally not expanded
              // for this dormant, fail-closed seam.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt=""
                aria-hidden="true"
                loading="lazy"
                className="mb-3 aspect-video w-full rounded-lg object-cover"
              />
            ) : null}
            <div className="flex flex-1 flex-col gap-3">
              <div>
                <span
                  className="inline-flex rounded-full bg-accent-brand/15 px-2 py-1 text-xs font-medium text-accent-brand"
                  data-testid="continue-learning-relationship"
                  aria-label={`Continuation relationship: ${RELATIONSHIP_LABELS[item.relationship]}`}
                >
                  {RELATIONSHIP_LABELS[item.relationship]}
                </span>
                <h4
                  className={`mt-2 text-base font-semibold ${isDark ? "text-white" : "text-slate-900"}`}
                >
                  {item.title || "Untitled video"}
                </h4>
                {item.channelName ? (
                  <p className={`mt-1 text-sm ${isDark ? "text-gray-300" : "text-slate-600"}`}>
                    {item.channelName}
                  </p>
                ) : null}
              </div>
              <p className={`text-sm leading-6 ${isDark ? "text-gray-200" : "text-slate-700"}`}>
                {item.explanation}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <a
                  href={`/summary?url=${encodeURIComponent(item.canonicalUrl)}`}
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-accent-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-brand focus-visible:ring-offset-2"
                >
                  Summarize Next
                  <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <a
                  href={item.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-brand focus-visible:ring-offset-2 ${
                    isDark
                      ? "border-white/20 text-gray-100 hover:bg-white/10"
                      : "border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Watch on YouTube
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
