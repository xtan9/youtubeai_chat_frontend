"use client";

import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileClock,
  History,
  Library,
  MessageSquareText,
  SearchCheck,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const VARIANTS = ["claim-desk", "coverage-ledger", "guided-dossier"] as const;
export type EvidencePrototypeVariant = (typeof VARIANTS)[number];

const FIXTURES = [
  "request",
  "progress",
  "report",
  "recheck",
  "corrected",
  "not-eligible",
  "waiting",
  "failed",
  "expired",
  "suppressed",
  "withdrawn",
  "notices",
  "comprehension",
] as const;
export type EvidencePrototypeFixture = (typeof FIXTURES)[number];

type Relationship =
  | "Supported by retrieved evidence"
  | "Qualified by retrieved evidence"
  | "Conflicts with retrieved evidence"
  | "Unresolved";

type ClaimStratum = "Central" | "Consequential";

interface MaterialInventoryIdentity {
  readonly materialInventoryEntryId: string;
  readonly claimUnitId?: string;
}

interface EvidenceOrigin {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly published: string;
  readonly passage: string;
  readonly stance: string;
  readonly sourceClass: string;
  readonly language: string;
  readonly originGroup: string;
  readonly authority: string;
  readonly independence: string;
  readonly rights: string;
  readonly change: string;
  readonly snapshot: string;
}

interface EvidenceClaim extends MaterialInventoryIdentity {
  readonly claimUnitId: string;
  readonly shortLabel: string;
  readonly statement: string;
  readonly transcript: string;
  readonly timestamp: string;
  readonly stratum: ClaimStratum;
  readonly relationship: Relationship;
  readonly rationale: string;
  readonly scope: string;
  readonly limitation: string;
  readonly sufficiency: string;
  readonly sourcePolicyVersion: string;
  readonly provenance: string;
  readonly origins: readonly EvidenceOrigin[];
}

interface ExcludedInventoryEntry extends MaterialInventoryIdentity {
  readonly claimUnitId?: never;
  readonly stratum: "Consequential";
  readonly timestamp: string;
  readonly statement: string;
  readonly reason: string;
}

function evidenceOrigin(
  input: Pick<
    EvidenceOrigin,
    "id" | "title" | "publisher" | "published" | "passage" | "stance"
  >,
): EvidenceOrigin {
  return {
    ...input,
    sourceClass: "Independent public research or administrative source",
    language: "English",
    originGroup: `${input.publisher} editorial and data origin`,
    authority: "Direct domain dataset or accountable public authority",
    independence: "No shared publisher, dataset owner, or commissioning body with the Video",
    rights: "Public excerpt display permitted from the retained review snapshot",
    change: "Available at retrieval; no material change recorded",
    snapshot: `snapshot://${input.id.toLowerCase()}/sha256-demo`,
  };
}

const SOURCE_POLICY_VERSION = "ESP-2026-08-11.v1";
const FINDING_PROVENANCE =
  "Transcript v17 · Material Inventory v3 · retrieval cutoff 8 August 2026 18:00 UTC · Finding rubric v1";

const CLAIMS: readonly EvidenceClaim[] = [
  {
    materialInventoryEntryId: "MIE-01",
    claimUnitId: "MCU-01",
    shortLabel: "Manufacturing emissions",
    statement: "Building an electric car always emits twice as much carbon as building a petrol car.",
    transcript: "Manufacturing an EV always creates twice the carbon of an equivalent petrol car.",
    timestamp: "02:10–02:21",
    stratum: "Central",
    relationship: "Conflicts with retrieved evidence",
    rationale: "Two independent claim-complete origins contradict the asserted universal two-times quantity while reporting smaller modeled increases.",
    scope: "Global modeled production pathways, 2024 electricity mixes",
    limitation: "Factory electricity and battery chemistry materially change the production estimate.",
    sufficiency: "Sufficient for a directional conflict under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-01-A",
        title: "Lifecycle greenhouse gas emissions from passenger cars",
        publisher: "International Energy Agency",
        published: "Published 14 March 2026 · retrieved 8 August 2026",
        passage: "Battery-electric vehicle production emissions were 35% to 70% higher across the modeled pathways, depending on battery chemistry and factory electricity.",
        stance: "Conflicts with the universal two-times quantity and supplies the observed range.",
      }),
      evidenceOrigin({
        id: "SRC-01-B",
        title: "Electric vehicle production footprint comparison",
        publisher: "European Commission Joint Research Centre",
        published: "Published 27 May 2026 · retrieved 8 August 2026",
        passage: "Across the independently modeled battery pathways, electric-car production emissions were 42% to 66% higher than the matched petrol-car baseline, not twice as high.",
        stance: "Independently conflicts with the universal twice-as-much quantity.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-02",
    claimUnitId: "MCU-02",
    shortLabel: "Lifetime emissions",
    statement: "Electric cars have lower lifetime emissions in most current power systems.",
    transcript: "Across most grids today, the electric car finishes with lower lifetime emissions.",
    timestamp: "04:32–04:43",
    stratum: "Central",
    relationship: "Supported by retrieved evidence",
    rationale: "Independent lifecycle pathways report lower total emissions for the bounded majority of present grids.",
    scope: "Passenger vehicles across major 2025 electricity regions",
    limitation: "Very coal-intensive grids and vehicle size can narrow or reverse the advantage.",
    sufficiency: "Sufficient for a directional Finding under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-02-A",
        title: "Global EV Outlook lifecycle annex",
        publisher: "International Energy Agency",
        published: "Published 20 April 2026 · retrieved 8 August 2026",
        passage: "Battery-electric cars produced lower lifecycle greenhouse gas emissions than comparable combustion cars in 29 of the 31 modeled electricity regions.",
        stance: "Supports the bounded most-current-power-systems proposition.",
      }),
      evidenceOrigin({
        id: "SRC-02-B",
        title: "Passenger-car lifecycle emissions update",
        publisher: "International Council on Clean Transportation",
        published: "Published 6 June 2026 · retrieved 8 August 2026",
        passage: "Battery-electric cars had lower full-lifecycle emissions than comparable petrol cars in 22 of the 24 power systems assessed under 2025 grid mixes.",
        stance: "Independently supports lower lifecycle emissions in most assessed current power systems.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-03",
    claimUnitId: "MCU-03",
    shortLabel: "Mineral demand",
    statement: "Battery recycling eliminates the need for newly mined lithium by 2030.",
    transcript: "By 2030 recycling means we will not need to mine any new lithium for car batteries.",
    timestamp: "06:18–06:30",
    stratum: "Central",
    relationship: "Conflicts with retrieved evidence",
    rationale: "The material demand outlook still requires primary lithium supply in 2030 after modeled recycling contributions.",
    scope: "Global battery demand outlook through 2030",
    limitation: "Longer-term circularity depends on collection, recovery yields, and demand growth.",
    sufficiency: "Sufficient for a directional conflict under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-03-A",
        title: "Critical Minerals Market Review 2026",
        publisher: "International Energy Agency",
        published: "Published 9 July 2026 · retrieved 8 August 2026",
        passage: "Secondary lithium supplies less than one fifth of projected 2030 battery demand in the central scenario; primary production remains necessary.",
        stance: "Contradicts elimination of new lithium mining by the claimed date.",
      }),
      evidenceOrigin({
        id: "SRC-03-B",
        title: "Lithium supply and recycling outlook",
        publisher: "United States Geological Survey",
        published: "Published 30 June 2026 · retrieved 8 August 2026",
        passage: "Recycled lithium remains a minority of projected 2030 battery supply, so newly mined lithium is still required in every modeled demand case.",
        stance: "Independently conflicts with elimination of newly mined lithium by 2030.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-04",
    claimUnitId: "MCU-04",
    shortLabel: "Battery recycling mandates",
    statement: "Battery recycling mandates doubled collection rates everywhere.",
    transcript:
      "Mandatory take-back programs doubled collection rates in every market that adopted them.",
    timestamp: "08:14–08:25",
    stratum: "Central",
    relationship: "Conflicts with retrieved evidence",
    rationale:
      "Two independent claim-complete origins contradict both doubled and every-market material elements.",
    scope: "Six European regions, 2023–2025",
    limitation: "The study does not cover every market or establish a universal effect.",
    sufficiency: "Sufficient for a directional conflict under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-04-A",
        title: "Extended producer responsibility: 2026 review",
        publisher: "European Environment Agency",
        published: "Published 18 June 2026 · retrieved 8 August 2026",
        passage: "Collection improved after the mandate, rising from 31% to 46% across the six participating regions.",
        stance: "Conflicts with the universal doubling and every-market claim.",
      }),
      evidenceOrigin({
        id: "SRC-04-B",
        title: "Battery take-back implementation report",
        publisher: "European Commission Directorate-General for Environment",
        published: "Published 22 July 2026 · retrieved 8 August 2026",
        passage: "Collection rose from 33% to 48% across five reporting states; two other adopting states reported no comparable doubling measure.",
        stance: "Independently conflicts with doubling in every adopting market.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-05",
    claimUnitId: "MCU-05",
    shortLabel: "Home charging cost",
    statement: "Home charging usually costs less per kilometre than petrol in the compared markets.",
    transcript: "For most households here, charging at home costs less per kilometre than petrol.",
    timestamp: "09:48–10:02",
    stratum: "Consequential",
    relationship: "Supported by retrieved evidence",
    rationale: "The independent tariff comparison supports the bounded usually/compared-markets claim.",
    scope: "Household tariffs in eight European markets, Q2 2026",
    limitation: "Public rapid charging, taxes, and dynamic tariffs produce different comparisons.",
    sufficiency: "Sufficient for a directional Finding under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-05-A",
        title: "Household transport energy price comparison",
        publisher: "European Alternative Fuels Observatory",
        published: "Updated 1 August 2026 · retrieved 8 August 2026",
        passage: "Median overnight home-charging energy cost per kilometre was below the matched petrol fuel cost in seven of eight surveyed markets.",
        stance: "Supports usually lower home-charging cost in the named comparison.",
      }),
      evidenceOrigin({
        id: "SRC-05-B",
        title: "Residential charging and fuel cost monitor",
        publisher: "Council of European Energy Regulators",
        published: "Published 15 July 2026 · retrieved 8 August 2026",
        passage: "Standard overnight residential charging cost less per kilometre than petrol in six of seven independently sampled European markets.",
        stance: "Independently supports usually lower home-charging cost in comparable markets.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-06",
    claimUnitId: "MCU-06",
    shortLabel: "Cold-weather range",
    statement: "Cold-weather road tests found electric-car range losses from 8 to 24 percent.",
    transcript: "In cold-weather road tests, electric-car range losses ran from eight to twenty-four percent.",
    timestamp: "11:24–11:35",
    stratum: "Consequential",
    relationship: "Qualified by retrieved evidence",
    rationale: "Both independent test programs support every asserted range element; the Finding adds a noncontradictory boundary to the tested vehicles and temperatures.",
    scope: "Mixed-route testing from 0°C to −15°C",
    limitation: "Heating use, speed, vehicle model, and battery conditioning affect loss.",
    sufficiency: "Sufficient for the displayed material qualification under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-06-A",
        title: "Cold-weather electric vehicle range tests",
        publisher: "Norwegian Automobile Federation",
        published: "Published 12 February 2026 · retrieved 8 August 2026",
        passage: "Observed range loss varied from 8% to 24% across the tested vehicles and temperatures.",
        stance: "Supports the asserted bounded loss range while limiting it to the tested vehicles.",
      }),
      evidenceOrigin({
        id: "SRC-06-B",
        title: "Winter electric-car range programme",
        publisher: "ADAC Test Centre",
        published: "Published 3 March 2026 · retrieved 8 August 2026",
        passage: "Measured cold-weather range losses spanned 8% to 24% across the independently tested vehicles and routes.",
        stance: "Independently supports the bounded cold-weather loss range while limiting it to tested vehicles.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-07",
    claimUnitId: "MCU-07",
    shortLabel: "Grid demand timing",
    statement: "Most vehicle charging already happens outside peak grid demand.",
    transcript:
      "Most drivers plug in overnight, after the evening grid peak has passed.",
    timestamp: "13:02–13:12",
    stratum: "Central",
    relationship: "Supported by retrieved evidence",
    rationale:
      "The cited national charging sample places a majority of residential sessions after the evening peak.",
    scope: "United States residential sessions, winter 2025",
    limitation: "Commercial fleets and summer demand patterns were outside the sample.",
    sufficiency: "Sufficient for a directional Finding under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-07-A",
        title: "National household charging study",
        publisher: "National Renewable Energy Laboratory",
        published: "Published 2 July 2026 · retrieved 8 August 2026",
        passage: "Sixty-eight percent of observed residential charging sessions began after 9 p.m., outside the system evening peak.",
        stance: "Supports the bounded majority and timing relation.",
      }),
      evidenceOrigin({
        id: "SRC-07-B",
        title: "Residential charging timing panel",
        publisher: "Grid Analytics Cooperative",
        published: "Published 19 June 2026 · retrieved 8 August 2026",
        passage: "In an independently recruited United States panel, 64% of home charging sessions started after the local evening demand peak.",
        stance: "Independently supports the bounded majority and off-peak timing relation.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-08",
    claimUnitId: "MCU-08",
    shortLabel: "Public charger reliability",
    statement: "Nine out of ten public rapid chargers work on the first attempt nationwide.",
    transcript: "Nationwide, nine out of ten rapid chargers work on the first try.",
    timestamp: "14:31–14:42",
    stratum: "Consequential",
    relationship: "Unresolved",
    rationale: "The admissible regional studies use materially different success definitions and do not establish the nationwide quantity.",
    scope: "Three regional charger samples, 2025–2026",
    limitation: "No harmonized nationwide first-attempt measure was available at the retrieval cutoff.",
    sufficiency: "Insufficient to resolve: incompatible_measurement under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-08-A",
        title: "Public rapid charging reliability pilot",
        publisher: "California Energy Commission",
        published: "Published 25 June 2026 · retrieved 8 August 2026",
        passage: "The pilot recorded 82% successful charging sessions, but did not isolate first-attempt activation nationwide.",
        stance: "Does not resolve the nationwide first-attempt quantity.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-09",
    claimUnitId: "MCU-09",
    shortLabel: "Used EV prices",
    statement: "Used electric vehicles retain value better than comparable petrol cars.",
    transcript:
      "After three years, an EV now keeps more of its purchase price than a petrol car.",
    timestamp: "16:40–16:49",
    stratum: "Central",
    relationship: "Conflicts with retrieved evidence",
    rationale:
      "The two independent market datasets both report lower three-year residual values for the compared electric cohort.",
    scope: "United Kingdom retail listings, Q2 2026",
    limitation: "Residual values vary by model, incentives, mileage, and local supply.",
    sufficiency: "Sufficient for a directional conflict under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-09-A",
        title: "2026 vehicle residual value index",
        publisher: "Transport Economics Observatory",
        published: "Updated 29 July 2026 · retrieved 8 August 2026",
        passage: "Three-year electric vehicles retained 47% of list price, compared with 55% for petrol vehicles in the matched cohort.",
        stance: "Contradicts better three-year value retention in the matched cohort.",
      }),
      evidenceOrigin({
        id: "SRC-09-B",
        title: "Quarterly used vehicle market monitor",
        publisher: "UK Vehicle Valuation Institute",
        published: "Published 4 August 2026 · retrieved 8 August 2026",
        passage: "Matched battery-electric models depreciated 6.2 percentage points more than petrol peers at year three.",
        stance: "Independently contradicts the comparative retention direction.",
      }),
    ],
  },
  {
    materialInventoryEntryId: "MIE-12",
    claimUnitId: "MCU-12",
    shortLabel: "Battery lifetime",
    statement: "A typical battery will remain above 90% capacity for fifteen years.",
    transcript:
      "A typical pack should still have more than ninety percent capacity after fifteen years.",
    timestamp: "21:06–21:18",
    stratum: "Consequential",
    relationship: "Unresolved",
    rationale:
      "The retrieved longitudinal evidence does not yet follow a representative cohort for fifteen years.",
    scope: "Eight-year observation with modeled extension",
    limitation: "The fifteen-year material element cannot be resolved from observed data.",
    sufficiency: "Insufficient to resolve: temporal_coverage_gap under the source policy.",
    sourcePolicyVersion: SOURCE_POLICY_VERSION,
    provenance: FINDING_PROVENANCE,
    origins: [
      evidenceOrigin({
        id: "SRC-12-A",
        title: "Longitudinal EV battery health dataset",
        publisher: "International Council on Clean Transportation",
        published: "Published 11 May 2026 · retrieved 8 August 2026",
        passage: "Observed degradation remained modest through year eight; longer-term estimates depend on modeled usage and climate assumptions.",
        stance: "Leaves the claimed fifteen-year capacity unresolved.",
      }),
    ],
  },
] as const;

const EXCLUDED_INVENTORY: readonly ExcludedInventoryEntry[] = [
  {
    materialInventoryEntryId: "MIE-10",
    stratum: "Consequential",
    timestamp: "18:22–18:34",
    statement: "The dashboard demonstration proves this electric car causes less tyre wear than a petrol car.",
    reason: "excluded · visual_dependency · the asserted comparison depends on an unseen dashboard demonstration",
  },
  {
    materialInventoryEntryId: "MIE-11",
    stratum: "Consequential",
    timestamp: "19:45–19:57",
    statement: "By 2029 every apartment building will offer overnight charging without grid work.",
    reason: "excluded · pending_prediction · the future universal outcome is not a stable assessable claim",
  },
] as const;

const VARIANT_LABELS: Record<EvidencePrototypeVariant, string> = {
  "claim-desk": "A · Claim desk",
  "coverage-ledger": "B · Coverage ledger",
  "guided-dossier": "C · Guided dossier",
};

const FIXTURE_LABELS: Record<EvidencePrototypeFixture, string> = {
  request: "Request",
  progress: "In progress",
  report: "Completed report",
  recheck: "Recheck due",
  corrected: "Corrected report",
  "not-eligible": "Not eligible",
  waiting: "Waiting for sources",
  failed: "Retryable failure",
  expired: "Expired report",
  suppressed: "Temporarily suppressed",
  withdrawn: "Withdrawn report",
  notices: "Private notices",
  comprehension: "Comprehension study",
};

const RELATIONSHIP_STYLES: Record<Relationship, string> = {
  "Supported by retrieved evidence":
    "border-accent-success/35 bg-accent-success/10 text-accent-success",
  "Qualified by retrieved evidence":
    "border-accent-warning/35 bg-accent-warning/10 text-accent-warning",
  "Conflicts with retrieved evidence":
    "border-accent-danger/35 bg-accent-danger/10 text-accent-danger",
  Unresolved: "border-border-default bg-surface-sunken text-text-secondary",
};

interface EvidenceWorkspacePrototypeProps {
  readonly initialVariant?: EvidencePrototypeVariant;
  readonly initialFixture?: EvidencePrototypeFixture;
}

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

function ClaimDesk({ selected, onSelect }: ReportLayoutProps) {
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

function CoverageLedger({ selected, onSelect }: ReportLayoutProps) {
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

function GuidedDossier({ selected, onSelect }: ReportLayoutProps) {
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

interface ReportLayoutProps {
  readonly selected: EvidenceClaim;
  readonly onSelect: (claim: EvidenceClaim) => void;
}

function LifecycleState({ fixture, onStart }: { readonly fixture: EvidencePrototypeFixture; readonly onStart: () => void }) {
  if (fixture === "request") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 text-center sm:p-10">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand">
          <SearchCheck aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-text-primary">Check this Video’s material claims</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-text-secondary">
          Evidence Check is a separate, private review. It examines 8–15 material claims. A visual dependency may be ineligible or excluded; only an eligible Finding can be Unresolved when admitted evidence cannot establish a direction.
        </p>
        <Button className="mt-5" onClick={onStart}>Request Evidence Check</Button>
        <p className="mt-3 text-xs text-text-muted">No score is produced. You can leave after the request starts.</p>
      </section>
    );
  }

  if (fixture === "progress") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
        <div className="flex items-start gap-4" role="status" aria-live="polite">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Evidence Check in progress</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">Reviewing evidence</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">You can leave this page. The Evidence tab will show the durable status when you return.</p>
          </div>
        </div>
        <ol className="mt-6 space-y-3 text-sm">
          <ProgressStep done label="Eligibility confirmed" />
          <ProgressStep done label="Material claims identified" />
          <ProgressStep done label="Waiting for sources" />
          <ProgressStep active label="Reviewing evidence" />
          <ProgressStep label="Preparing report" />
        </ol>
        <Button className="mt-6" variant="outline">Cancel Evidence Check</Button>
      </section>
    );
  }

  if (fixture === "waiting") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
        <div className="flex items-start gap-4" role="status" aria-live="polite">
          <span className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-brand/10 text-accent-brand">
            <Clock3 className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Evidence Check in progress</p>
            <h2 className="mt-1 text-xl font-semibold text-text-primary">Waiting for sources</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">This durable stage is saved. You can leave this page and return without restarting the check.</p>
          </div>
        </div>
        <p className="mt-5 rounded-xl border border-border-subtle bg-surface-sunken p-3 text-sm text-text-secondary">No percentage or completion estimate is available. The next named stage is Reviewing evidence.</p>
        <Button className="mt-5" variant="outline">Cancel Evidence Check</Button>
      </section>
    );
  }

  if (fixture === "not-eligible") {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
        <ShieldAlert className="size-9 text-accent-warning" aria-hidden />
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-accent-warning">Not eligible · no report</p>
        <h2 className="mt-1 text-xl font-semibold text-text-primary">No report was created</h2>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          This Video relies on a visual demonstration that the available Transcript cannot faithfully represent. Eligibility was declined, so no Finding or Evidence Relationship exists.
        </p>
      </section>
    );
  }

  if (fixture === "failed") {
    return (
      <UnavailableReportState
        icon={<ShieldAlert aria-hidden />}
        eyebrow="Evidence Check failed · no report"
        title="A technical problem stopped this check"
        description="No Finding or partial report was published. A single-use retry is available for this bounded platform failure."
        action={<Button>Retry Evidence Check</Button>}
      />
    );
  }

  if (fixture === "expired") {
    return (
      <UnavailableReportState
        icon={<Clock3 aria-hidden />}
        eyebrow="Expired · no active assessment"
        title="This dated report can no longer be presented as current evidence"
        description="Its content-free audit shell, reason, dates, and version chain remain. An older report was not promoted in its place."
        action={<Button>Request a new Evidence Check</Button>}
        history="Version 2 · report dated 8 August 2026 · expired 11 August 2026"
      />
    );
  }

  if (fixture === "suppressed") {
    return (
      <UnavailableReportState
        icon={<ShieldAlert aria-hidden />}
        eyebrow="Temporarily suppressed · review pending"
        title="This complete report is temporarily unavailable"
        description="A source-rights concern blocks the entire report while authorized review is pending. No older report replaces it."
        history="Version 2 · display content hidden · action recorded 11 August 2026"
      />
    );
  }

  if (fixture === "withdrawn") {
    return (
      <UnavailableReportState
        icon={<ShieldAlert aria-hidden />}
        eyebrow="Withdrawn · final availability decision"
        title="There is no active Evidence report"
        description="The affected report cannot be displayed. Only a content-free history shell and authorized action record remain."
        history="Version 2 · withdrawn 11 August 2026 · no fallback report"
      />
    );
  }

  if (fixture === "notices") return <PrivateNoticeCenter />;
  if (fixture === "comprehension") return <ComprehensionStudy />;

  return null;
}

const PRIVATE_NOTICES = [
  { id: "completion", label: "Completion", detail: "A partially completed report is ready with 10 of 12 inventory entries examined." },
  { id: "failure", label: "Retryable failure", detail: "No report was published. One bounded Retry authorization is available." },
  { id: "recheck", label: "Recheck due", detail: "The dated 8 August report remains accessible but is not current-status evidence." },
  { id: "correction", label: "Material correction", detail: "Version 2 is current; version 1 is superseded and the before/after change is available." },
  { id: "suppression", label: "Temporary suppression", detail: "The complete report is unavailable while an authorized review is pending." },
  { id: "not-eligible", label: "Not eligible", detail: "No Finding exists; no report was created because the governed eligibility decision did not admit this Video." },
  { id: "restoration", label: "Restoration", detail: "The report display was restored after the authorized availability review completed." },
  { id: "withdrawal", label: "Withdrawal", detail: "The withdrawal is final and no active report can be displayed." },
  { id: "case", label: "Case disposition", detail: "The authorized Case disposition changed the governed availability state without exposing private content in the generic notice." },
] as const;

function PrivateNoticeCenter() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const selected = PRIVATE_NOTICES.find((notice) => notice.id === selectedId);

  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-border-subtle bg-surface-raised p-5 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Private in-app notices</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">Evidence Check updates</h2>
      <p className="mt-2 text-sm text-text-secondary">The notice list is generic. Private report state appears only after account reauthorization.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
      {PRIVATE_NOTICES.map((notice, index) => (
          <button
            key={notice.id}
            type="button"
            onClick={() => {
              setSelectedId(notice.id);
              setAuthorized(false);
            }}
            className="rounded-xl border border-border-subtle bg-surface-base p-3 text-left focus-visible:outline-2 focus-visible:outline-state-focus"
          >
            <span className="block text-xs text-text-muted">Private update · 11 August 2026</span>
            <span className="mt-1 block font-semibold text-text-primary">Review private update {index + 1}</span>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="mt-5 rounded-xl border border-accent-brand/30 bg-accent-brand/5 p-4" role="status" aria-live="polite">
          {!authorized ? (
            <>
              <p className="font-semibold text-text-primary">Reauthorization required</p>
              <p className="mt-1 text-sm text-text-secondary">Confirm the invited Learner account before loading private Evidence details.</p>
              <Button className="mt-3" onClick={() => setAuthorized(true)}>Continue as demo learner</Button>
            </>
          ) : (
            <>
              <p className="font-semibold text-text-primary">{selected.label}</p>
              <p className="mt-1 text-sm text-text-secondary">{selected.detail}</p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

const COMPREHENSION_ANSWERS = {
  scope: "uk-three-year",
  relationship: "conflicts",
  unresolved: "abstains",
  coverage: "ten-plus-two",
  overreliance: "evidence-not-honesty",
  confidence: "not-estimated",
} as const;

function ComprehensionStudy() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<"pass" | "retry" | null>(null);
  const answer = (key: string, value: string) =>
    setAnswers((current) => ({ ...current, [key]: value }));

  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-border-subtle bg-surface-raised p-5 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-danger">Seeded-error comprehension task · P-04 fixture</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">Correct the Finding without judging the speaker</h2>
      <p className="mt-2 text-sm text-text-secondary">Simulated protocol only · no human participant or launch evidence. The prototype intentionally labels this Finding “Supported by retrieved evidence.” Inspect the exact passage, then answer all six concepts.</p>
      <div className="mt-4 rounded-xl border border-accent-danger/30 bg-accent-danger/5 p-4">
        <p className="font-semibold text-text-primary">Claim: Used electric vehicles retain value better than comparable petrol cars.</p>
        <p className="mt-2 text-sm text-text-secondary">Seeded relationship: Supported by retrieved evidence</p>
        <blockquote className="mt-3 border-l-2 border-accent-danger pl-3 text-sm text-text-primary">“Three-year electric vehicles retained 47% of list price, compared with 55% for petrol vehicles in the matched UK cohort.”</blockquote>
      </div>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const passed = Object.entries(COMPREHENSION_ANSWERS).every(
            ([key, expected]) => answers[key] === expected,
          );
          setResult(passed ? "pass" : "retry");
        }}
      >
        <StudySelect label="1. What is the bounded claim scope?" value={answers.scope} onChange={(value) => answer("scope", value)} options={["Global prices", "UK matched cohort at three years"]} values={["global", "uk-three-year"]} />
        <StudySelect label="2. Which correction does the passage require?" value={answers.relationship} onChange={(value) => answer("relationship", value)} options={["Supported by retrieved evidence", "Conflicts with retrieved evidence"]} values={["supported", "conflicts"]} />
        <StudySelect label="3. What does Unresolved mean?" value={answers.unresolved} onChange={(value) => answer("unresolved", value)} options={["The claim is false", "The system abstains from a directional relationship"]} values={["false", "abstains"]} />
        <StudySelect label="4. What does 10 of 12 Coverage mean?" value={answers.coverage} onChange={(value) => answer("coverage", value)} options={["A score of 83%", "10 complete Findings plus 2 explicit governed exclusions"]} values={["score", "ten-plus-two"]} />
        <StudySelect label="5. What may you conclude about the speaker?" value={answers.overreliance} onChange={(value) => answer("overreliance", value)} options={["The speaker is dishonest", "Only that retrieved evidence conflicts with this bounded claim"]} values={["dishonest", "evidence-not-honesty"]} />
        <StudySelect label="6. What does Confidence: unavailable mean?" value={answers.confidence} onChange={(value) => answer("confidence", value)} options={["The report is probably accurate", "No calibrated confidence estimate is available"]} values={["likely-accurate", "not-estimated"]} />
        <Button type="submit">Evaluate simulated response</Button>
      </form>
      {result ? (
        <div className={cn("mt-5 rounded-xl border p-4 text-sm", result === "pass" ? "border-accent-success/35 bg-accent-success/10 text-text-primary" : "border-accent-warning/35 bg-accent-warning/10 text-text-primary")} role="status" aria-live="polite">
          {result === "pass"
            ? "Simulated protocol pass: six concepts demonstrated — claim scope, relationship meaning, Unresolved, Coverage, confidence unavailability, and evidence limitation; the overreliance check passed. No human participant or launch evidence was produced."
            : "Protocol observation incomplete: revisit the seeded Finding and record which concept was misunderstood."}
        </div>
      ) : null}
    </section>
  );
}

function StudySelect({ label, value, onChange, options, values }: { readonly label: string; readonly value?: string; readonly onChange: (value: string) => void; readonly options: readonly string[]; readonly values: readonly string[] }) {
  return (
    <label className="block text-sm font-semibold text-text-primary">
      {label}
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className="mt-2 block w-full rounded-lg border border-border-default bg-surface-base px-3 py-2 text-sm font-normal text-text-primary focus-visible:outline-2 focus-visible:outline-state-focus" required>
        <option value="" disabled>Select an observation</option>
        {options.map((option, index) => <option key={values[index]} value={values[index]}>{option}</option>)}
      </select>
    </label>
  );
}

function UnavailableReportState({
  icon,
  eyebrow,
  title,
  description,
  action,
  history,
}: {
  readonly icon: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
  readonly history?: string;
}) {
  return (
    <section className="mx-auto max-w-2xl rounded-3xl border border-border-subtle bg-surface-raised p-6 sm:p-10">
      <span className="text-accent-warning [&_svg]:size-9">{icon}</span>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-accent-warning">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold text-text-primary">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-text-secondary">{description}</p>
      {history ? (
        <div className="mt-5 rounded-xl border border-border-subtle bg-surface-sunken p-3 text-sm text-text-secondary">
          <p className="font-semibold text-text-primary">Report history shell</p>
          <p className="mt-1">{history}</p>
        </div>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

function ProgressStep({ done = false, active = false, label }: { readonly done?: boolean; readonly active?: boolean; readonly label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className={cn("flex size-6 items-center justify-center rounded-full border", done ? "border-accent-success bg-accent-success/10 text-accent-success" : active ? "border-accent-brand bg-accent-brand/10 text-accent-brand" : "border-border-default text-text-muted")}>
        {done ? <Check className="size-3.5" aria-hidden /> : <span className="size-1.5 rounded-full bg-current" />}
      </span>
      <span className={cn("text-text-secondary", active && "font-semibold text-text-primary")}>{label}</span>
    </li>
  );
}

function HistoryPanel() {
  return (
    <section aria-labelledby="history-title" className="mt-5 rounded-2xl border border-border-subtle bg-surface-raised p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <History className="size-4 text-accent-brand" aria-hidden />
        <h2 id="history-title" className="font-semibold text-text-primary">Report history</h2>
      </div>
      <ol className="mt-4 space-y-3 text-sm">
        <li className="rounded-xl border border-accent-brand/35 bg-accent-brand/5 p-3">
          <p className="font-semibold text-text-primary">Current · version 2</p>
          <p className="mt-1 text-text-secondary">Corrected 10 August 2026 after the cited source published a revision.</p>
          <p className="mt-2 text-text-secondary">After: Conflicts with retrieved evidence — the claim said doubled in every market, while two independent origins reported smaller increases and missing comparable measures.</p>
        </li>
        <li className="rounded-xl border border-border-subtle p-3">
          <p className="font-semibold text-text-primary">Superseded · version 1</p>
          <p className="mt-1 text-text-secondary">Report dated 8 August 2026</p>
          <p className="mt-2 text-text-secondary">Before: Supported by retrieved evidence — based on the earlier source wording.</p>
        </li>
      </ol>
    </section>
  );
}

export function EvidenceWorkspacePrototype({
  initialVariant = "claim-desk",
  initialFixture = "report",
}: EvidenceWorkspacePrototypeProps) {
  const [variant, setVariant] = useState<EvidencePrototypeVariant>(initialVariant);
  const [fixture, setFixture] = useState<EvidencePrototypeFixture>(initialFixture);
  const [selected, setSelected] = useState<EvidenceClaim>(CLAIMS[0]);
  const [recheckRunning, setRecheckRunning] = useState(false);

  const replacePrototypeQuery = useCallback((key: string, value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const selectVariant = useCallback(
    (next: EvidencePrototypeVariant) => {
      setVariant(next);
      replacePrototypeQuery("variant", next);
    },
    [replacePrototypeQuery],
  );

  const selectFixture = useCallback(
    (next: EvidencePrototypeFixture) => {
      setFixture(next);
      setRecheckRunning(false);
      replacePrototypeQuery("fixture", next);
    },
    [replacePrototypeQuery],
  );

  const handlePrototypeKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const currentIndex = VARIANTS.indexOf(variant);
    selectVariant(
      VARIANTS[
        (currentIndex + direction + VARIANTS.length) % VARIANTS.length
      ] ?? VARIANTS[0],
    );
  };

  const reportLayout = useMemo(() => {
    const props: ReportLayoutProps = { selected, onSelect: setSelected };
    if (variant === "coverage-ledger") return <CoverageLedger {...props} />;
    if (variant === "guided-dossier") return <GuidedDossier {...props} />;
    return <ClaimDesk {...props} />;
  }, [selected, variant]);

  const reportVisible = fixture === "report" || fixture === "recheck" || fixture === "corrected";

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-surface-base pb-28 text-text-primary">
      <div
        className="mx-auto max-w-page px-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-state-focus sm:py-8"
        role="region"
        aria-label="Evidence prototype canvas. Focus here, then use Left and Right Arrow keys to compare layouts."
        tabIndex={0}
        onKeyDown={handlePrototypeKeyDown}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-raised px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Single Video workspace</p>
            <p className="truncate text-sm font-semibold text-text-primary">What actually makes an electric car sustainable?</p>
          </div>
          <span className="rounded-full border border-border-default px-2.5 py-1 text-xs text-text-secondary">Fixture data · private</span>
        </div>

        <Tabs defaultValue="evidence" className="gap-4">
          <div className="sticky top-0 z-30 -mx-4 bg-surface-base/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
            <TabsList className="grid h-auto w-full grid-cols-4 md:w-fit">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="summary"><PrototypePeerPanel icon={<BookOpenText />} title="Summary" /></TabsContent>
          <TabsContent value="transcript"><PrototypePeerPanel icon={<FileClock />} title="Transcript" /></TabsContent>
          <TabsContent value="chat"><PrototypePeerPanel icon={<MessageSquareText />} title="Chat" /></TabsContent>
          <TabsContent value="evidence">
            <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-brand">Opt-in · asynchronous</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">Evidence Check</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">A claim-by-claim view of what retrieved evidence supports, qualifies, conflicts with, or cannot resolve.</p>
              </div>
              {fixture === "recheck" ? (
                <div className="text-right">
                  <span className="inline-flex rounded-full border border-accent-warning/35 bg-accent-warning/10 px-2.5 py-1 text-xs font-semibold text-accent-warning">Recheck due</span>
                  <p className="mt-1 text-xs text-text-muted">Report dated 8 August 2026</p>
                </div>
              ) : null}
            </header>

            {fixture === "recheck" ? (
              <div className="mb-4 rounded-xl border border-accent-warning/35 bg-accent-warning/5 p-4">
                {recheckRunning ? (
                  <div className="flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
                    <div><p className="font-semibold text-text-primary">Reviewing evidence</p><p className="text-sm text-text-secondary">The dated report remains visible while this recheck runs.</p></div>
                    <Button variant="outline" onClick={() => setRecheckRunning(false)}>Cancel recheck</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-semibold text-text-primary">Sources or material dependencies may have changed.</p><p className="text-sm text-text-secondary">The prior report is still available and clearly dated.</p></div>
                    <Button onClick={() => setRecheckRunning(true)}>Request recheck</Button>
                  </div>
                )}
              </div>
            ) : null}

            {reportVisible ? reportLayout : <LifecycleState fixture={fixture} onStart={() => selectFixture("progress")} />}
            {fixture === "corrected" ? <HistoryPanel /> : null}
          </TabsContent>
        </Tabs>
      </div>

      <section
        aria-label="Prototype controls"
        className="fixed inset-x-2 bottom-2 z-50 mx-auto flex max-w-3xl flex-col gap-2 overflow-hidden rounded-2xl border border-border-default bg-surface-inverse px-2 py-2 text-text-inverse shadow-2xl sm:inset-x-6 sm:bottom-3 sm:flex-row sm:items-center sm:justify-between sm:px-3 sm:py-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-[0.68rem] font-bold uppercase tracking-[0.16em] opacity-70">Prototype</span>
          <div className="flex min-w-0 gap-1" aria-label="Layout variant">
            {VARIANTS.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={variant === item}
                onClick={() => selectVariant(item)}
                aria-label={VARIANT_LABELS[item]}
                className="min-w-8 rounded-lg px-2 py-1 text-xs font-semibold opacity-65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white aria-pressed:bg-white/15 aria-pressed:opacity-100 sm:min-w-0"
              >
                <span aria-hidden className="sm:hidden">{VARIANT_LABELS[item].slice(0, 1)}</span>
                <span aria-hidden className="hidden sm:inline">{VARIANT_LABELS[item]}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <span className="shrink-0 opacity-70">Fixture state</span>
          <select
            value={fixture}
            onChange={(event) => {
              selectFixture(event.target.value as EvidencePrototypeFixture);
            }}
            className="min-w-0 rounded-lg border border-white/25 bg-black/20 px-2 py-1.5 text-xs text-white outline-none focus:ring-2 focus:ring-white"
          >
            {FIXTURES.map((item) => <option key={item} value={item}>{FIXTURE_LABELS[item]}</option>)}
          </select>
        </label>
      </section>
    </div>
  );
}

function PrototypePeerPanel({ icon, title }: { readonly icon: ReactNode; readonly title: string }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-raised p-6">
      <div className="flex items-center gap-2 text-accent-brand">{icon}<h2 className="text-lg font-semibold text-text-primary">{title} fixture</h2></div>
      <p className="mt-2 text-sm text-text-secondary">This peer tab is intentionally reduced so the prototype can focus on Evidence navigation without changing the existing workspace.</p>
    </section>
  );
}
