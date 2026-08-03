"use client";

import { Brain, CheckCircle, Clock, FileText, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SummaryRunProgress } from "@/lib/summary-run/summary-run";

/** Render only validated protocol stage + controller-owned elapsed time. */
export function StreamingProgressIndicator({
  progress,
}: {
  readonly progress: SummaryRunProgress;
}) {
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    messageRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progress.message]);

  const stageIcons = {
    preparing: Loader2,
    transcribing: FileText,
    summarizing: Brain,
    complete: CheckCircle,
  } as const;
  const stageGradients = {
    preparing: "bg-gradient-stage-preparing",
    transcribing: "bg-gradient-stage-transcribing",
    summarizing: "bg-gradient-stage-summarizing",
    complete: "bg-gradient-stage-complete",
  } as const;
  const Icon = stageIcons[progress.stage];
  const gradientClass = stageGradients[progress.stage];

  return (
    <div className="mb-5 rounded-xl border border-border-subtle bg-surface-raised px-5 py-4 shadow-inner">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-full ${gradientClass} shadow-sm`}
        >
          <Icon
            className={`h-5 w-5 text-text-inverse ${
              progress.stage === "preparing" ? "animate-spin" : ""
            }`}
          />
        </div>
        <div>
          <p className="text-body-lg font-semibold capitalize text-text-primary">
            {progress.stage}
          </p>
          <p ref={messageRef} className="text-body-sm text-text-secondary">
            {progress.message}
          </p>
          <div className="flex items-center gap-1 text-caption text-text-muted">
            <Clock className="h-3 w-3" />
            {progress.elapsedSeconds.toFixed(1)}s elapsed
          </div>
        </div>
      </div>
    </div>
  );
}
