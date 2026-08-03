"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createSummaryRunController,
  type SummaryRunControllerOptions,
  type SummaryRunInput,
} from "@/lib/summary-run/summary-run";

export type UseSummaryRunOptions = SummaryRunControllerOptions;

class LatestOptions {
  private current: UseSummaryRunOptions;

  constructor(initial: UseSummaryRunOptions) {
    this.current = initial;
  }

  update(next: UseSummaryRunOptions): void {
    this.current = next;
  }

  getAccessToken(): ReturnType<UseSummaryRunOptions["getAccessToken"]> {
    return this.current.getAccessToken();
  }

  notifyAuthError(status: number, message: string): void {
    this.current.onAuthError?.(status, message);
  }

  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const fetchImpl = this.current.fetch ?? globalThis.fetch;
    return fetchImpl(input, init);
  }
}

/**
 * React's deliberately thin adapter for the framework-independent Summary
 * Run controller. TanStack Query, Response objects, SSE frames, and the
 * transport accumulator stay behind the controller boundary.
 */
export function useSummaryRun(options: UseSummaryRunOptions) {
  const [optionsStore] = useState(() => new LatestOptions(options));
  useEffect(() => {
    optionsStore.update(options);
  }, [options, optionsStore]);

  const [controller] = useState(() =>
    createSummaryRunController({
      fetch: (input, init) => optionsStore.fetch(input, init),
      getAccessToken: () => optionsStore.getAccessToken(),
      onAuthError: (status, message) =>
        optionsStore.notifyAuthError(status, message),
      now: options.now,
      elapsedTickMs: options.elapsedTickMs,
      createRunId: options.createRunId,
    }),
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const start = useCallback(
    (input: SummaryRunInput) => controller.start(input),
    [controller],
  );
  const cancel = useCallback(() => controller.cancel(), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);

  useEffect(() => () => controller.cancel(), [controller]);

  return { snapshot, start, cancel, retry };
}
