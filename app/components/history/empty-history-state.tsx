import { Sparkles } from "lucide-react";

export function EmptyHistoryState() {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-6 py-10 text-center"
    >
      <Sparkles className="h-8 w-8 text-text-muted" aria-hidden="true" />
      <p className="text-body-md text-text-primary">
        You haven&apos;t summarized any videos yet.
      </p>
      <p className="text-body-sm text-text-muted">
        Paste a YouTube URL above to get started.
      </p>
    </div>
  );
}
