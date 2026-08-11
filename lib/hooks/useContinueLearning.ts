"use client";

import { useEffect, useRef, useState } from "react";
import {
  ContinueLearningResponseSchema,
  type ContinueLearningReadyResponse,
  type ContinueLearningResponse,
} from "@/lib/api-contracts/continue-learning";

export const CONTINUE_LEARNING_POLL_INTERVAL_MS = 1_000;
export const CONTINUE_LEARNING_MAX_WAIT_MS = 10_000;

export type ContinueLearningState =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "ready"; readonly data: ContinueLearningReadyResponse }
  | { readonly status: "unavailable" };

interface ContinueLearningOptions {
  readonly enabled?: boolean;
  readonly intervalMs?: number;
  readonly maxWaitMs?: number;
}

interface StoredState {
  readonly sourceUrl: string | null;
  readonly value: ContinueLearningState;
}

function responseUrl(sourceUrl: string): string {
  return `/api/continue-learning?youtube_url=${encodeURIComponent(sourceUrl)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Polls only the server-owned reader route. A source change or unmount aborts
 * the current request; a generation guard also discards a response that wins
 * the abort race. The ten-second bound is a UX courtesy, not a preparation
 * guarantee, so timeout and malformed/error responses fail soft.
 */
export function useContinueLearning(
  sourceUrl: string | null,
  options: ContinueLearningOptions = {},
): ContinueLearningState {
  const {
    enabled = false,
    intervalMs = CONTINUE_LEARNING_POLL_INTERVAL_MS,
    maxWaitMs = CONTINUE_LEARNING_MAX_WAIT_MS,
  } = options;
  const [stored, setStored] = useState<StoredState>({
    sourceUrl,
    value: enabled && sourceUrl ? { status: "pending" } : { status: "idle" },
  });
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(0, maxWaitMs);

    const isCurrent = () => generationRef.current === generation;
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const clearDeadlineTimer = () => {
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
    };
    const setCurrent = (value: ContinueLearningState) => {
      if (isCurrent()) setStored({ sourceUrl, value });
    };
    const complete = (value: ContinueLearningState) => {
      clearTimer();
      clearDeadlineTimer();
      setCurrent(value);
    };
    const failSoft = () => complete({ status: "unavailable" });

    if (!enabled || !sourceUrl) {
      setCurrent({ status: "idle" });
      return () => {
        controller.abort();
        clearTimer();
        clearDeadlineTimer();
      };
    }

    setCurrent({ status: "pending" });
    deadlineTimer = setTimeout(() => {
      if (!isCurrent()) return;
      controller.abort();
      failSoft();
    }, Math.max(0, maxWaitMs));

    const schedule = (read: () => void) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        failSoft();
        return;
      }
      timer = setTimeout(read, Math.min(Math.max(0, intervalMs), remaining));
    };

    const read = async (): Promise<void> => {
      if (!isCurrent() || controller.signal.aborted) return;
      if (Date.now() >= deadline) {
        failSoft();
        return;
      }
      try {
        const response = await fetch(responseUrl(sourceUrl), {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!isCurrent() || controller.signal.aborted) return;
        if (Date.now() >= deadline) {
          failSoft();
          return;
        }
        if (!response.ok) {
          failSoft();
          return;
        }
        const parsed = ContinueLearningResponseSchema.safeParse(
          await response.json(),
        );
        if (!isCurrent() || controller.signal.aborted) return;
        if (!parsed.success || Date.now() >= deadline) {
          failSoft();
          return;
        }
        const payload: ContinueLearningResponse = parsed.data;
        if (payload.outcome === "ready") {
          complete({ status: "ready", data: payload });
          return;
        }
        if (payload.outcome === "unavailable") {
          failSoft();
          return;
        }
        setCurrent({ status: "pending" });
        schedule(() => void read());
      } catch (error) {
        if (!isCurrent() || controller.signal.aborted || isAbortError(error)) {
          return;
        }
        failSoft();
      }
    };

    void read();

    return () => {
      controller.abort();
      clearTimer();
      clearDeadlineTimer();
    };
  }, [enabled, intervalMs, maxWaitMs, sourceUrl]);

  if (stored.sourceUrl !== sourceUrl) {
    return enabled && sourceUrl ? { status: "pending" } : { status: "idle" };
  }
  return stored.value;
}
