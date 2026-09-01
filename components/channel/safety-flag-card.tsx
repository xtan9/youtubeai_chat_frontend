"use client";

import { ExternalLink, Eye, EyeOff, ShieldAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  SAFETY_EVIDENCE_REVEAL_WARNING,
  type SafetyEvidenceRevealConfirmation,
  type SafetyEvidenceRevealPurpose,
  type SafetyFlagReason,
} from "@/lib/channel-safety-contract";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";

export type SafetyFlagAction = Readonly<{
  id: string;
  label: string;
  href?: string;
}>;

const DEFAULT_YOUTUBE_ACTIONS: readonly SafetyFlagAction[] = [
  {
    id: "report-on-youtube",
    label: "Report on YouTube",
    href: "https://support.google.com/youtube/answer/2802027",
  },
  {
    id: "open-youtube-studio",
    label: "Open YouTube Studio",
    href: "https://studio.youtube.com/",
  },
];

const DEFAULT_REAL_WORLD_ACTIONS: readonly SafetyFlagAction[] = [
  {
    id: "local-emergency-services",
    label: "Contact local emergency services if someone may be in immediate danger.",
  },
  {
    id: "trusted-crisis-service",
    label: "Contact local law enforcement or a trusted crisis service for the person's location.",
  },
];

const REASON_LABELS: Record<SafetyFlagReason, string> = {
  threat: "Threat or physical harm",
  self_harm_encouragement: "Self-harm encouragement",
  doxxing: "Private information exposure",
  stalking: "Stalking or unwanted pursuit",
  extortion: "Extortion or coercion",
  sexual_harassment: "Sexual harassment",
  protected_class_hate: "Protected-class hate or dehumanization",
  minor_risk: "Minor safety risk",
  credible_real_world_danger: "Credible real-world danger",
  severe_harm_uncertain: "Potential severe harm needs human review",
};

export type SafetyFlagCardProps = Readonly<{
  flagId: string;
  reasonCodes: readonly SafetyFlagReason[];
  maskedEvidence: string;
  revealEvidence?: (
    confirmation: SafetyEvidenceRevealConfirmation,
  ) => string | Promise<string>;
  revealPurpose?: SafetyEvidenceRevealPurpose;
  youtubeActions?: readonly SafetyFlagAction[];
  realWorldActions?: readonly SafetyFlagAction[];
  className?: string;
}>;

function ActionList({
  actions,
  listLabel,
}: {
  actions: readonly SafetyFlagAction[];
  listLabel: string;
}) {
  return (
    <ul aria-label={listLabel} className="flex flex-col gap-2">
      {actions.map((action) => (
        <li key={action.id}>
          {action.href ? (
            <a
              className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-body-sm font-medium text-text-primary underline decoration-text-muted underline-offset-4 hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-state-focus"
              href={action.href}
              rel="noopener noreferrer"
              target="_blank"
            >
              {action.label}
              <ExternalLink aria-hidden="true" className="size-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <p className="text-body-sm leading-relaxed text-text-secondary">
              {action.label}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SafetyFlagCard({
  flagId,
  reasonCodes,
  maskedEvidence,
  revealEvidence,
  revealPurpose = "youtube_enforcement",
  youtubeActions = DEFAULT_YOUTUBE_ACTIONS,
  realWorldActions = DEFAULT_REAL_WORLD_ACTIONS,
  className,
}: SafetyFlagCardProps) {
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();
  const evidenceId = useId();
  const revealButtonRef = useRef<HTMLButtonElement>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);
  const wasRevealed = useRef(false);
  const [revealedEvidence, setRevealedEvidence] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const isRevealed = revealedEvidence !== null;

  useEffect(() => {
    if (isRevealed) {
      wasRevealed.current = true;
      evidenceRef.current?.focus();
    } else if (wasRevealed.current) {
      revealButtonRef.current?.focus();
    }
  }, [isRevealed]);

  async function handleReveal() {
    if (!revealEvidence || isRevealing) return;

    setIsRevealing(true);
    setRevealError(null);
    try {
      const value = await revealEvidence({
        warningAcknowledged: true,
        purpose: revealPurpose,
      });
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("Sensitive evidence could not be revealed");
      }
      setRevealedEvidence(value);
    } catch {
      setRevealError(
        "Sensitive evidence could not be revealed. It remains masked.",
      );
    } finally {
      setIsRevealing(false);
    }
  }

  function handleMask() {
    setRevealedEvidence(null);
    setRevealError(null);
  }

  return (
    <Card
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className={cn(
        "overflow-hidden border-accent-danger/40 shadow-sm",
        className,
      )}
      data-safety-flag-id={flagId}
      role="region"
    >
      <CardHeader className="gap-4 border-b border-accent-danger/20 bg-accent-danger/5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-accent-danger/35 bg-surface-raised text-accent-danger"
          >
            <ShieldAlert className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">Safety Flag</Badge>
              <span className="text-caption font-medium uppercase tracking-wider text-text-muted">
                Private review
              </span>
            </div>
            <h2
              className="mt-3 text-h4 font-semibold text-text-primary"
              id={titleId}
            >
              Safety Flag — reply blocked
            </h2>
            <p
              className="mt-2 max-w-prose text-body-sm leading-relaxed text-text-secondary"
              id={descriptionId}
            >
              This interaction may involve serious harm. Review the available
              safety paths. Reply Drafts are blocked: no draft can be
              requested, received, or published for this item.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-7 pt-6">
        <section aria-labelledby={`${titleId}-reasons`}>
          <h3
            className="text-body-sm font-semibold text-text-primary"
            id={`${titleId}-reasons`}
          >
            Why it is flagged
          </h3>
          <ul
            aria-label="Safety Flag reasons"
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            {reasonCodes.map((reason) => (
              <li
                className="flex items-start gap-2 text-body-sm text-text-secondary"
                key={reason}
              >
                <span
                  aria-hidden="true"
                  className="mt-2 size-1.5 shrink-0 rounded-full bg-accent-danger"
                />
                <span>{REASON_LABELS[reason] ?? "Serious safety concern"}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby={`${titleId}-evidence`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3
              className="text-body-sm font-semibold text-text-primary"
              id={`${titleId}-evidence`}
            >
              Evidence
            </h3>
            <span className="text-caption font-medium uppercase tracking-wider text-text-muted">
              Masked by default
            </span>
          </div>
          <div
            aria-live={isRevealed ? "polite" : undefined}
            className="mt-3 rounded-lg border border-border-default bg-surface-sunken p-4 text-body-sm leading-relaxed text-text-secondary"
            data-sensitive-evidence={isRevealed ? "revealed" : "masked"}
            id={evidenceId}
            aria-label={
              isRevealed
                ? "Sensitive evidence is revealed"
                : "Sensitive evidence is masked"
            }
            ref={evidenceRef}
            tabIndex={isRevealed ? -1 : undefined}
          >
            {isRevealed ? revealedEvidence : maskedEvidence}
          </div>
          {revealEvidence ? (
            <div className="mt-4 flex flex-col items-start gap-3">
              <p
                className="max-w-prose text-body-xs leading-relaxed text-text-muted"
                id={warningId}
              >
                {SAFETY_EVIDENCE_REVEAL_WARNING}
              </p>
              {isRevealed ? (
                <Button
                  ref={revealButtonRef}
                  aria-controls={evidenceId}
                  aria-describedby={warningId}
                  aria-expanded="true"
                  onClick={handleMask}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <EyeOff aria-hidden="true" />
                  Mask sensitive evidence
                </Button>
              ) : (
                <Button
                  ref={revealButtonRef}
                  aria-controls={evidenceId}
                  aria-describedby={warningId}
                  aria-expanded="false"
                  disabled={isRevealing}
                  onClick={handleReveal}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Eye aria-hidden="true" />
                  {isRevealing ? "Revealing…" : "Show sensitive evidence"}
                </Button>
              )}
              {revealError ? (
                <p className="text-body-xs text-accent-danger" role="alert">
                  {revealError}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-body-xs text-text-muted">
              Evidence remains masked on this surface.
            </p>
          )}
          {isRevealed ? (
            <div
              aria-live="polite"
              className="sr-only"
              tabIndex={-1}
            >
              Sensitive evidence revealed for {revealPurpose.replaceAll("_", " ")}.
            </div>
          ) : null}
        </section>

        <div className="grid gap-7 border-t border-border-subtle pt-6 md:grid-cols-2">
          <section aria-labelledby={`${titleId}-youtube-actions`}>
            <h3
              className="text-body-sm font-semibold text-text-primary"
              id={`${titleId}-youtube-actions`}
            >
              YouTube actions
            </h3>
            <p className="mt-2 text-body-xs leading-relaxed text-text-muted">
              Use YouTube&apos;s own reporting and channel controls for platform
              enforcement.
            </p>
            <div className="mt-3">
              <ActionList actions={youtubeActions} listLabel="YouTube safety actions" />
            </div>
          </section>

          <section aria-labelledby={`${titleId}-real-world-actions`}>
            <h3
              className="text-body-sm font-semibold text-text-primary"
              id={`${titleId}-real-world-actions`}
            >
              Real-world safety
            </h3>
            <p className="mt-2 text-body-xs leading-relaxed text-text-muted">
              YouTubeAI cannot contact authorities or assess imminent danger.
              Choose the local path that fits the situation.
            </p>
            <div className="mt-3">
              <ActionList
                actions={realWorldActions}
                listLabel="Real-world safety actions"
              />
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
