"use client";

export const VARIANTS = ["claim-desk", "coverage-ledger", "guided-dossier"] as const;

export type EvidencePrototypeVariant = (typeof VARIANTS)[number];

export const FIXTURES = [
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

export type Relationship =
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

export interface EvidenceClaim extends MaterialInventoryIdentity {
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

export const CLAIMS: readonly EvidenceClaim[] = [
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

export const EXCLUDED_INVENTORY: readonly ExcludedInventoryEntry[] = [
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

export const VARIANT_LABELS: Record<EvidencePrototypeVariant, string> = {
  "claim-desk": "A · Claim desk",
  "coverage-ledger": "B · Coverage ledger",
  "guided-dossier": "C · Guided dossier",
};

export const FIXTURE_LABELS: Record<EvidencePrototypeFixture, string> = {
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
