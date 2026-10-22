"use client";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChevronRight,
  ExternalLink,
  Library,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type Relationship,
  type EvidenceClaim,
  CLAIMS,
  EXCLUDED_INVENTORY,
} from "./evidence-prototype-data";

const RELATIONSHIP_STYLES: Record<Relationship, string> = {
  "Supported by retrieved evidence":
    "border-accent-success/35 bg-accent-success/10 text-accent-success",
  "Qualified by retrieved evidence":
    "border-accent-warning/35 bg-accent-warning/10 text-accent-warning",
  "Conflicts with retrieved evidence":
    "border-accent-danger/35 bg-accent-danger/10 text-accent-danger",
  Unresolved: "border-border-default bg-surface-sunken text-text-secondary",
};

function RelationshipBadge({ relationship }: { readonly relationship: Relationship }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold",
        RELATIONSHIP_STYLES[relationship],
      )}
    >
      {relationship}
    </span>
  );
}

function CoverageSummary({ compact = false }: { readonly compact?: boolean }) {
  return (
    <section
      aria-labelledby="coverage-title"
      className="rounded-2xl border border-border-subtle bg-surface-raised p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">
            Evidence Coverage
          </p>
          <h2 id="coverage-title" className="mt-1 text-lg font-semibold text-text-primary">
            10 of 12 material claims examined
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            All 6 central claims · 4 of 6 consequential claims
          </p>
        </div>
        <div className="rounded-xl border border-border-subtle bg-surface-base px-3 py-2 text-right">
          <p className="text-xs text-text-muted">Report dated</p>
          <p className="text-sm font-semibold text-text-primary">8 August 2026</p>
        </div>
      </div>
      {!compact ? (
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <CoverageCount label="Supported" value="3" />
          <CoverageCount label="Qualified" value="1" />
          <CoverageCount label="Conflicts" value="4" />
          <CoverageCount label="Unresolved" value="2" />
        </div>
      ) : null}
      <div className="mt-4 border-t border-border-subtle pt-3 text-sm text-text-secondary">
        <p className="mb-1 font-semibold text-text-primary">
          Report status · Partially completed
        </p>
        <p>
          <strong className="text-text-primary">2 consequential assertions excluded:</strong>{" "}
          all 10 eligible entries were selected and received complete Findings. The two governed exclusions retain exact anchors and reasons and are not counted as examined.
        </p>
        <p className="mt-1">Confidence: unavailable</p>
        <details className="mt-3 rounded-lg border border-border-subtle bg-surface-base">
          <summary className="cursor-pointer px-3 py-2 font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-state-focus">
            Full material inventory · 12 entries
          </summary>
          <ol
            aria-label="Full material inventory"
            className="space-y-2 border-t border-border-subtle px-3 py-3"
          >
            {CLAIMS.map((claim) => (
              <li key={claim.materialInventoryEntryId} className="text-xs leading-5 text-text-secondary">
                <strong className="text-text-primary">{claim.materialInventoryEntryId} · Claim Unit {claim.claimUnitId} · {claim.stratum} · {claim.timestamp}</strong>{" "}
                — Finding complete · {claim.statement}
              </li>
            ))}
            {EXCLUDED_INVENTORY.map((entry) => (
              <li key={entry.materialInventoryEntryId} className="text-xs leading-5 text-text-secondary">
                <strong className="text-text-primary">{entry.materialInventoryEntryId} · {entry.stratum} · {entry.timestamp}</strong>{" "}
                — {entry.reason} · {entry.statement}
              </li>
            ))}
          </ol>
        </details>
      </div>
    </section>
  );
}

function CoverageCount({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2">
      <span className="block text-lg font-semibold text-text-primary">{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  );
}

function ClaimButton({
  claim,
  selected,
  onSelect,
}: {
  readonly claim: EvidenceClaim;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group w-full rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-focus",
        selected
          ? "border-accent-brand bg-accent-brand/8"
          : "border-border-subtle bg-surface-base hover:bg-state-hover",
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-text-muted">
          {claim.materialInventoryEntryId}
        </span>
        <span className="text-xs text-text-muted">
          Claim Unit {claim.claimUnitId}
        </span>
        <ChevronRight className="size-4 text-text-muted group-aria-pressed:rotate-90" aria-hidden />
      </span>
      <span className="mt-1 block text-sm font-semibold text-text-primary">
        {claim.shortLabel}
      </span>
      <span className="mt-2 block text-right">
        <RelationshipBadge relationship={claim.relationship} />
        <span className="mt-1 block text-xs text-text-muted">
          as of 8 August 2026
        </span>
      </span>
    </button>
  );
}

function FindingDetail({ claim }: { readonly claim: EvidenceClaim }) {
  return (
    <article aria-labelledby={`${claim.claimUnitId}-title`} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            Material Inventory Entry {claim.materialInventoryEntryId}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            Claim Unit {claim.claimUnitId}
          </p>
          <h2 id={`${claim.claimUnitId}-title`} className="mt-1 text-xl font-semibold text-text-primary sm:text-2xl">
            {claim.statement}
          </h2>
        </div>
        <div className="text-right">
          <RelationshipBadge relationship={claim.relationship} />
          <p className="mt-1 text-xs text-text-muted">as of 8 August 2026</p>
        </div>
      </div>

      <section aria-labelledby={`${claim.claimUnitId}-transcript`} className="mt-5 rounded-xl bg-surface-sunken p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
          <BookOpenText className="size-4" aria-hidden />
          <h3 id={`${claim.claimUnitId}-transcript`}>Transcript context · {claim.timestamp}</h3>
        </div>
        <blockquote className="mt-2 border-l-2 border-accent-brand pl-3 text-sm leading-6 text-text-primary">
          “{claim.transcript}”
        </blockquote>
      </section>

      <section aria-labelledby={`${claim.claimUnitId}-why`} className="mt-5">
        <h3 id={`${claim.claimUnitId}-why`} className="text-sm font-semibold text-text-primary">Why this relationship</h3>
        <p className="mt-2 text-sm leading-6 text-text-secondary">{claim.rationale}</p>
        <dl className="mt-3 grid gap-3 rounded-xl border border-border-subtle bg-surface-sunken p-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-text-primary">Sufficiency decision</dt>
            <dd className="mt-1 text-text-secondary">{claim.sufficiency}</dd>
          </div>
          <div>
            <dt className="font-semibold text-text-primary">Source policy</dt>
            <dd className="mt-1 text-text-secondary">{claim.sourcePolicyVersion}</dd>
          </div>
          <div>
            <dt className="font-semibold text-text-primary">Time and jurisdiction</dt>
            <dd className="mt-1 text-text-secondary">{claim.scope}</dd>
          </div>
          <div>
            <dt className="font-semibold text-text-primary">Reproduction provenance</dt>
            <dd className="mt-1 text-text-secondary">{claim.provenance}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={`${claim.claimUnitId}-origins`} className="mt-5 space-y-3">
        <div>
          <h3 id={`${claim.claimUnitId}-origins`} className="text-sm font-semibold text-text-primary">
            All material evidence origins · {claim.origins.length}
          </h3>
          <p className="mt-1 text-sm text-text-secondary">Every supporting, qualifying, contrary, or unresolved material position used by this Finding is listed below.</p>
          <p className="mt-1 text-xs font-semibold text-text-muted">
            Evidence record for {claim.materialInventoryEntryId} · {claim.claimUnitId}
          </p>
        </div>
        {claim.origins.map((origin, index) => (
          <details key={origin.id} className="rounded-xl border border-border-subtle bg-surface-base" open={index === 0}>
            <summary className="cursor-pointer list-none px-4 py-3 focus-visible:outline-2 focus-visible:outline-state-focus">
              <span className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-primary">
                  <Library className="size-4 shrink-0 text-accent-brand" aria-hidden />
                  <span className="truncate">{origin.id} · {origin.publisher}</span>
                </span>
                <span className="text-xs text-text-muted">Inspect origin {index + 1}</span>
              </span>
            </summary>
            <div className="border-t border-border-subtle px-4 py-4">
              <p className="text-sm font-semibold text-text-primary">{origin.title}</p>
              <p className="mt-1 text-xs text-text-muted">{origin.publisher} · {origin.sourceClass} · {origin.language}</p>
              <p className="mt-1 text-xs text-text-muted">Stable source ID {origin.id} · {origin.published}</p>
              <blockquote className="mt-4 border-l-2 border-accent-brand-secondary bg-surface-sunken px-3 py-2 text-sm leading-6 text-text-primary">
                “{origin.passage}”
              </blockquote>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold text-text-primary">Material stance</dt><dd className="mt-1 text-text-secondary">{origin.stance}</dd></div>
                <div><dt className="font-semibold text-text-primary">Origin group</dt><dd className="mt-1 text-text-secondary">{origin.originGroup}</dd></div>
                <div><dt className="font-semibold text-text-primary">Authority</dt><dd className="mt-1 text-text-secondary">{origin.authority}</dd></div>
                <div><dt className="font-semibold text-text-primary">Independence limit</dt><dd className="mt-1 text-text-secondary">{origin.independence}</dd></div>
                <div><dt className="font-semibold text-text-primary">Rights and availability</dt><dd className="mt-1 text-text-secondary">{origin.rights}</dd></div>
                <div><dt className="font-semibold text-text-primary">Change state</dt><dd className="mt-1 text-text-secondary">{origin.change}</dd></div>
                <div><dt className="font-semibold text-text-primary">Snapshot provenance</dt><dd className="mt-1 break-all text-text-secondary">{origin.snapshot}</dd></div>
                <div><dt className="font-semibold text-text-primary">Finding limitation</dt><dd className="mt-1 text-text-secondary">{claim.limitation}</dd></div>
              </dl>
              <a
                href={`https://example.test/evidence-snapshot/${origin.id.toLowerCase()}`}
                onClick={(event) => event.preventDefault()}
                className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent-brand hover:underline focus-visible:outline-2 focus-visible:outline-state-focus"
              >
                Open captured source {origin.id} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </div>
          </details>
        ))}
      </section>
    </article>
  );
}

export function ClaimDesk({ selected, onSelect }: ReportLayoutProps) {
  return (
    <div data-evidence-layout="claim-desk" className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside aria-label="Report claims" className="min-w-0 space-y-3">
        <CoverageSummary compact />
        <nav aria-label="Material claims" className="space-y-2">
          {CLAIMS.map((claim) => (
            <ClaimButton key={claim.materialInventoryEntryId} claim={claim} selected={claim.materialInventoryEntryId === selected.materialInventoryEntryId} onSelect={() => onSelect(claim)} />
          ))}
        </nav>
      </aside>
      <div className="rounded-2xl border border-border-subtle bg-surface-raised p-4 sm:p-6">
        <FindingDetail claim={selected} />
      </div>
    </div>
  );
}

export function CoverageLedger({ selected, onSelect }: ReportLayoutProps) {
  return (
    <div data-evidence-layout="coverage-ledger" className="space-y-4">
      <CoverageSummary />
      <section aria-labelledby="ledger-title" className="overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised">
        <div className="border-b border-border-subtle px-4 py-3 sm:px-5">
          <h2 id="ledger-title" className="font-semibold text-text-primary">Claim ledger</h2>
          <p className="text-sm text-text-muted">Scan relationships first, then inspect the record.</p>
        </div>
        <div className="divide-y divide-border-subtle">
          {CLAIMS.map((claim) => (
            <button
              key={claim.materialInventoryEntryId}
              type="button"
              onClick={() => onSelect(claim)}
              aria-pressed={claim.materialInventoryEntryId === selected.materialInventoryEntryId}
              className="grid w-full gap-2 px-4 py-3 text-left hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-state-focus sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5"
            >
              <span className="text-xs font-semibold text-text-muted">{claim.materialInventoryEntryId} · Claim Unit {claim.claimUnitId}</span>
              <span className="text-sm font-medium text-text-primary">{claim.statement}</span>
              <RelationshipBadge relationship={claim.relationship} />
            </button>
          ))}
        </div>
      </section>
      <div className="rounded-2xl border border-border-subtle bg-surface-raised p-4 sm:p-6">
        <FindingDetail claim={selected} />
      </div>
    </div>
  );
}

export function GuidedDossier({ selected, onSelect }: ReportLayoutProps) {
  const currentIndex = CLAIMS.findIndex(
    (claim) =>
      claim.materialInventoryEntryId === selected.materialInventoryEntryId,
  );
  const move = (delta: number) => {
    const next = (currentIndex + delta + CLAIMS.length) % CLAIMS.length;
    onSelect(CLAIMS[next] ?? CLAIMS[0]);
  };

  return (
    <div data-evidence-layout="guided-dossier" className="mx-auto max-w-3xl space-y-4">
      <CoverageSummary compact />
      <section className="rounded-2xl border border-border-subtle bg-surface-raised p-4 sm:p-7">
        <div className="mb-5 flex items-center justify-between gap-3 border-b border-border-subtle pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Guided review</p>
            <p className="mt-1 text-sm text-text-secondary">Finding {currentIndex + 1} of {CLAIMS.length} shown</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={() => move(-1)} aria-label="Previous finding">
              <ArrowLeft aria-hidden />
            </Button>
            <Button variant="outline" size="icon" onClick={() => move(1)} aria-label="Next finding">
              <ArrowRight aria-hidden />
            </Button>
          </div>
        </div>
        <FindingDetail claim={selected} />
      </section>
      <nav aria-label="Jump to finding" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CLAIMS.map((claim, index) => (
          <button
            key={claim.materialInventoryEntryId}
            type="button"
            onClick={() => onSelect(claim)}
            aria-current={claim.materialInventoryEntryId === selected.materialInventoryEntryId ? "step" : undefined}
            className="rounded-xl border border-border-subtle bg-surface-base px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-state-focus aria-[current=step]:border-accent-brand"
          >
            <span className="block text-xs text-text-muted">{index + 1}</span>
            <span className="mt-1 block font-semibold text-text-primary">{claim.shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export interface ReportLayoutProps {
  readonly selected: EvidenceClaim;
  readonly onSelect: (claim: EvidenceClaim) => void;
}
