"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck2,
  LoaderCircle,
  MessageSquareText,
  ScanSearch,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  getHubCapabilities,
  getReviewActions,
  getReviewStatusDescription,
  getReviewStatusLabel,
  getScreenStateDescription,
  getScreenStateLabel,
  type ChannelHubChannel,
  type ChannelHubState,
  type HubAction,
  type HubCoverage,
  type HubReviewAction,
  type HubReviewItem,
  type HubReviewStatus,
  type HubScanRun,
} from "@/lib/channel-hub/contract";

export type ChannelHubExperienceProps = Readonly<{
  state: ChannelHubState;
  mode?: "preview" | "release";
  onAction?: (action: HubAction, subjectId?: string) => void;
  revealSensitiveEvidence?: (itemId: string) => string | Promise<string>;
  onDraftChange?: (itemId: string, text: string) => void;
  className?: string;
}>;

type ReviewState = Extract<
  ChannelHubState,
  { kind: "review" | "grace_period" }
>;

const ACTIVE_SCAN_STATUSES = new Set<HubScanRun["status"]>([
  "queued",
  "running",
]);

const READ_ONLY_ALLOWED_ACTIONS = new Set<HubAction>([
  "open_on_youtube",
  "continue_safety_guidance",
  "recheck_publication",
  "delete_published_reply",
]);

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function scanStatusLabel(run: HubScanRun): string {
  if (run.status === "queued") return "Queued";
  if (run.status === "running") return "Running";
  if (run.status === "completed") return "Completed";
  if (run.status === "partial") return "Partial";
  if (run.status === "cancelled") return "Cancelled";
  return "Failed";
}

function scanStatusDescription(run: HubScanRun): string {
  if (run.status === "queued") return "The Scan Run is waiting to start.";
  if (run.status === "running") return "The Scan Run is assessing bounded recent activity.";
  if (run.status === "completed") return "The bounded scan completed.";
  if (run.status === "partial") return "The scan stopped before complete bounded coverage.";
  if (run.status === "cancelled") return "The scan was cancelled; completed assessments remain retained.";
  return run.failureMessage ?? "The scan failed; review the failure before retrying.";
}

function scanStatusIcon(run: HubScanRun) {
  if (run.status === "queued" || run.status === "running") {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-4 motion-safe:animate-spin motion-reduce:animate-none"
      />
    );
  }
  if (run.status === "completed") {
    return <CheckCircle2 aria-hidden="true" className="size-4" />;
  }
  if (run.status === "cancelled") {
    return <XCircle aria-hidden="true" className="size-4" />;
  }
  return <AlertTriangle aria-hidden="true" className="size-4" />;
}

function reviewStatusIcon(status: HubReviewStatus) {
  if (status === "publishing") {
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-4 motion-safe:animate-spin motion-reduce:animate-none"
      />
    );
  }
  if (status === "published") return <CheckCircle2 aria-hidden="true" className="size-4" />;
  if (status === "deleted" || status === "dismissed") {
    return <CircleDot aria-hidden="true" className="size-4" />;
  }
  if (status === "safety_flag") return <ShieldAlert aria-hidden="true" className="size-4" />;
  if (status === "failed") return <AlertTriangle aria-hidden="true" className="size-4" />;
  return <Clock3 aria-hidden="true" className="size-4" />;
}

function statusClass(status: HubReviewStatus): string {
  if (status === "safety_flag") {
    return "border-accent-danger/40 bg-accent-danger/10 text-accent-danger";
  }
  if (status === "published") {
    return "border-accent-success/40 bg-accent-success/10 text-accent-success";
  }
  if (status === "failed") {
    return "border-accent-warning/50 bg-accent-warning/10 text-text-primary";
  }
  if (status === "publishing" || status === "draft_requested") {
    return "border-accent-brand/40 bg-accent-brand/10 text-accent-brand";
  }
  return "border-border-default bg-surface-sunken text-text-secondary";
}

function isSafetyFlagItem(item: HubReviewItem): boolean {
  return (
    item.classification === "Safety Flag" ||
    item.severity === "severe" ||
    item.status === "safety_flag"
  );
}

function reviewQueuePriority(item: HubReviewItem): number {
  if (isSafetyFlagItem(item)) return 0;
  if (item.classification === "Actionable Abuse") return 1;
  return 2;
}

function ReviewStatusPill({ status }: { status: HubReviewStatus }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption font-semibold ${statusClass(status)}`}
      data-review-status={status}
      title={getReviewStatusDescription(status)}
    >
      {reviewStatusIcon(status)}
      <span>{getReviewStatusLabel(status)}</span>
    </span>
  );
}

function ScanStatusPill({ run }: { run: HubScanRun }) {
  return (
    <span
      className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border-default bg-surface-sunken px-2.5 py-1 text-caption font-semibold text-text-secondary"
      data-scan-status={run.status}
      title={scanStatusDescription(run)}
    >
      {scanStatusIcon(run)}
      <span>{scanStatusLabel(run)}</span>
    </span>
  );
}

function authorizationCopy(channel: ChannelHubChannel, readOnly = false): string {
  if (channel.grantStatus !== "active" || !channel.active) {
    return "The Connected YouTube Channel is not active.";
  }
  if (channel.publishingAuthorization === "active") {
    return readOnly
      ? "Publishing Authorization is active for this connected identity, but new publications are blocked during the read-only grace period."
      : "Publishing Authorization is active for this connected identity.";
  }
  if (channel.publishingAuthorization === "revoked") {
    return "Publishing Authorization is revoked; review remains separate.";
  }
  return "Publishing Authorization has not been requested. A scan cannot publish.";
}

function ChannelIdentityPanel({
  channel,
  readOnly = false,
}: {
  channel: ChannelHubChannel;
  readOnly?: boolean;
}) {
  const titleId = useId();
  return (
    <Card
      className="border-border-subtle bg-surface-raised"
      data-channel-context="connected"
      role="region"
      aria-labelledby={titleId}
    >
      <CardHeader className="gap-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">
          <CircleDot aria-hidden="true" className="size-4 text-accent-success" />
          Verified identity context
        </div>
        <h2 id={titleId} className="text-h5 font-semibold leading-none">
          Channel and publishing identity
        </h2>
      </CardHeader>
      <CardContent className="pt-5">
        <dl className="grid min-w-0 gap-4 text-body-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-text-muted">Channel</dt>
            <dd className="mt-1 break-words font-medium text-text-primary">{channel.channelId}<span className="mt-1 block text-caption font-normal text-text-muted">The account-owned Channel resource.</span></dd>
          </div>
          <div className="min-w-0">
            <dt className="text-text-muted">Connected YouTube Channel</dt>
            <dd className="mt-1 break-words font-medium text-text-primary">{channel.displayName}<span className="mt-1 block break-all font-mono text-caption font-normal text-text-muted">Provider identity: {channel.providerChannelId}</span></dd>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-text-muted">Publishing identity</dt>
            <dd className="mt-1 break-words font-medium text-text-primary">
              {channel.displayName} ({channel.providerChannelId})
            </dd>
            <dd className="mt-1 text-caption leading-5 text-text-secondary">{authorizationCopy(channel, readOnly)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function CoverageSummary({
  coverage,
  scanRun,
}: {
  coverage: HubCoverage | null | undefined;
  scanRun?: HubScanRun | null;
}) {
  const titleId = useId();
  const percent = scanRun?.progress.percent;
  const hasProgress = typeof percent === "number";
  return (
    <Card
      className="border-border-subtle bg-surface-raised"
      data-coverage-context="bounded"
      role="region"
      aria-labelledby={titleId}
    >
      <CardHeader className="gap-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">
          <MessageSquareText aria-hidden="true" className="size-4 text-accent-brand" />
          Scan evidence
        </div>
        <h2 id={titleId} className="text-h5 font-semibold leading-none">
          Coverage
        </h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-5">
        {hasProgress ? (
          <div className="flex flex-col gap-3" aria-busy={ACTIVE_SCAN_STATUSES.has(scanRun?.status ?? "completed")}>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-caption font-semibold uppercase tracking-[0.14em] text-text-muted">Scan progress</p>
                <p className="mt-1 text-body-md font-semibold text-text-primary">
                  {scanRun?.progress.processedThreads ?? 0} of {scanRun?.progress.totalThreads || "?"} threads processed
                </p>
              </div>
              <span className="text-h4 font-semibold tabular-nums text-text-primary">{percent}%</span>
            </div>
            <Progress
              aria-label={`Scan progress: ${percent}%`}
              aria-valuetext={`${percent}% of bounded scan processed`}
              value={percent}
              className="h-3 bg-surface-sunken"
            />
            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={`Scan progress: ${percent}% — ${scanRun?.progress.processedThreads ?? 0} of ${scanRun?.progress.totalThreads || "?"} threads processed`}
            >
              Scan progress: {percent}% — {scanRun?.progress.processedThreads ?? 0} of {scanRun?.progress.totalThreads || "?"} threads processed.
            </p>
          </div>
        ) : null}

        {coverage ? (
          <>
            <div className="grid gap-3 text-body-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-text-muted">Pages</p>
                <p className="mt-1 font-semibold text-text-primary">{coverage.pages}</p>
              </div>
              <div>
                <p className="text-text-muted">Threads discovered</p>
                <p className="mt-1 font-semibold text-text-primary">{coverage.threadsDiscovered}</p>
              </div>
              <div>
                <p className="text-text-muted">Threads assessed</p>
                <p className="mt-1 font-semibold text-text-primary">{coverage.threadsAssessed}</p>
              </div>
              <div>
                <p className="text-text-muted">Failures / reused</p>
                <p className="mt-1 font-semibold text-text-primary">
                  {coverage.threadsFailed} / {coverage.threadsReused}
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface-sunken/60 px-3 py-3 text-body-sm text-text-secondary">
              <p>
                <span className="font-medium text-text-primary">Time covered: </span>
                {formatDate(coverage.oldestThreadAt ?? coverage.windowStart)} → {formatDate(coverage.newestThreadAt ?? coverage.windowEnd)}
              </p>
              <p className="mt-1 text-caption text-text-muted">
                Bounded window: {formatDate(coverage.windowStart)} → {formatDate(coverage.windowEnd)} · seven most recent days
              </p>
            </div>
            <p className="text-body-sm text-text-secondary">
              {coverage.completeWithinBounds
                ? "Complete within the seven-day window and configured thread bound."
                : coverage.boundPreventedCompleteCoverage
                  ? `${coverage.bound === "thread_limit" ? "The thread limit" : "The seven-day window"} prevented a complete result.`
                  : "Coverage is incomplete or still being gathered within the configured bounds."}
            </p>
          </>
        ) : (
          <p className="text-body-sm leading-6 text-text-secondary">
            Coverage is not available for this view. The associated Scan Run remains the source of truth for pages, threads, and time covered.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StagedActionButton({
  action,
  subjectId,
  onAction,
  disabled = false,
}: {
  action: HubAction;
  subjectId?: string;
  onAction: (action: HubAction, subjectId?: string) => void;
  disabled?: boolean;
}) {
  const labels: Partial<Record<HubAction, string>> = {
    upgrade: "Upgrade to Pro",
    connect: "Connect a YouTube Channel",
    continue_onboarding: "Continue setup",
    start_scan: "Start a deliberate Scan Run",
    cancel_scan: "Cancel Scan Run",
    open_review: "Open Review Queue",
    disconnect: "Disconnect Channel",
    delete_data: "Delete Channel data",
    export_data: "Export Channel data",
  };
  const icons: Partial<Record<HubAction, React.ReactNode>> = {
    upgrade: <ArrowRightIcon />,
    connect: <ArrowRightIcon />,
    continue_onboarding: <ArrowRightIcon />,
    start_scan: <ScanSearch aria-hidden="true" />,
    cancel_scan: <XCircle aria-hidden="true" />,
    open_review: <FileCheck2 aria-hidden="true" />,
    disconnect: <XCircle aria-hidden="true" />,
    delete_data: <Trash2 aria-hidden="true" />,
    export_data: <FileCheck2 aria-hidden="true" />,
  };
  const label = labels[action] ?? action;
  return (
    <Button
      type="button"
      variant={action === "delete_data" || action === "disconnect" ? "outline" : "default"}
      className={
        action === "delete_data"
          ? "border-accent-danger/40 text-accent-danger hover:bg-accent-danger/10"
          : action === "disconnect"
            ? "border-border-default"
            : "bg-accent-brand text-white hover:bg-accent-brand/90"
      }
      data-hub-action={action}
      disabled={disabled}
      onClick={() => onAction(action, subjectId)}
    >
      {icons[action]}
      {label}
    </Button>
  );
}

function ArrowRightIcon() {
  return <span aria-hidden="true">→</span>;
}

function SensitiveEvidence({
  item,
  revealSensitiveEvidence,
}: {
  item: HubReviewItem;
  revealSensitiveEvidence?: (itemId: string) => string | Promise<string>;
}) {
  const warningId = useId();
  const evidenceId = useId();
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const wasRevealed = useRef(false);
  const [revealedText, setRevealedText] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRevealed = revealedText !== null;

  useEffect(() => {
    if (isRevealed) {
      wasRevealed.current = true;
      evidenceRef.current?.focus();
    } else if (wasRevealed.current) {
      wasRevealed.current = false;
      revealButtonRef.current?.focus();
    }
  }, [isRevealed]);

  async function handleReveal() {
    if (!revealSensitiveEvidence || isRevealing) return;
    setIsRevealing(true);
    setError(null);
    try {
      const text = await revealSensitiveEvidence(item.id);
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("Sensitive evidence is unavailable");
      }
      setRevealedText(text);
    } catch {
      setError("Sensitive evidence could not be revealed. It remains masked.");
    } finally {
      setIsRevealing(false);
    }
  }

  function handleMask() {
    setRevealedText(null);
    setError(null);
  }

  return (
    <section aria-labelledby={`${evidenceId}-heading`} className="border-t border-border-subtle pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${evidenceId}-heading`} className="text-body-sm font-semibold text-text-primary">
          Safety evidence
        </h3>
        <span className="text-caption font-medium uppercase tracking-[0.14em] text-text-muted">Masked by default</span>
      </div>
      <div
        ref={evidenceRef}
        id={evidenceId}
        aria-label={isRevealed ? "Sensitive evidence is revealed" : "Sensitive evidence is masked"}
        aria-live={isRevealed ? "polite" : undefined}
        className="mt-3 rounded-lg border border-border-default bg-surface-sunken p-4 text-body-sm leading-6 text-text-secondary"
        data-sensitive-evidence={isRevealed ? "revealed" : "masked"}
        tabIndex={isRevealed ? -1 : undefined}
      >
        {isRevealed ? revealedText : item.sensitiveEvidence?.maskedText}
      </div>
      {revealSensitiveEvidence ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p id={warningId} className="max-w-prose text-body-xs leading-5 text-text-muted">
            This may reveal personal information. Reveal it only when necessary for a safety action.
          </p>
          {isRevealed ? (
            <Button
              ref={revealButtonRef}
              type="button"
              variant="outline"
              size="sm"
              aria-controls={evidenceId}
              aria-describedby={warningId}
              aria-expanded="true"
              onClick={handleMask}
            >
              <EyeOff aria-hidden="true" />
              Mask sensitive evidence
            </Button>
          ) : (
            <Button
              ref={revealButtonRef}
              type="button"
              variant="outline"
              size="sm"
              aria-controls={evidenceId}
              aria-describedby={warningId}
              aria-expanded="false"
              disabled={isRevealing}
              onClick={() => void handleReveal()}
            >
              <Eye aria-hidden="true" />
              {isRevealing ? "Revealing…" : "Show sensitive evidence"}
            </Button>
          )}
          {error ? (
            <p className="text-body-xs text-accent-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-body-xs text-text-muted">Evidence remains masked on this surface.</p>
      )}
    </section>
  );
}

function reviewActionAllowedInState(action: HubReviewAction, readOnly: boolean): boolean {
  return !readOnly || READ_ONLY_ALLOWED_ACTIONS.has(action.action);
}

function ReviewDetail({
  item,
  readOnly,
  onAction,
  onDraftChange,
  revealSensitiveEvidence,
}: {
  item: HubReviewItem;
  readOnly: boolean;
  onAction: (action: HubAction, subjectId?: string) => void;
  onDraftChange?: (itemId: string, text: string) => void;
  revealSensitiveEvidence?: (itemId: string) => string | Promise<string>;
}) {
  const titleId = useId();
  const contextId = useId();
  const isSafetyFlag = isSafetyFlagItem(item);
  const actions = getReviewActions(item).filter((action) =>
    reviewActionAllowedInState(action, readOnly),
  );

  return (
    <Card
      className="border-border-strong bg-surface-raised shadow-md"
      data-review-item-id={item.id}
      role="region"
      aria-labelledby={titleId}
    >
      <CardHeader className="gap-4 border-b border-border-subtle">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">Selected interaction</p>
            <p className="mt-2 text-body-sm font-medium text-text-secondary">Video</p>
            <h2 id={titleId} className="mt-2 text-h4 font-semibold leading-none">
              {item.video.title}
            </h2>
            <p className="mt-1 break-all font-mono text-caption text-text-muted">Video ID: {item.video.id}</p>
          </div>
          <ReviewStatusPill status={item.status} />
        </div>
        <p className="max-w-prose text-body-sm leading-6 text-text-secondary">
          {getReviewStatusDescription(item.status)}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-6">
        <section aria-labelledby={contextId}>
          <h3 id={contextId} className="text-body-sm font-semibold text-text-primary">Interaction context</h3>
          <div className="mt-3 grid gap-4">
            <div className="rounded-lg border border-border-subtle bg-surface-sunken/60 p-4">
              <p className="text-caption font-semibold uppercase tracking-[0.14em] text-text-muted">Comment being reviewed</p>
              <blockquote className="mt-2 text-body-md leading-7 text-text-primary">{item.interactionText}</blockquote>
            </div>
            {item.topLevelCommentText && item.topLevelCommentText !== item.interactionText ? (
              <div className="rounded-lg border border-border-subtle p-4">
                <p className="text-caption font-semibold uppercase tracking-[0.14em] text-text-muted">Top-level comment</p>
                <p className="mt-2 text-body-sm leading-6 text-text-secondary">{item.topLevelCommentText}</p>
              </div>
            ) : null}
            {item.neighboringReplies.length > 0 ? (
              <div>
                <p className="text-caption font-semibold uppercase tracking-[0.14em] text-text-muted">Same-thread context</p>
                <ul className="mt-2 flex flex-col gap-2 pl-5 text-body-sm leading-6 text-text-secondary">
                  {item.neighboringReplies.map((reply, index) => <li key={`${item.id}-reply-${index}`}>{reply}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border-subtle bg-surface-sunken/40 p-4 text-body-sm sm:grid-cols-2" aria-label="Assessment context">
          <div>
            <p className="text-text-muted">Interaction Assessment</p>
            <p className="mt-1 font-medium text-text-primary">{item.classification}</p>
          </div>
          <div>
            <p className="text-text-muted">Assessed</p>
            <p className="mt-1 font-medium text-text-primary">{formatDateTime(item.assessedAt)} UTC</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-text-muted">Target context</p>
            <p className="mt-1 font-medium text-text-primary">
              {item.target === "channel_steward" ? "Channel Steward" : item.target === "other_participant" ? "Other participant" : "Ambiguous target"}
            </p>
          </div>
        </section>

        <section className="grid gap-4 rounded-lg border border-border-subtle p-4 text-body-sm sm:grid-cols-2" aria-label="Review publishing identity">
          <div>
            <p className="text-text-muted">Publishing identity</p>
            <p className="mt-1 break-words font-medium text-text-primary">
              {item.publishingIdentity.displayName} ({item.publishingIdentity.providerChannelId})
            </p>
          </div>
          <div>
            <p className="text-text-muted">Authorization context</p>
            <p className="mt-1 leading-6 text-text-secondary">{authorizationCopy(item.publishingIdentity, readOnly)}</p>
          </div>
        </section>

        {item.status === "failed" && item.failure ? (
          <AlertBanner tone="warning" title="Publication failed">
            {item.failure.message} {item.failure.retryable ? "The provider explicitly rejected the reply, so retry is available." : "Retry is disabled until the provider gives an explicit retryable outcome."}
          </AlertBanner>
        ) : null}
        {item.status === "publication_uncertain" ? (
          <AlertBanner tone="warning" title="Publication Uncertain">
            YouTube may have accepted this reply while local completion is unknown. Check publication status before any retry; a second reply is not offered from this state.
          </AlertBanner>
        ) : null}
        {item.status === "published" && item.publication?.replyId ? (
          <div className="rounded-lg border border-accent-success/40 bg-accent-success/10 p-4 text-body-sm text-text-secondary" aria-label="Published reply record">
            <p className="font-semibold text-text-primary">Published reply record</p>
            <p className="mt-1 break-all font-mono text-caption">Provider reply ID: {item.publication.replyId}</p>
            {item.publication.publishedAt ? <p className="mt-1 text-caption">Published: {formatDateTime(item.publication.publishedAt)} UTC</p> : null}
          </div>
        ) : null}

        {isSafetyFlag && item.sensitiveEvidence ? (
          <SensitiveEvidence item={item} revealSensitiveEvidence={revealSensitiveEvidence} />
        ) : null}

        {!isSafetyFlag && item.status === "draft_ready" && item.draft ? (
          <section aria-labelledby={`${titleId}-draft`} className="border-t border-border-subtle pt-5">
            <p id={`${titleId}-draft`} className="text-body-sm font-semibold text-text-primary">
              {readOnly ? "Reply Draft (read-only)" : "Reply Draft"}
            </p>
            <p id={`${titleId}-draft-help`} className="mt-1 text-body-xs leading-5 text-text-muted">
              {readOnly
                ? "Existing draft data can be inspected during the grace period but cannot be edited or published."
                : "Private assistance only. Edit the exact final text before any separate publishing authorization is used."}
            </p>
            {readOnly ? (
              <div
                aria-describedby={`${titleId}-draft-help`}
                aria-label="Reply Draft"
                className="mt-3 rounded-lg border border-border-default bg-surface-sunken p-4 text-body-sm leading-6 text-text-secondary"
                data-draft-read-only="true"
              >
                {item.draft.text}
              </div>
            ) : (
              <Textarea
                key={`${item.id}-${item.status}-${item.draft.updatedAt ?? item.draft.text}`}
                aria-describedby={`${titleId}-draft-help`}
                aria-label="Reply Draft"
                className="mt-3 min-h-28 bg-surface-base"
                defaultValue={item.draft.text}
                onChange={(event) => onDraftChange?.(item.id, event.target.value)}
              />
            )}
          </section>
        ) : null}

        <section className="border-t border-border-subtle pt-5" aria-labelledby={`${titleId}-actions`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id={`${titleId}-actions`} className="text-body-sm font-semibold text-text-primary">Review decision</h3>
            {isSafetyFlag ? <Badge variant="destructive">Reply blocked</Badge> : null}
          </div>
          {isSafetyFlag ? (
            <p className="mt-2 text-body-sm leading-6 text-text-secondary">
              Safety Flags never produce a Reply Draft or a publishing action. Use the safety guidance or open the interaction on YouTube.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {actions.map((action) =>
              action.action === "open_on_youtube" && action.href ? (
                <a
                  key={action.action}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-border-default px-4 py-2 text-body-sm font-medium text-text-primary underline-offset-4 hover:bg-state-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
                >
                  {action.label}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <Button
                  key={action.action}
                  type="button"
                  variant={action.action === "publish" ? "default" : "outline"}
                  className={action.action === "publish" ? "bg-accent-brand text-white hover:bg-accent-brand/90" : undefined}
                  data-hub-action={action.action}
                  onClick={() => onAction(action.action, item.id)}
                >
                  {action.action === "publish" ? <CheckCircle2 aria-hidden="true" /> : null}
                  {action.action === "continue_safety_guidance" ? <ShieldAlert aria-hidden="true" /> : null}
                  {action.action === "delete_published_reply" ? <Trash2 aria-hidden="true" /> : null}
                  {action.label}
                </Button>
              ),
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function ReviewWorkspace({
  state,
  onAction,
  onDraftChange,
  revealSensitiveEvidence,
}: {
  state: ReviewState;
  onAction: (action: HubAction, subjectId?: string) => void;
  onDraftChange?: (itemId: string, text: string) => void;
  revealSensitiveEvidence?: (itemId: string) => string | Promise<string>;
}) {
  const [localSelectedItemId, setLocalSelectedItemId] = useState<string | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState<string | null>(null);
  const queueTitleId = useId();
  const externalSelectedItemId = "selectedItemId" in state ? state.selectedItemId : null;
  const selectedItemId = localSelectedItemId ?? externalSelectedItemId;
  const orderedQueue = [...state.queue].sort(
    (left, right) =>
      reviewQueuePriority(left) - reviewQueuePriority(right) ||
      right.assessedAt.localeCompare(left.assessedAt) ||
      left.id.localeCompare(right.id),
  );
  const detail = orderedQueue.find((item) => item.id === selectedItemId) ?? orderedQueue[0] ?? null;
  const readOnly = state.kind === "grace_period";

  return (
    <div className="flex flex-col gap-6">
      {readOnly ? (
        <AlertBanner tone="warning" title="Read-only grace period">
          New scans, drafts, and publications are unavailable. Existing Channel data remains available for inspection, export, deletion, and disconnect until {formatDateTime(state.expiresAt)} UTC.
        </AlertBanner>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)] lg:items-start">
        <Card className="border-border-subtle bg-surface-raised" data-review-queue="true">
          <CardHeader className="gap-3 border-b border-border-subtle">
            <div className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.16em] text-text-muted">
              <FileCheck2 aria-hidden="true" className="size-4 text-accent-brand" />
              Steward work list
            </div>
            <h2 id={queueTitleId} className="text-h5 font-semibold leading-none">Review Queue</h2>
            <p className="text-body-sm leading-6 text-text-secondary">
              Safety Flags come first, followed by Actionable Abuse and Reviewable Interactions. Each item is scoped to its connected identity.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {orderedQueue.length > 0 ? (
              <ul aria-labelledby={queueTitleId} className="divide-y divide-border-subtle">
                {orderedQueue.map((item) => {
                  const selected = detail?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={selected ? "true" : undefined}
                        aria-pressed={selected}
                        className={`flex w-full min-w-0 flex-col gap-2 px-5 py-4 text-left transition-colors motion-reduce:transition-none hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-state-focus ${selected ? "bg-state-hover" : ""}`}
                        data-review-item={item.id}
                        onClick={() => {
                          setLocalSelectedItemId(item.id);
                          setSelectionAnnouncement(`Showing ${item.video.title}, ${getReviewStatusLabel(item.status)}.`);
                        }}
                      >
                        <span className="flex min-w-0 items-start justify-between gap-3">
                          <span className="min-w-0 truncate text-body-sm font-semibold text-text-primary">{item.video.title}</span>
                          <ReviewStatusPill status={item.status} />
                        </span>
                        <span className="line-clamp-2 text-body-sm leading-5 text-text-secondary">{item.interactionText}</span>
                        <span className="break-all font-mono text-caption text-text-muted">{item.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-body-sm leading-6 text-text-secondary">No interactions are waiting for review.</p>
            )}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {selectionAnnouncement ? (
            <div
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-label={selectionAnnouncement}
            >
              {selectionAnnouncement}
            </div>
          ) : null}
          {detail ? (
            <ReviewDetail
              item={detail}
              readOnly={readOnly}
              onAction={onAction}
              onDraftChange={onDraftChange}
              revealSensitiveEvidence={revealSensitiveEvidence}
            />
          ) : (
            <Card className="border-dashed border-border-default bg-surface-raised">
              <CardContent className="py-10 text-center text-body-sm text-text-secondary">Select a Review Queue item to inspect its context.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertBanner({
  tone,
  title,
  children,
}: {
  tone: "warning" | "info";
  title: string;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const messageId = useId();
  return (
    <div
      className={`rounded-xl border px-4 py-4 ${tone === "warning" ? "border-accent-warning/50 bg-accent-warning/10" : "border-accent-brand/30 bg-accent-brand/10"}`}
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-warning" />
        <div>
          <p id={titleId} className="font-semibold text-text-primary">{title}</p>
          <p id={messageId} className="mt-1 text-body-sm leading-6 text-text-secondary">{children}</p>
        </div>
      </div>
    </div>
  );
}

function DisconnectedPanel({
  state,
  onAction,
}: {
  state: Extract<ChannelHubState, { kind: "disconnected" }>;
  onAction: (action: HubAction, subjectId?: string) => void;
}) {
  const capabilities = getHubCapabilities(state);
  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="gap-3">
        <h2 className="text-h4 font-semibold leading-none">{state.phase === "after_disconnect" ? "Channel disconnected" : "Connect your Channel"}</h2>
        <p className="max-w-prose text-body-sm leading-6 text-text-secondary">
          {state.phase === "after_disconnect"
            ? "New Channel work is unavailable until a verified YouTube identity is connected again. Any remaining provider replies must be managed on YouTube after authorization is revoked."
            : "Channel Hub is account-owned and separate from Projects, Summary, and History. Connect one verified public creator identity before reviewing its interactions."}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 rounded-lg border border-border-subtle bg-surface-sunken/50 p-4 text-body-sm sm:grid-cols-3">
          <div><p className="text-text-muted">Channel</p><p className="mt-1 font-medium text-text-primary">Not connected</p></div>
          <div><p className="text-text-muted">Coverage</p><p className="mt-1 font-medium text-text-primary">No Scan Run</p></div>
          <div><p className="text-text-muted">Publishing identity</p><p className="mt-1 font-medium text-text-primary">Not available</p></div>
        </div>
        {capabilities.canConnect ? <StagedActionButton action="connect" onAction={onAction} /> : <p className="text-body-sm text-text-muted">Connection is unavailable until account and subscription state are verified.</p>}
      </CardContent>
    </Card>
  );
}

function FreeDiscoveryPanel({
  state,
  onAction,
}: {
  state: Extract<ChannelHubState, { kind: "free_discovery" }>;
  onAction: (action: HubAction, subjectId?: string) => void;
}) {
  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="gap-3">
        <h2 className="text-h4 font-semibold leading-none">Discover Channel assistance</h2>
        <p className="max-w-prose text-body-sm leading-6 text-text-secondary">Free access can learn what Channel Hub does. Pro is required before OAuth, scanning, review, drafting, or publishing.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ul className="grid gap-3 text-body-sm text-text-secondary sm:grid-cols-3">
          <li className="rounded-lg border border-border-subtle p-3"><span className="font-semibold text-text-primary">Review</span><br />One interaction at a time.</li>
          <li className="rounded-lg border border-border-subtle p-3"><span className="font-semibold text-text-primary">Control</span><br />No automatic replies.</li>
          <li className="rounded-lg border border-border-subtle p-3"><span className="font-semibold text-text-primary">Safety</span><br />Flags never draft.</li>
        </ul>
        <a href={state.upgradeHref} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-md bg-accent-brand px-4 py-2 text-body-sm font-medium text-white hover:bg-accent-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus" onClick={() => onAction("upgrade")}>Upgrade to Pro <ArrowRightIcon /></a>
      </CardContent>
    </Card>
  );
}

function OnboardingPanel({
  state,
  onAction,
}: {
  state: Extract<ChannelHubState, { kind: "pro_onboarding" }>;
  onAction: (action: HubAction, subjectId?: string) => void;
}) {
  const steps = [
    ["attest_age", "Attest that you are 18+"],
    ["authorize_read", "Grant read-only identity access"],
    ["select_channel", "Select the verified Channel"],
    ["ready_to_scan", "Start the first deliberate scan"],
  ] as const;
  const activeIndex = steps.findIndex(([id]) => id === state.step);
  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="gap-3">
        <h2 className="text-h4 font-semibold leading-none">Set up Channel Hub</h2>
        <p className="max-w-prose text-body-sm leading-6 text-text-secondary">Pro onboarding is resumable. No partial connection is created if the read-only authorization is interrupted.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ol aria-label="Channel onboarding steps" className="grid gap-3 sm:grid-cols-2">
          {steps.map(([id, label], index) => {
            const current = index === activeIndex;
            const complete = index < activeIndex;
            return (
              <li key={id} className={`flex items-start gap-3 rounded-lg border p-3 ${current ? "border-accent-brand/50 bg-accent-brand/10" : "border-border-subtle"}`} aria-current={current ? "step" : undefined}>
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-default text-caption font-semibold text-text-secondary">{complete ? "✓" : index + 1}</span>
                <span className="text-body-sm font-medium text-text-primary">{label}</span>
              </li>
            );
          })}
        </ol>
        <div className="rounded-lg border border-border-subtle bg-surface-sunken/50 p-4 text-body-sm leading-6 text-text-secondary">
          <p className="font-semibold text-text-primary">Current step: {steps[Math.max(activeIndex, 0)]?.[1]}</p>
          <p className="mt-1">Only read-only access is requested during onboarding. Publishing Authorization stays separate until the first deliberate write action.</p>
        </div>
        <StagedActionButton action="continue_onboarding" onAction={onAction} disabled={!state.canContinue} />
      </CardContent>
    </Card>
  );
}

function ConnectedPanel({
  state,
  onAction,
}: {
  state: Extract<ChannelHubState, { kind: "connected" }>;
  onAction: (action: HubAction, subjectId?: string) => void;
}) {
  const capabilities = getHubCapabilities(state);
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
        <CoverageSummary coverage={state.scanRun?.coverage} scanRun={state.scanRun} />
        <Card className="border-border-subtle bg-surface-raised">
          <CardHeader className="gap-3"><h2 className="text-h5 font-semibold leading-none">Next deliberate action</h2><p className="text-body-sm leading-6 text-text-secondary">A connected Channel never scans in the background and never publishes from a Scan Run.</p></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <StagedActionButton action="start_scan" onAction={onAction} disabled={!capabilities.canStartScan} />
            {state.queue.length > 0 ? <StagedActionButton action="open_review" onAction={onAction} /> : <p className="text-body-sm text-text-muted">The Review Queue is empty until a deliberate Scan Run creates review items.</p>}
          </CardContent>
        </Card>
      </div>
      {state.scanRun ? <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-sunken/50 px-4 py-3 text-body-sm"><span className="min-w-0 truncate text-text-secondary">Latest Scan Run: <span className="font-mono text-text-primary">{state.scanRun.id}</span></span><ScanStatusPill run={state.scanRun} /></div> : null}
    </div>
  );
}

function ScanningPanel({
  state,
  onAction,
}: {
  state: Extract<ChannelHubState, { kind: "scanning" }>;
  onAction: (action: HubAction, subjectId?: string) => void;
}) {
  const run = state.scanRun;
  const isActive = ACTIVE_SCAN_STATUSES.has(run.status);
  return (
    <div className="flex flex-col gap-6">
      <AlertBanner tone="info" title="Scan Run in progress">
        This deliberate Scan Run is bounded to the seven most recent days and its configured thread limit. Leave this surface safely; the durable run remains the source of truth.
      </AlertBanner>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.7fr)]">
        <CoverageSummary coverage={run.coverage} scanRun={run} />
        <Card className="border-border-subtle bg-surface-raised">
          <CardHeader className="gap-3"><div className="flex items-start justify-between gap-3"><h2 className="text-h5 font-semibold leading-none">Scan Run status</h2><ScanStatusPill run={run} /></div><p className="break-all font-mono text-caption text-text-muted">{run.id}</p></CardHeader>
          <CardContent className="flex flex-col gap-4"><p className="text-body-sm leading-6 text-text-secondary">{scanStatusDescription(run)}</p>{isActive ? <StagedActionButton action="cancel_scan" subjectId={run.id} onAction={onAction} /> : null}</CardContent>
        </Card>
      </div>
      {state.queue.length > 0 ? <Card className="border-border-subtle bg-surface-raised"><CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6"><p className="text-body-sm text-text-secondary">{state.queue.length} previously completed review item{state.queue.length === 1 ? "" : "s"} remain available.</p><StagedActionButton action="open_review" onAction={onAction} /></CardContent></Card> : null}
    </div>
  );
}

function LifecyclePanel({
  state,
  onAction,
}: {
  state: Extract<ChannelHubState, { kind: "deletion" }>;
  onAction: (action: HubAction, subjectId?: string) => void;
}) {
  const labels = { pending: "Deletion pending", in_progress: "Deletion in progress", failed: "Deletion failed", completed: "Deletion complete" } as const;
  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="gap-3"><h2 className="text-h4 font-semibold leading-none">{labels[state.phase]}</h2><p className="text-body-sm leading-6 text-text-secondary">{state.phase === "failed" ? state.failureMessage ?? "Deletion needs attention before local data can be removed." : "Channel data deletion is durable compliance work. The interface does not report completion before the local outcome is known."}</p></CardHeader>
      <CardContent className="flex flex-col gap-4"><div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface-sunken/50 px-4 py-3 text-body-sm"><span className="text-text-muted">Requested</span><span className="font-medium text-text-primary">{formatDateTime(state.requestedAt)} UTC</span></div>{state.phase === "failed" ? <StagedActionButton action="delete_data" onAction={onAction} /> : null}</CardContent>
    </Card>
  );
}

function DeletedPanel({ deletedAt }: { deletedAt: string }) {
  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="gap-3"><h2 className="text-h4 font-semibold leading-none">Channel data deleted</h2><p className="text-body-sm leading-6 text-text-secondary">Channel identity, retained review text, and local Channel data are no longer available. Any public replies require separate management on YouTube.</p></CardHeader>
      <CardContent><p className="text-caption text-text-muted">Completed: {formatDateTime(deletedAt)} UTC</p></CardContent>
    </Card>
  );
}

export function ChannelHubExperience({
  state,
  mode = "preview",
  onAction,
  revealSensitiveEvidence,
  onDraftChange,
  className,
}: ChannelHubExperienceProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const dispatch = (action: HubAction, subjectId?: string) => {
    const label = action === "publish" ? "Publish reviewed reply" : action.replaceAll("_", " ");
    setAnnouncement(
      mode === "release"
        ? `${label} selected${subjectId ? ` for ${subjectId}` : ""}. The server will revalidate Channel authority before every action.`
        : `${label} selected${subjectId ? ` for ${subjectId}` : ""}. This inert surface does not perform the external action.`,
    );
    onAction?.(action, subjectId);
  };
  const screenDescription = getScreenStateDescription(state);

  return (
    <main
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={`mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:py-12 ${className ?? ""}`}
      data-hub-state={state.kind}
      data-layout="responsive-390"
      data-motion-policy="reduced-motion-safe"
    >
      <header className="relative overflow-hidden rounded-[1.75rem] border border-border-strong bg-surface-sunken px-5 py-7 shadow-xl sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-accent-brand-secondary/10 blur-3xl" />
        <div className="relative flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-caption font-semibold uppercase tracking-[0.2em] text-accent-brand-secondary"><ScanSearch aria-hidden="true" className="size-4" /> {mode === "release" ? "Channel / production release" : "Channel / inert release surface"}</div>
            <div className="mt-4 flex flex-wrap items-center gap-3"><h1 id={titleId} className="text-4xl font-semibold tracking-[-0.04em] text-text-primary sm:text-5xl">Channel Hub</h1><Badge variant="outline" data-screen-state={state.kind}>{getScreenStateLabel(state.kind)}</Badge></div>
            <p id={descriptionId} className="mt-4 max-w-3xl text-body-md leading-7 text-text-secondary">{screenDescription}</p>
          </div>
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border-strong bg-surface-base/30 px-4 py-3 text-body-sm text-text-secondary"><span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent-success" /><span>{mode === "release" ? "Release-gated Hub · account-owned" : "Release-safe preview · no production route"}</span></div>
        </div>
      </header>

      {announcement ? (
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={announcement}
        >
          {announcement}
        </div>
      ) : null}

      {state.kind === "disconnected" ? <DisconnectedPanel state={state} onAction={dispatch} /> : null}
      {state.kind === "free_discovery" ? <FreeDiscoveryPanel state={state} onAction={dispatch} /> : null}
      {state.kind === "pro_onboarding" ? <OnboardingPanel state={state} onAction={dispatch} /> : null}
      {state.kind === "connected" ? <><ChannelIdentityPanel channel={state.channel} /><ConnectedPanel state={state} onAction={dispatch} /></> : null}
      {state.kind === "scanning" ? <><ChannelIdentityPanel channel={state.channel} /><ScanningPanel state={state} onAction={dispatch} /></> : null}
      {state.kind === "review" ? <><ChannelIdentityPanel channel={state.channel} /><CoverageSummary coverage={state.coverage} scanRun={state.scanRun} /><ReviewWorkspace state={state} onAction={dispatch} onDraftChange={onDraftChange} revealSensitiveEvidence={revealSensitiveEvidence} /></> : null}
      {state.kind === "grace_period" ? <><ChannelIdentityPanel channel={state.channel} readOnly /><CoverageSummary coverage={state.coverage} /><ReviewWorkspace state={state} onAction={dispatch} onDraftChange={onDraftChange} revealSensitiveEvidence={revealSensitiveEvidence} /><div className="flex flex-wrap gap-3"><StagedActionButton action="export_data" onAction={dispatch} /><StagedActionButton action="disconnect" onAction={dispatch} /><StagedActionButton action="delete_data" onAction={dispatch} /></div></> : null}
      {state.kind === "deletion" ? <LifecyclePanel state={state} onAction={dispatch} /> : null}
      {state.kind === "deleted" ? <DeletedPanel deletedAt={state.deletedAt} /> : null}

      <footer className="border-t border-border-subtle pt-5 text-center text-caption leading-5 text-text-muted">{mode === "release" ? "Channel Hub is account-owned and separate from Workspace, Summary, and History. Actions are revalidated server-side before any external operation." : "Channel Hub remains disconnected from production navigation, Summary links, History links, OAuth, and real YouTube actions until the uniform-release issue."}</footer>
    </main>
  );
}
