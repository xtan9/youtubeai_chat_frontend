"use client";

import { Loader2, FileText, Brain, CheckCircle, Clock } from "lucide-react";
import { StreamingProgress } from "../utils";
import { useEffect, useRef, useState } from "react";
import { shouldShowElapsed } from "./streaming-progress-helpers";

/**
 * Progress indicator component that shows the current stage of the streaming process
 */
export function StreamingProgressIndicator({
  progress,
}: {
  progress: StreamingProgress;
}) {
  const messageRef = useRef<HTMLParagraphElement>(null);

  // Local elapsed timer: measured from mount, independent of any server-
  // side timing events. Freezes on stage === "complete" so the final value
  // sticks.
  // TODO(B-followup): replace `performance.now()` in render with a
  // `useState` lazy initializer so the start time is captured once
  // without invoking an impure function during render.
  // eslint-disable-next-line react-hooks/purity
  const startRef = useRef<number>(performance.now());
  const [elapsed, setElapsed] = useState(0);
  const isComplete = progress.stage === "complete";

  useEffect(() => {
    if (isComplete) return;
    const id = setInterval(() => {
      setElapsed((performance.now() - startRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [isComplete]);

  // Auto-scroll to bottom when message changes
  useEffect(() => {
    if (messageRef.current) {
      messageRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [progress.message]);

  const stageIcons = {
    preparing: Loader2,
    transcribing: FileText,
    summarizing: Brain,
    complete: CheckCircle,
  };

  const stageGradients = {
    preparing: "bg-gradient-stage-preparing",
    transcribing: "bg-gradient-stage-transcribing",
    summarizing: "bg-gradient-stage-summarizing",
    complete: "bg-gradient-stage-complete",
  };

  const Icon = stageIcons[progress.stage];
  const gradientClass = stageGradients[progress.stage];

  return (
    <div className="bg-surface-raised dark:bg-surface-sunken/80 border-border-subtle dark:border-border-default/50 backdrop-blur-sm border rounded-xl px-5 py-3 mb-5 shadow-inner">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full ${gradientClass} flex items-center justify-center shadow-sm`}
          >
            <Icon
              className={`w-5 h-5 text-white ${
                progress.stage === "preparing" ? "animate-spin" : ""
              }`}
            />
          </div>
          <div>
            <span className="text-lg font-semibold text-text-primary capitalize">
              {progress.stage.replace("_", " ")}
            </span>
            {shouldShowElapsed(isComplete, elapsed) && (
              <div className="flex items-center gap-1 text-sm text-text-muted">
                <Clock className="w-3 h-3" />
                {elapsed.toFixed(1)}s elapsed
              </div>
            )}
          </div>
        </div>
        <span className="text-lg font-mono text-text-primary">
          {Math.round(progress.progress)}%
        </span>
      </div>

      <div className="w-full bg-surface-sunken dark:bg-surface-sunken/70 rounded-full h-3 overflow-hidden my-3">
        <div
          className={`${gradientClass} h-3 rounded-full transition-all duration-500 ease-out relative`}
          style={{ width: `${progress.progress}%` }}
        >
          <div className="absolute inset-0 bg-white/20 rounded-full animate-pulse"></div>
        </div>
      </div>
    </div>
  );
}
