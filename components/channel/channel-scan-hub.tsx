"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { PublicScanRun } from "@/lib/channel-scans";

const DEFAULT_CHANNEL_ID = "synthetic-demo-channel";
const ACTIVE_STATUSES = new Set<PublicScanRun["status"]>(["queued", "running"]);

type ApiBody = {
  message?: string;
  outcome?: string;
  retryAt?: string | null;
  run?: PublicScanRun;
  runs?: PublicScanRun[];
};

type ChannelHubProps = Readonly<{
  initialChannelId?: string;
}>;

function isActive(run: PublicScanRun): boolean {
  return ACTIVE_STATUSES.has(run.status);
}

function statusLabel(run: PublicScanRun): string {
  if (run.cancelRequestedAt && isActive(run)) return "Cancellation requested";
  if (run.status === "queued") return "Queued";
  if (run.status === "running") return "Running";
  if (run.outcome === "completed") return "Completed";
  if (run.outcome === "partial") return "Partial";
  if (run.outcome === "cancelled") return "Cancelled";
  if (run.outcome === "failed") return "Failed";
  return "Unknown";
}

function statusIcon(run: PublicScanRun) {
  if (run.status === "queued" || run.status === "running") {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-4 motion-safe:animate-spin motion-reduce:animate-none"
      />
    );
  }
  if (run.outcome === "completed") {
    return <CheckCircle2 aria-hidden="true" className="size-4" />;
  }
  if (run.outcome === "cancelled") {
    return <XCircle aria-hidden="true" className="size-4" />;
  }
  return <AlertCircle aria-hidden="true" className="size-4" />;
}

function statusClass(run: PublicScanRun): string {
  if (run.status === "queued" || run.status === "running") {
    return "border-accent-brand/30 bg-accent-brand/10 text-accent-brand";
  }
  if (run.outcome === "completed") {
    return "border-accent-success/30 bg-accent-success/10 text-accent-success";
  }
  if (run.outcome === "cancelled") {
    return "border-border-default bg-surface-sunken text-text-secondary";
  }
  return "border-accent-danger/30 bg-accent-danger/10 text-accent-danger";
}

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function dateTimeWithClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function apiError(body: ApiBody, fallback: string): Error {
  const message = body.message?.trim();
  return new Error(message || fallback);
}

async function requestJson<T extends ApiBody>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: T;
  try {
    body = (await response.json()) as T;
  } catch {
    throw new Error("The scan service returned an unreadable response.");
  }
  if (!response.ok) throw apiError(body, "The scan service is unavailable.");
  return body;
}

function coverageCopy(run: PublicScanRun): string {
  if (run.coverage.boundPreventedCompleteCoverage) {
    const bound =
      run.coverage.bound === "thread_limit"
        ? "200-thread cap"
        : "seven-day time window";
    return `${bound} prevented complete coverage.`;
  }
  if (run.coverage.completeWithinBounds) {
    return "Complete within the seven-day window and thread bound.";
  }
  if (isActive(run)) return "Coverage is still being gathered within the bounds.";
  if (run.outcome === "failed") return "Coverage stopped because the run failed.";
  if (run.outcome === "cancelled") {
    return "Coverage stopped by the Channel Steward; completed assessments remain saved.";
  }
  return "Coverage did not reach a complete bounded result.";
}

function RunCoverage({ run }: { run: PublicScanRun }) {
  const { coverage, progress } = run;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">
            Assessment progress
          </p>
          <p className="mt-1 text-body-md font-semibold text-text-primary">
            {progress.processedThreads} of {progress.totalThreads || "?"} threads processed
          </p>
        </div>
        <span className="text-h4 font-semibold tabular-nums text-text-primary">
          {progress.percent}%
        </span>
      </div>
      <Progress
        aria-label={`Assessment progress: ${progress.percent}%`}
        aria-valuetext={`${progress.percent}% of bounded scan processed`}
        value={progress.percent}
        className="h-3 bg-surface-sunken"
      />
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`Assessment progress: ${progress.percent}% — ${progress.processedThreads} of ${progress.totalThreads || "?"} threads processed`}
      >
        Assessment progress: {progress.percent}% — {progress.processedThreads} of {progress.totalThreads || "?"} threads processed.
      </p>
      <div className="grid gap-3 text-body-sm text-text-secondary sm:grid-cols-3">
        <div className="flex items-center gap-2">
          <Layers3 aria-hidden="true" className="size-4 text-accent-brand" />
          <span>{coverage.pages} pages</span>
        </div>
        <div className="flex items-center gap-2">
          <MessageSquareText aria-hidden="true" className="size-4 text-accent-brand" />
          <span>{coverage.threadsDiscovered} discovered</span>
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="size-4 text-accent-brand" />
          <span>
            {coverage.threadsAssessed} assessed · {coverage.threadsReused} reused ·{" "}
            {coverage.threadsFailed} failed
          </span>
        </div>
      </div>
      <div className="rounded-lg border border-border-subtle bg-surface-sunken/60 px-3 py-2 text-body-sm text-text-secondary">
        <span className="font-medium text-text-primary">Time covered: </span>
        {dateTime(coverage.oldestThreadAt ?? coverage.windowStart)} →{" "}
        {dateTime(coverage.newestThreadAt ?? coverage.windowEnd)}
        <span className="text-text-muted"> (window ends {dateTime(coverage.windowEnd)})</span>
      </div>
      <p
        className={
          coverage.boundPreventedCompleteCoverage
            ? "text-body-sm font-medium text-accent-warning"
            : "text-body-sm text-text-secondary"
        }
      >
        {coverageCopy(run)}
      </p>
    </div>
  );
}

function RunRow({
  run,
  selected,
  onSelect,
}: {
  run: PublicScanRun;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 text-left transition-colors motion-reduce:transition-none last:border-b-0 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-brand ${
        selected ? "bg-state-hover" : ""
      }`}
    >
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-medium text-text-primary">
          {run.id}
        </span>
        <span className="mt-1 block text-caption text-text-muted">
          {dateTimeWithClock(run.createdAt)} · {run.coverage.threadsDiscovered} threads
        </span>
      </span>
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-caption font-semibold ${statusClass(run)}`}
      >
        {statusIcon(run)}
        {statusLabel(run)}
      </span>
    </button>
  );
}

export function ChannelHub({ initialChannelId = DEFAULT_CHANNEL_ID }: ChannelHubProps) {
  const [channelId, setChannelId] = useState(initialChannelId);
  const [runs, setRuns] = useState<PublicScanRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"start" | "cancel" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const replaceRun = useCallback((run: PublicScanRun) => {
    setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
    setSelectedRunId(run.id);
  }, []);

  const loadRuns = useCallback(async () => {
    setIsLoading(true);
    try {
      const body = await requestJson<{ runs?: PublicScanRun[] }>(
        `/api/channel/scans?connectedChannelId=${encodeURIComponent(channelId)}`,
        { cache: "no-store" },
      );
      const nextRuns = body.runs ?? [];
      setRuns(nextRuns);
      setSelectedRunId((current) => current ?? nextRuns[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn't load scan runs.");
    } finally {
      setIsLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRuns(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedRun || !isActive(selectedRun)) return;
    let disposed = false;
    const poll = async () => {
      try {
        const body = await requestJson<{ run?: PublicScanRun }>(
          `/api/channel/scans/${selectedRun.id}`,
          { cache: "no-store" },
        );
        if (!disposed && body.run) replaceRun(body.run);
      } catch (pollError) {
        if (!disposed) {
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Couldn't refresh this Scan Run.",
          );
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [replaceRun, selectedRun]);

  async function startScan() {
    setBusyAction("start");
    setError(null);
    setNotice(null);
    try {
      const body = await requestJson<{ run?: PublicScanRun }>("/api/channel/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectedChannelId: channelId, provider: "synthetic" }),
      });
      if (!body.run) throw new Error("The scan service did not return a Scan Run.");
      replaceRun(body.run);
      setNotice("Scan Run started. This page can be left and reopened safely.");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Couldn't start the scan.");
    } finally {
      setBusyAction(null);
    }
  }

  async function cancelScan(run: PublicScanRun) {
    setBusyAction("cancel");
    setError(null);
    setNotice(null);
    try {
      const body = await requestJson<{ run?: PublicScanRun }>(
        `/api/channel/scans/${run.id}/cancel`,
        { method: "POST" },
      );
      if (!body.run) throw new Error("The scan service did not return the updated run.");
      replaceRun(body.run);
      setNotice(
        body.run.outcome === "cancelled"
          ? "Scan Run cancelled. Completed assessments were retained."
          : "Cancellation requested. Completed assessments will be retained.",
      );
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Couldn't cancel the scan.");
    } finally {
      setBusyAction(null);
    }
  }

  async function retryScan(run: PublicScanRun) {
    setBusyAction("retry");
    setError(null);
    setNotice(null);
    try {
      const body = await requestJson<{ run?: PublicScanRun }>(
        `/api/channel/scans/${run.id}/retry`,
        { method: "POST" },
      );
      if (!body.run) throw new Error("The scan service did not return the retry run.");
      replaceRun(body.run);
      setNotice("Retry started. Unchanged successful assessments will be reused.");
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Couldn't retry the scan.");
    } finally {
      setBusyAction(null);
    }
  }

  const activeForChannel = runs.some(
    (run) => run.connectedChannelId === channelId && isActive(run),
  );
  const canRetry =
    selectedRun &&
    !isActive(selectedRun) &&
    selectedRun.outcome !== "completed";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:py-12">
      <section className="relative overflow-hidden rounded-[1.75rem] border border-border-strong bg-surface-sunken px-5 py-7 text-text-primary shadow-xl sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-accent-brand-secondary/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
          <div>
            <div className="mb-5 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.2em] text-accent-brand-secondary">
              <ScanSearch aria-hidden="true" className="size-4" />
              Channel / synthetic lab
            </div>
            <h1 className="max-w-xl text-4xl font-semibold tracking-[-0.04em] text-text-primary sm:text-5xl">
              See the signal before you act.
            </h1>
            <p className="mt-4 max-w-2xl text-body-md leading-7 text-text-secondary">
              A durable, bounded rehearsal of comment assistance. Every run covers only
              the seven most recent days and up to 200 top-level threads, with its limits
              and progress kept visible.
            </p>
          </div>
          <div className="rounded-2xl border border-border-strong bg-surface-base/30 p-4">
            <div className="flex items-center justify-between text-caption font-semibold uppercase tracking-[0.14em] text-text-muted">
              <span>Coverage ruler</span>
              <span className="text-accent-brand-secondary">hard bounds</span>
            </div>
            <div className="mt-4 grid grid-cols-[7fr_3fr] gap-1" aria-label="Scan bounds">
              <div className="h-2 rounded-l-full bg-accent-brand-secondary" />
              <div className="h-2 rounded-r-full bg-accent-warning" />
            </div>
            <div className="mt-3 flex justify-between gap-3 text-body-sm text-text-secondary">
              <span>7 most recent days</span>
              <span className="text-right">200 top-level threads</span>
            </div>
            <p className="sr-only">7 days / 200 threads</p>
          </div>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>Scan action unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <p role="status" aria-live="polite" className="rounded-lg border border-accent-success/30 bg-accent-success/10 px-4 py-3 text-body-sm text-accent-success">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="border-border-subtle bg-surface-raised">
          <CardHeader>
            <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.16em] text-accent-brand">
              <ShieldCheck aria-hidden="true" className="size-4" />
              Governed start
            </div>
            <CardTitle className="mt-2 text-h4">Rehearse a Channel scan</CardTitle>
            <p className="text-body-sm leading-6 text-text-secondary">
              Synthetic data keeps this surface safe while verified channel identity is
              being onboarded. It does not call YouTube.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="connected-channel">Connected Channel key</Label>
              <Input
                id="connected-channel"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                aria-describedby="connected-channel-help"
              />
              <p id="connected-channel-help" className="text-caption leading-5 text-text-muted">
                Use the pre-release key <code>synthetic-demo-channel</code>. Real channel
                identity starts after onboarding is complete.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void startScan()}
              disabled={busyAction !== null || activeForChannel}
              className="w-full rounded-full bg-accent-brand text-white hover:bg-accent-brand/90"
            >
              {busyAction === "start" ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin motion-reduce:animate-none" />
              ) : (
                <ScanSearch aria-hidden="true" />
              )}
              {activeForChannel ? "Scan already running" : "Run synthetic scan"}
            </Button>
            <div className="grid grid-cols-2 gap-3 border-t border-border-subtle pt-4 text-body-sm">
              <div>
                <p className="text-text-muted">Account guard</p>
                <p className="mt-1 font-semibold text-text-primary">4 starts / hour</p>
              </div>
              <div>
                <p className="text-text-muted">Channel guard</p>
                <p className="mt-1 font-semibold text-text-primary">1 active run</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[28rem] overflow-hidden border-border-subtle bg-surface-raised">
          <CardHeader className="border-b border-border-subtle">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">
                  <Clock3 aria-hidden="true" className="size-4" />
                  Run ledger
                </div>
                <CardTitle className="mt-2 text-h4">Durable Scan Runs</CardTitle>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void loadRuns()}
                disabled={isLoading}
                aria-label="Refresh scan runs"
              >
                <RefreshCw aria-hidden="true" className={isLoading ? "motion-safe:animate-spin motion-reduce:animate-none" : ""} />
                Refresh
              </Button>
            </div>
            <p className="text-body-sm leading-6 text-text-secondary">
              Leave this page whenever you need. Opening it again reads the durable ledger
              and resumes any active worker.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && runs.length === 0 ? (
              <p className="px-6 py-10 text-center text-body-sm text-text-muted">Loading Scan Runs…</p>
            ) : runs.length === 0 ? (
              <p className="px-6 py-10 text-center text-body-sm text-text-muted">No scan runs yet.</p>
            ) : (
              <div className="divide-y divide-border-subtle">
                {runs.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    selected={selectedRun?.id === run.id}
                    onSelect={() => setSelectedRunId(run.id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedRun ? (
        <Card className="border-border-subtle bg-surface-raised">
          <CardHeader className="flex flex-col gap-4 border-b border-border-subtle sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-h4">Run detail</CardTitle>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-semibold ${statusClass(selectedRun)}`}>
                  {statusIcon(selectedRun)}
                  {statusLabel(selectedRun)}
                </span>
              </div>
              <p className="mt-2 break-all font-mono text-caption text-text-muted">{selectedRun.id}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isActive(selectedRun) ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void cancelScan(selectedRun)}
                  disabled={busyAction !== null}
                >
                  {busyAction === "cancel" ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin motion-reduce:animate-none" /> : <XCircle aria-hidden="true" />}
                  Cancel scan
                </Button>
              ) : null}
              {canRetry ? (
                <Button
                  type="button"
                  onClick={() => void retryScan(selectedRun)}
                  disabled={busyAction !== null}
                  className="bg-accent-brand text-white hover:bg-accent-brand/90"
                >
                  {busyAction === "retry" ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin motion-reduce:animate-none" /> : <RefreshCw aria-hidden="true" />}
                  Retry scan
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <RunCoverage run={selectedRun} />
          </CardContent>
        </Card>
      ) : null}

      <p className="text-center text-caption leading-5 text-text-muted">
        Synthetic assessments are rehearsal data. No moderation action or background
        completion notification is sent from this surface.
      </p>
    </main>
  );
}
