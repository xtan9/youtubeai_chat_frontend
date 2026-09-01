import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Repository-side governance for the Channel blind evaluation corpus.
 *
 * This module owns the corpus contract and a deterministic synthetic inventory.
 * It does not collect YouTube API Data, record human approvals, or run the
 * final model/prompt/validator tuple. Those are explicit external or blocked
 * steps represented by the evidence fields below.
 */

export const CHANNEL_ENGLISH_BLIND_CORPUS_ID =
  "channel-english-blind-v1" as const;
export const CHANNEL_ENGLISH_BLIND_CORPUS_VERSION = "v1" as const;
export const CHANNEL_EVALUATION_POLICY_VERSION =
  "channel-comment-assistance-d74-v1" as const;

export const CHANNEL_EVALUATION_CATEGORIES = [
  "Allowed Criticism",
  "Actionable Abuse",
  "Reviewable Interaction",
  "Safety Flag",
] as const;
export type ChannelEvaluationCategory =
  (typeof CHANNEL_EVALUATION_CATEGORIES)[number];
export const ChannelEvaluationCategorySchema = z.enum(
  CHANNEL_EVALUATION_CATEGORIES,
);

export const ADVERSARIAL_ITEM_KINDS = [
  "prompt_injection",
  "adversarial",
] as const;
export type AdversarialItemKind = (typeof ADVERSARIAL_ITEM_KINDS)[number];
export const AdversarialItemKindSchema = z.enum(ADVERSARIAL_ITEM_KINDS);

export const ZERO_TOLERANCE_VALIDATORS = [
  "privacy",
  "threat",
  "impersonation",
  "diagnosis",
  "spam",
  "malicious_link",
  "instruction_echo",
] as const;
export type ZeroToleranceValidator =
  (typeof ZERO_TOLERANCE_VALIDATORS)[number];
export const ZeroToleranceValidatorSchema = z.enum(
  ZERO_TOLERANCE_VALIDATORS,
);

/** D74's protected-group categories, kept as stable manifest keys. */
export const PROTECTED_GROUP_CROSS_CUTS = [
  "age",
  "caste_ethnicity_or_race",
  "disability",
  "immigration_status",
  "nationality",
  "religion",
  "sex_gender_or_sexual_orientation",
  "veteran_status",
  "victims_of_major_violent_event_or_kin",
] as const;
export type ProtectedGroupCrossCut =
  (typeof PROTECTED_GROUP_CROSS_CUTS)[number];
export const ProtectedGroupCrossCutSchema = z.enum(
  PROTECTED_GROUP_CROSS_CUTS,
);

const SYNTHETIC_AUTHORING_LANGUAGES = [
  "en",
  "zh",
  "zh-TW",
  "en-x-code-switch",
] as const;
const SyntheticAuthoringLanguageSchema = z.enum(SYNTHETIC_AUTHORING_LANGUAGES);

export const ENGLISH_BLIND_CORPUS_MINIMUMS = {
  totalItems: 1_000,
  allowedCriticismItems: 300,
  actionableAbuseItems: 250,
  reviewableInteractionItems: 200,
  safetyFlagItems: 200,
  adversarialItems: 50,
  zeroToleranceValidatorItems: 250,
  protectedGroupCrossCutItems: 100,
  minorSafetyItems: 200,
} as const;

const CategoryCountsSchema = z
  .object({
    "Allowed Criticism": z.number().int().nonnegative(),
    "Actionable Abuse": z.number().int().nonnegative(),
    "Reviewable Interaction": z.number().int().nonnegative(),
    "Safety Flag": z.number().int().nonnegative(),
  })
  .strict();
type CategoryCounts = z.infer<typeof CategoryCountsSchema>;

const ProtectedGroupCountsSchema = z
  .object({
    age: z.number().int().nonnegative(),
    caste_ethnicity_or_race: z.number().int().nonnegative(),
    disability: z.number().int().nonnegative(),
    immigration_status: z.number().int().nonnegative(),
    nationality: z.number().int().nonnegative(),
    religion: z.number().int().nonnegative(),
    sex_gender_or_sexual_orientation: z.number().int().nonnegative(),
    veteran_status: z.number().int().nonnegative(),
    victims_of_major_violent_event_or_kin: z.number().int().nonnegative(),
  })
  .strict();
type ProtectedGroupCounts = z.infer<typeof ProtectedGroupCountsSchema>;

const OriginCountsSchema = z
  .object({
    authored_synthetic: z.number().int().nonnegative(),
    creator_example: z.number().int().nonnegative(),
  })
  .strict();

export const ChannelEvaluationCoverageSchema = z
  .object({
    totalItems: z.number().int().nonnegative(),
    categoryCounts: CategoryCountsSchema,
    adversarialCount: z.number().int().nonnegative(),
    zeroToleranceValidatorCount: z.number().int().nonnegative(),
    protectedGroupCounts: ProtectedGroupCountsSchema,
    minorSafetyCount: z.number().int().nonnegative(),
    originCounts: OriginCountsSchema,
    reviewerCompleteCount: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelEvaluationCoverage = z.infer<
  typeof ChannelEvaluationCoverageSchema
>;

const ReviewerLabelSchema = z
  .object({
    reviewerId: z.string().trim().min(1).max(120),
    label: ChannelEvaluationCategorySchema,
    labeledAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ChannelEvaluationReviewerLabel = z.infer<
  typeof ReviewerLabelSchema
>;

export const ReviewerProvenanceSchema = z
  .object({
    status: z.enum(["pending", "complete"]),
    independentLabels: z.array(ReviewerLabelSchema).max(2),
    adjudication: ReviewerLabelSchema.nullable(),
    finalLabel: ChannelEvaluationCategorySchema.nullable(),
  })
  .strict();
export type ReviewerProvenance = z.infer<typeof ReviewerProvenanceSchema>;

export const ChannelEvaluationCorpusItemSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{2,119}$/),
    language: z.literal("en"),
    text: z.string().trim().min(1).max(4_000),
    category: ChannelEvaluationCategorySchema,
    adversarialKind: AdversarialItemKindSchema.nullable(),
    zeroToleranceValidator: ZeroToleranceValidatorSchema.nullable(),
    protectedGroupCrossCuts: z
      .array(ProtectedGroupCrossCutSchema)
      .max(PROTECTED_GROUP_CROSS_CUTS.length),
    minorSafety: z.boolean(),
    origin: z
      .object({
        kind: z.enum(["authored_synthetic", "creator_example"]),
        reference: z.string().trim().min(1).max(240),
        authoringLanguages: z
          .array(SyntheticAuthoringLanguageSchema)
          .min(1)
          .max(SYNTHETIC_AUTHORING_LANGUAGES.length),
      })
      .strict(),
    rights: z
      .object({
        basis: z.enum(["original_synthetic", "creator_license"]),
        status: z.enum(["not_applicable_synthetic", "verified"]),
        consentReference: z.string().trim().max(240).nullable(),
        licenseReference: z.string().trim().max(240).nullable(),
      })
      .strict(),
    deidentification: z
      .object({
        status: z.enum(["not_applicable_synthetic", "verified"]),
        method: z.string().trim().min(1).max(240),
        evidenceReference: z.string().trim().max(240).nullable(),
      })
      .strict(),
    policyVersion: z.string().trim().min(1).max(120),
    evaluationUse: z.literal("blind_evaluation_only"),
    reviewerProvenance: ReviewerProvenanceSchema,
  })
  .strict();
export type ChannelEvaluationCorpusItem = z.infer<
  typeof ChannelEvaluationCorpusItemSchema
>;

const ProtectedGroupMinimumsSchema = ProtectedGroupCountsSchema;

const CorpusTargetsSchema = z
  .object({
    totalItems: z.number().int().positive(),
    categoryMinimums: CategoryCountsSchema,
    adversarialItems: z.number().int().positive(),
    zeroToleranceValidatorItems: z.number().int().positive(),
    protectedGroupCrossCutItems: z.number().int().positive(),
    minorSafetyItems: z.number().int().positive(),
    protectedGroupMinimums: ProtectedGroupMinimumsSchema,
  })
  .strict();

const ApprovalEvidenceSchema = z
  .object({
    status: z.enum(["pending", "recorded"]),
    corpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    approvedAt: z.string().datetime({ offset: true }).nullable(),
    approvedBy: z.string().trim().min(1).max(120).nullable(),
    evidenceReference: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

const FreezeEvidenceSchema = z
  .object({
    status: z.enum(["not_frozen", "recorded"]),
    corpusFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    frozenAt: z.string().datetime({ offset: true }).nullable(),
    frozenBy: z.string().trim().min(1).max(120).nullable(),
    evidenceReference: z.string().trim().min(1).max(240).nullable(),
  })
  .strict();

const FinalTupleEvaluationSchema = z
  .object({
    status: z.enum(["blocked", "available", "completed"]),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    tupleFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  })
  .strict();

const UpstreamHarnessSchema = z.discriminatedUnion("status", [
  z
    .object({
      issueNumber: z.literal(482),
      status: z.literal("not_available"),
    })
    .strict(),
  z
    .object({
      issueNumber: z.literal(482),
      status: z.literal("available"),
      sourceRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
      evidenceReference: z.string().trim().min(1).max(240),
    })
    .strict(),
]);

export const ChannelEnglishBlindEvaluationCorpusSchema = z
  .object({
    recordType: z.literal("channel-english-blind-evaluation-corpus"),
    recordVersion: z.literal(1),
    corpusId: z.literal(CHANNEL_ENGLISH_BLIND_CORPUS_ID),
    corpusVersion: z.literal(CHANNEL_ENGLISH_BLIND_CORPUS_VERSION),
    language: z.literal("en"),
    policyVersion: z.literal(CHANNEL_EVALUATION_POLICY_VERSION),
    status: z.enum(["inventory_pending_review", "approved", "frozen"]),
    blind: z.literal(true),
    developmentCorpus: z.literal(false),
    tuning: z
      .object({
        allowed: z.literal(false),
        prohibition: z.string().trim().min(1).max(500),
      })
      .strict(),
    reviewProtocol: z
      .object({
        independentReviewerCount: z.literal(2),
        adjudicatorResolvesDisagreements: z.literal(true),
      })
      .strict(),
    targets: CorpusTargetsSchema,
    declaredCoverage: ChannelEvaluationCoverageSchema,
    items: z.array(ChannelEvaluationCorpusItemSchema),
    approval: ApprovalEvidenceSchema,
    freeze: FreezeEvidenceSchema,
    finalTupleEvaluation: FinalTupleEvaluationSchema,
    upstreamHarness: UpstreamHarnessSchema,
  })
  .strict();
export type ChannelEnglishBlindEvaluationCorpus = z.infer<
  typeof ChannelEnglishBlindEvaluationCorpusSchema
>;

export const ChannelEnglishBlindCorpusManifestDescriptorSchema = z
  .object({
    recordType: z.literal("channel-english-blind-evaluation-corpus-manifest"),
    recordVersion: z.literal(1),
    corpusId: z.literal(CHANNEL_ENGLISH_BLIND_CORPUS_ID),
    corpusVersion: z.literal(CHANNEL_ENGLISH_BLIND_CORPUS_VERSION),
    language: z.literal("en"),
    policyVersion: z.literal(CHANNEL_EVALUATION_POLICY_VERSION),
    lifecycleStatus: z.literal("inventory_pending_review"),
    blind: z.literal(true),
    developmentCorpus: z.literal(false),
    materialization: z
      .object({
        kind: z.literal("deterministic_repository_factory"),
        sourcePath: z.literal("lib/channel/evaluation-corpus-governance.ts"),
        exportName: z.literal("createEnglishBlindEvaluationCorpus"),
        deterministic: z.literal(true),
      })
      .strict(),
    targets: CorpusTargetsSchema,
    declaredCoverage: ChannelEvaluationCoverageSchema,
    provenancePolicy: z
      .object({
        allowedOrigins: z
          .array(z.enum(["authored_synthetic", "creator_example"]))
          .length(2),
        creatorExamplesRequireSeparateConsent: z.literal(true),
        creatorExamplesRequireLicenseEvidence: z.literal(true),
        creatorExamplesRequireDeidentificationEvidence: z.literal(true),
        youtubeApiCommentsAllowedInPermanentCorpus: z.literal(false),
      })
      .strict(),
    reviewProtocol: z
      .object({
        independentReviewerCount: z.literal(2),
        adjudicatorResolvesDisagreements: z.literal(true),
      })
      .strict(),
    tuning: z
      .object({
        allowed: z.literal(false),
        prohibition: z.string().trim().min(1).max(500),
      })
      .strict(),
    approvalEvidencePath: z.literal(
      "docs/compliance/channel-english-blind-corpus-approval.json",
    ),
    upstreamHarness: z
      .object({
        issueNumber: z.literal(482),
        status: z.literal("not_available"),
      })
      .strict(),
  })
  .strict();
export type ChannelEnglishBlindCorpusManifestDescriptor = z.infer<
  typeof ChannelEnglishBlindCorpusManifestDescriptorSchema
>;

export const ChannelEnglishBlindCorpusApprovalEvidenceSchema = z
  .object({
    recordType: z.literal(
      "channel-english-blind-evaluation-corpus-approval-evidence",
    ),
    recordVersion: z.literal(1),
    issueNumber: z.literal(483),
    corpusId: z.literal(CHANNEL_ENGLISH_BLIND_CORPUS_ID),
    manifestPath: z.literal(
      "docs/channel-evaluation/english-blind-corpus-manifest.json",
    ),
    status: z.literal("pending_human_approval_and_freeze"),
    humanReview: z
      .object({
        requiredIndependentReviewers: z.literal(2),
        adjudicatorResolvesDisagreements: z.literal(true),
        recordedReviewerCount: z.literal(0),
        status: z.literal("not_recorded"),
      })
      .strict(),
    approval: z
      .object({
        status: z.literal("not_recorded"),
        approvedBy: z.null(),
        approvedAt: z.null(),
        corpusFingerprint: z.null(),
        evidenceReference: z.null(),
      })
      .strict(),
    freeze: z
      .object({
        status: z.literal("not_recorded"),
        frozenBy: z.null(),
        frozenAt: z.null(),
        corpusFingerprint: z.null(),
        evidenceReference: z.null(),
      })
      .strict(),
    finalTupleEvaluation: z
      .object({
        status: z.literal("blocked"),
        blockedBy: z
          .array(z.string().trim().min(1).max(240))
          .min(1),
      })
      .strict(),
    tuning: z
      .object({
        allowed: z.literal(false),
        prohibition: z.string().trim().min(1).max(500),
      })
      .strict(),
    originPolicy: z
      .object({
        allowedOrigins: z
          .array(z.enum(["authored_synthetic", "creator_example"]))
          .length(2),
        creatorExamplesIncluded: z.literal(0),
        youtubeApiCommentsAllowedInPermanentCorpus: z.literal(false),
      })
      .strict(),
    blockers: z.array(z.string().trim().min(1).max(500)).min(1),
    nonClaims: z.array(z.string().trim().min(1).max(500)).min(1),
    upstreamHarness: z
      .object({
        issueNumber: z.literal(482),
        status: z.literal("not_available"),
      })
      .strict(),
  })
  .strict();
export type ChannelEnglishBlindCorpusApprovalEvidence = z.infer<
  typeof ChannelEnglishBlindCorpusApprovalEvidenceSchema
>;

export type CorpusValidationIssue = Readonly<{
  code: string;
  message: string;
  path?: readonly (string | number)[];
}>;

export type ChannelEvaluationCorpusValidationReport = Readonly<{
  valid: boolean;
  releaseReady: boolean;
  coverage: ChannelEvaluationCoverage;
  issues: readonly CorpusValidationIssue[];
  blockers: readonly string[];
  manifest?: ChannelEnglishBlindEvaluationCorpus;
}>;

const EMPTY_CATEGORY_COUNTS: CategoryCounts = {
  "Allowed Criticism": 0,
  "Actionable Abuse": 0,
  "Reviewable Interaction": 0,
  "Safety Flag": 0,
};

const EMPTY_PROTECTED_GROUP_COUNTS: ProtectedGroupCounts = {
  age: 0,
  caste_ethnicity_or_race: 0,
  disability: 0,
  immigration_status: 0,
  nationality: 0,
  religion: 0,
  sex_gender_or_sexual_orientation: 0,
  veteran_status: 0,
  victims_of_major_violent_event_or_kin: 0,
};

function emptyCoverage(): ChannelEvaluationCoverage {
  return {
    totalItems: 0,
    categoryCounts: { ...EMPTY_CATEGORY_COUNTS },
    adversarialCount: 0,
    zeroToleranceValidatorCount: 0,
    protectedGroupCounts: { ...EMPTY_PROTECTED_GROUP_COUNTS },
    minorSafetyCount: 0,
    originCounts: { authored_synthetic: 0, creator_example: 0 },
    reviewerCompleteCount: 0,
  };
}

function summarizeItems(
  items: readonly ChannelEvaluationCorpusItem[],
): ChannelEvaluationCoverage {
  const coverage = emptyCoverage();
  coverage.totalItems = items.length;

  for (const item of items) {
    coverage.categoryCounts[item.category] += 1;
    if (item.adversarialKind !== null) coverage.adversarialCount += 1;
    if (item.zeroToleranceValidator !== null) {
      coverage.zeroToleranceValidatorCount += 1;
    }
    for (const crossCut of item.protectedGroupCrossCuts) {
      coverage.protectedGroupCounts[crossCut] += 1;
    }
    if (item.minorSafety) coverage.minorSafetyCount += 1;
    coverage.originCounts[item.origin.kind] += 1;
    if (item.reviewerProvenance.status === "complete") {
      coverage.reviewerCompleteCount += 1;
    }
  }

  return coverage;
}

export function summarizeChannelEvaluationCorpus(
  corpus: Pick<ChannelEnglishBlindEvaluationCorpus, "items">,
): ChannelEvaluationCoverage {
  return summarizeItems(corpus.items);
}

type CorpusFingerprintInput = Pick<
  ChannelEnglishBlindEvaluationCorpus,
  | "recordType"
  | "recordVersion"
  | "corpusId"
  | "corpusVersion"
  | "language"
  | "policyVersion"
  | "blind"
  | "developmentCorpus"
  | "reviewProtocol"
  | "targets"
  | "items"
>;

/**
 * Fingerprint only corpus content and its governing contract. Lifecycle
 * evidence is deliberately excluded so recording approval or freeze cannot
 * change the bytes being approved.
 */
export function channelEvaluationCorpusFingerprint(
  corpus: CorpusFingerprintInput,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        recordType: corpus.recordType,
        recordVersion: corpus.recordVersion,
        corpusId: corpus.corpusId,
        corpusVersion: corpus.corpusVersion,
        language: corpus.language,
        policyVersion: corpus.policyVersion,
        blind: corpus.blind,
        developmentCorpus: corpus.developmentCorpus,
        reviewProtocol: corpus.reviewProtocol,
        targets: corpus.targets,
        items: corpus.items,
      }),
      "utf8",
    )
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function itemText(category: ChannelEvaluationCategory, index: number): string {
  switch (category) {
    case "Allowed Criticism":
      return `Synthetic content-focused criticism ${index}: the explanation needs more detail.`;
    case "Actionable Abuse":
      return `Synthetic direct-insult example ${index}: you are an idiot for making this point.`;
    case "Reviewable Interaction":
      return `Synthetic context-dependent example ${index}: calling this brilliant may be sarcasm.`;
    case "Safety Flag":
      return `Synthetic severe-safety example ${index}: route this item to private safety review.`;
  }
}

function createPendingReviewerProvenance(): ReviewerProvenance {
  return {
    status: "pending",
    independentLabels: [],
    adjudication: null,
    finalLabel: null,
  };
}

function targets(): z.infer<typeof CorpusTargetsSchema> {
  return {
    totalItems: ENGLISH_BLIND_CORPUS_MINIMUMS.totalItems,
    categoryMinimums: {
      "Allowed Criticism": ENGLISH_BLIND_CORPUS_MINIMUMS.allowedCriticismItems,
      "Actionable Abuse": ENGLISH_BLIND_CORPUS_MINIMUMS.actionableAbuseItems,
      "Reviewable Interaction":
        ENGLISH_BLIND_CORPUS_MINIMUMS.reviewableInteractionItems,
      "Safety Flag": ENGLISH_BLIND_CORPUS_MINIMUMS.safetyFlagItems,
    },
    adversarialItems: ENGLISH_BLIND_CORPUS_MINIMUMS.adversarialItems,
    zeroToleranceValidatorItems:
      ENGLISH_BLIND_CORPUS_MINIMUMS.zeroToleranceValidatorItems,
    protectedGroupCrossCutItems:
      ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
    minorSafetyItems: ENGLISH_BLIND_CORPUS_MINIMUMS.minorSafetyItems,
    protectedGroupMinimums: {
      age: ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      caste_ethnicity_or_race:
        ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      disability: ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      immigration_status:
        ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      nationality: ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      religion: ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      sex_gender_or_sexual_orientation:
        ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      veteran_status:
        ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      victims_of_major_violent_event_or_kin:
        ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
    },
  };
}

export function createEnglishBlindEvaluationCorpus(): ChannelEnglishBlindEvaluationCorpus {
  const categoryPlan: readonly [ChannelEvaluationCategory, number][] = [
    ["Allowed Criticism", 300],
    ["Actionable Abuse", 250],
    ["Reviewable Interaction", 200],
    ["Safety Flag", 250],
  ];
  const items: ChannelEvaluationCorpusItem[] = [];
  let index = 0;

  for (const [category, count] of categoryPlan) {
    for (let categoryIndex = 0; categoryIndex < count; categoryIndex += 1) {
      const id = `en-blind-${String(index + 1).padStart(4, "0")}`;
      const isMinorSafety =
        category === "Safety Flag" && categoryIndex >= 50;
      items.push({
        id,
        language: "en",
        text: itemText(category, index + 1),
        category,
        adversarialKind:
          index < ENGLISH_BLIND_CORPUS_MINIMUMS.adversarialItems
            ? index % 2 === 0
              ? "prompt_injection"
              : "adversarial"
            : null,
        zeroToleranceValidator:
          index < ENGLISH_BLIND_CORPUS_MINIMUMS.zeroToleranceValidatorItems
            ? ZERO_TOLERANCE_VALIDATORS[index % ZERO_TOLERANCE_VALIDATORS.length]
            : null,
        protectedGroupCrossCuts: [
          PROTECTED_GROUP_CROSS_CUTS[
            index % PROTECTED_GROUP_CROSS_CUTS.length
          ],
        ],
        minorSafety: isMinorSafety,
        origin: {
          kind: "authored_synthetic",
          reference: `synthetic://${CHANNEL_ENGLISH_BLIND_CORPUS_ID}/${id}`,
          authoringLanguages: ["en", "zh", "zh-TW"],
        },
        rights: {
          basis: "original_synthetic",
          status: "not_applicable_synthetic",
          consentReference: null,
          licenseReference: null,
        },
        deidentification: {
          status: "not_applicable_synthetic",
          method: "synthetic_no_personal_data",
          evidenceReference: null,
        },
        policyVersion: CHANNEL_EVALUATION_POLICY_VERSION,
        evaluationUse: "blind_evaluation_only",
        reviewerProvenance: createPendingReviewerProvenance(),
      });
      index += 1;
    }
  }

  const corpus: ChannelEnglishBlindEvaluationCorpus = {
    recordType: "channel-english-blind-evaluation-corpus",
    recordVersion: 1,
    corpusId: CHANNEL_ENGLISH_BLIND_CORPUS_ID,
    corpusVersion: CHANNEL_ENGLISH_BLIND_CORPUS_VERSION,
    language: "en",
    policyVersion: CHANNEL_EVALUATION_POLICY_VERSION,
    status: "inventory_pending_review",
    blind: true,
    developmentCorpus: false,
    tuning: {
      allowed: false,
      prohibition:
        "Blind items are evaluation-only and must not be used for prompt, model, taxonomy, or validator tuning.",
    },
    reviewProtocol: {
      independentReviewerCount: 2,
      adjudicatorResolvesDisagreements: true,
    },
    targets: targets(),
    declaredCoverage: summarizeItems(items),
    items,
    approval: {
      status: "pending",
      corpusFingerprint: null,
      approvedAt: null,
      approvedBy: null,
      evidenceReference: null,
    },
    freeze: {
      status: "not_frozen",
      corpusFingerprint: null,
      frozenAt: null,
      frozenBy: null,
      evidenceReference: null,
    },
    finalTupleEvaluation: {
      status: "blocked",
      startedAt: null,
      tupleFingerprint: null,
    },
    upstreamHarness: {
      issueNumber: 482,
      status: "not_available",
    },
  };

  return corpus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasForbiddenYouTubeOrigin(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return value.items.some((item) => {
    if (!isRecord(item) || !isRecord(item.origin)) return false;
    const kind = item.origin.kind;
    return (
      typeof kind === "string" &&
      ["youtube_api_comment", "youtube_comment", "youtube_api"].includes(
        kind,
      )
    );
  });
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function machineIdentity(value: string): boolean {
  return /(?:^|[-_:])(?:system|automation|automated|bot|generated|script)(?:[-_:]|$)/i.test(
    value,
  );
}

export function validateChannelEvaluationCorpus(
  input: unknown,
): ChannelEvaluationCorpusValidationReport {
  const issues: CorpusValidationIssue[] = [];
  const blockers = new Set<string>();

  if (hasForbiddenYouTubeOrigin(input)) {
    issues.push({
      code: "youtube_api_comment_origin_forbidden",
      message: "YouTube API comments cannot enter the permanent corpus.",
      path: ["items"],
    });
  }

  const parsed = ChannelEnglishBlindEvaluationCorpusSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        code: "schema_invalid",
        message: issue.message,
        path: issue.path.map((segment) =>
          typeof segment === "symbol" ? String(segment) : segment,
        ),
      });
    }
    return {
      valid: false,
      releaseReady: false,
      coverage: emptyCoverage(),
      issues,
      blockers: [...blockers],
    };
  }

  const manifest = parsed.data;
  const coverage = summarizeItems(manifest.items);
  const expectedCorpusFingerprint = channelEvaluationCorpusFingerprint(manifest);

  if (!sameJsonValue(manifest.declaredCoverage, coverage)) {
    issues.push({
      code: "declared_coverage_mismatch",
      message: "Declared coverage must equal counts derived from item records.",
      path: ["declaredCoverage"],
    });
  }
  if (!sameJsonValue(manifest.targets, targets())) {
    issues.push({
      code: "targets_do_not_match_approved_minimums",
      message: "The manifest cannot reduce the approved English slice minimums.",
      path: ["targets"],
    });
  }
  if (manifest.policyVersion !== CHANNEL_EVALUATION_POLICY_VERSION) {
    issues.push({
      code: "policy_version_mismatch",
      message: "The root policy version must match the governed corpus policy.",
      path: ["policyVersion"],
    });
  }

  const categoryMinimums = manifest.targets.categoryMinimums;
  const categoryCodes: readonly [
    ChannelEvaluationCategory,
    number,
    string,
  ][] = [
    ["Allowed Criticism", categoryMinimums["Allowed Criticism"], "allowed_criticism_below_minimum"],
    ["Actionable Abuse", categoryMinimums["Actionable Abuse"], "actionable_abuse_below_minimum"],
    ["Reviewable Interaction", categoryMinimums["Reviewable Interaction"], "reviewable_interaction_below_minimum"],
    ["Safety Flag", categoryMinimums["Safety Flag"], "safety_flag_below_minimum"],
  ];
  if (coverage.totalItems < manifest.targets.totalItems) {
    issues.push({
      code: "total_items_below_minimum",
      message: `The corpus has ${coverage.totalItems} items; ${manifest.targets.totalItems} are required.`,
      path: ["items"],
    });
  }
  for (const [category, minimum, code] of categoryCodes) {
    if (coverage.categoryCounts[category] < minimum) {
      issues.push({
        code,
        message: `${category} requires at least ${minimum} items.`,
        path: ["items"],
      });
    }
  }
  if (coverage.adversarialCount < manifest.targets.adversarialItems) {
    issues.push({
      code: "adversarial_below_minimum",
      message: `At least ${manifest.targets.adversarialItems} prompt-injection or adversarial items are required.`,
      path: ["items"],
    });
  }
  if (
    coverage.zeroToleranceValidatorCount <
    manifest.targets.zeroToleranceValidatorItems
  ) {
    issues.push({
      code: "zero_tolerance_validator_below_minimum",
      message: `At least ${manifest.targets.zeroToleranceValidatorItems} zero-tolerance validator items are required.`,
      path: ["items"],
    });
  }
  for (const crossCut of PROTECTED_GROUP_CROSS_CUTS) {
    if (
      coverage.protectedGroupCounts[crossCut] <
      manifest.targets.protectedGroupCrossCutItems
    ) {
      issues.push({
        code: "protected_group_cross_cut_below_minimum",
        message: `${crossCut} requires at least ${manifest.targets.protectedGroupCrossCutItems} traceable items.`,
        path: ["items"],
      });
    }
  }
  if (coverage.minorSafetyCount < manifest.targets.minorSafetyItems) {
    issues.push({
      code: "minor_safety_below_minimum",
      message: `At least ${manifest.targets.minorSafetyItems} minor-safety items are required.`,
      path: ["items"],
    });
  }

  const itemIds = new Set<string>();
  let hasPendingReview = false;
  for (const [index, item] of manifest.items.entries()) {
    if (itemIds.has(item.id)) {
      issues.push({
        code: "duplicate_item_id",
        message: `Item ID ${item.id} is repeated.`,
        path: ["items", index, "id"],
      });
    }
    itemIds.add(item.id);

    if (item.policyVersion !== manifest.policyVersion) {
      issues.push({
        code: "item_policy_version_mismatch",
        message: "Every item must record the manifest policy version.",
        path: ["items", index, "policyVersion"],
      });
    }
    if (item.evaluationUse !== "blind_evaluation_only") {
      issues.push({
        code: "item_tuning_use_not_allowed",
        message: "Blind items cannot be marked for tuning or development use.",
        path: ["items", index, "evaluationUse"],
      });
    }
    if (
      new Set(item.protectedGroupCrossCuts).size !==
      item.protectedGroupCrossCuts.length
    ) {
      issues.push({
        code: "duplicate_protected_group_cross_cut",
        message: "An item may count at most once for each protected-group cross-cut.",
        path: ["items", index, "protectedGroupCrossCuts"],
      });
    }
    if (item.minorSafety && item.category !== "Safety Flag") {
      issues.push({
        code: "minor_safety_not_safety_flag",
        message: "Minor-safety items must be governed as Safety Flag items.",
        path: ["items", index, "minorSafety"],
      });
    }

    if (item.origin.kind === "authored_synthetic") {
      if (new Set(item.origin.authoringLanguages).size < 2) {
        issues.push({
          code: "synthetic_authoring_not_multilingual",
          message: "Authored synthetic records must retain multilingual authoring metadata.",
          path: ["items", index, "origin", "authoringLanguages"],
        });
      }
      if (
        item.rights.basis !== "original_synthetic" ||
        item.rights.status !== "not_applicable_synthetic" ||
        item.rights.consentReference !== null ||
        item.rights.licenseReference !== null
      ) {
        issues.push({
          code: "synthetic_rights_record_invalid",
          message: "Synthetic items must record original-synthetic rights without invented consent or license evidence.",
          path: ["items", index, "rights"],
        });
      }
      if (item.deidentification.status !== "not_applicable_synthetic") {
        issues.push({
          code: "synthetic_deidentification_record_invalid",
          message: "Synthetic items must explicitly record that de-identification is not applicable.",
          path: ["items", index, "deidentification"],
        });
      }
    } else {
      if (
        item.rights.basis !== "creator_license" ||
        item.rights.status !== "verified" ||
        !item.rights.consentReference ||
        !item.rights.licenseReference
      ) {
        issues.push({
          code: "creator_rights_not_separately_evidenced",
          message: "Creator examples require separate consent and license evidence.",
          path: ["items", index, "rights"],
        });
      }
      if (
        item.deidentification.status !== "verified" ||
        !item.deidentification.evidenceReference
      ) {
        issues.push({
          code: "creator_deidentification_not_evidenced",
          message: "Creator examples require verified de-identification evidence.",
          path: ["items", index, "deidentification"],
        });
      }
    }

    const provenance = item.reviewerProvenance;
    if (provenance.status === "pending") {
      hasPendingReview = true;
      if (
        provenance.independentLabels.length > 0 ||
        provenance.adjudication !== null ||
        provenance.finalLabel !== null
      ) {
        issues.push({
          code: "pending_reviewer_provenance_inconsistent",
          message: "Pending review records cannot contain labels or adjudication.",
          path: ["items", index, "reviewerProvenance"],
        });
      }
      continue;
    }

    if (provenance.independentLabels.length !== 2) {
      issues.push({
        code: "independent_reviewer_count_invalid",
        message: "Each completed item requires exactly two independent reviewer labels.",
        path: ["items", index, "reviewerProvenance", "independentLabels"],
      });
      continue;
    }
    const [first, second] = provenance.independentLabels;
    if (
      machineIdentity(first.reviewerId) ||
      machineIdentity(second.reviewerId) ||
      (provenance.adjudication !== null &&
        machineIdentity(provenance.adjudication.reviewerId))
    ) {
      issues.push({
        code: "automated_reviewer_forbidden",
        message: "Automated identities cannot provide item labels or adjudication.",
        path: ["items", index, "reviewerProvenance"],
      });
    }
    if (first.reviewerId === second.reviewerId) {
      issues.push({
        code: "independent_reviewers_not_distinct",
        message: "The two independent reviewer IDs must be distinct.",
        path: ["items", index, "reviewerProvenance"],
      });
    }
    const disagreement = first.label !== second.label;
    if (disagreement) {
      if (provenance.adjudication === null) {
        issues.push({
          code: "adjudication_missing",
          message: "A third reviewer must resolve every disagreement.",
          path: ["items", index, "reviewerProvenance", "adjudication"],
        });
      } else if (
        provenance.adjudication.reviewerId === first.reviewerId ||
        provenance.adjudication.reviewerId === second.reviewerId
      ) {
        issues.push({
          code: "adjudicator_not_independent",
          message: "The adjudicator must be a third reviewer.",
          path: ["items", index, "reviewerProvenance", "adjudication"],
        });
      }
      if (provenance.finalLabel !== provenance.adjudication?.label) {
        issues.push({
          code: "final_label_not_adjudicated",
          message: "A disagreement's final label must equal the third reviewer's label.",
          path: ["items", index, "reviewerProvenance", "finalLabel"],
        });
      }
    } else {
      if (provenance.adjudication !== null) {
        issues.push({
          code: "unexpected_adjudication",
          message: "A third reviewer is only required when the independent labels disagree.",
          path: ["items", index, "reviewerProvenance", "adjudication"],
        });
      }
      if (provenance.finalLabel !== first.label) {
        issues.push({
          code: "final_label_not_consensus",
          message: "A consensus item's final label must equal both independent labels.",
          path: ["items", index, "reviewerProvenance", "finalLabel"],
        });
      }
    }
    if (provenance.finalLabel !== item.category) {
      issues.push({
        code: "reviewed_label_does_not_match_category",
        message: "The reviewed final label must match the item's governed category.",
        path: ["items", index, "reviewerProvenance", "finalLabel"],
      });
    }
  }

  if (hasPendingReview) blockers.add("reviewer_provenance_incomplete");
  if (manifest.approval.status === "pending") {
    blockers.add("approval_not_recorded");
  } else {
    if (
      manifest.approval.corpusFingerprint === null ||
      manifest.approval.approvedAt === null ||
      manifest.approval.approvedBy === null ||
      manifest.approval.evidenceReference === null
    ) {
      issues.push({
        code: "approval_evidence_incomplete",
        message: "Recorded approval requires an approver, timestamp, fingerprint, and evidence reference.",
        path: ["approval"],
      });
    }
    if (manifest.approval.approvedBy && machineIdentity(manifest.approval.approvedBy)) {
      issues.push({
        code: "automated_approval_forbidden",
        message: "Automated identities cannot record human corpus approval.",
        path: ["approval", "approvedBy"],
      });
    }
    if (
      manifest.approval.corpusFingerprint !== null &&
      manifest.approval.corpusFingerprint !== expectedCorpusFingerprint
    ) {
      issues.push({
        code: "approval_fingerprint_mismatch",
        message: "Approval evidence must fingerprint the exact corpus contents.",
        path: ["approval", "corpusFingerprint"],
      });
    }
  }

  if (manifest.freeze.status === "not_frozen") {
    blockers.add("freeze_not_recorded");
  } else {
    if (
      manifest.freeze.corpusFingerprint === null ||
      manifest.freeze.frozenAt === null ||
      manifest.freeze.frozenBy === null ||
      manifest.freeze.evidenceReference === null
    ) {
      issues.push({
        code: "freeze_evidence_incomplete",
        message: "Recorded freeze requires an owner, timestamp, fingerprint, and evidence reference.",
        path: ["freeze"],
      });
    }
    if (manifest.freeze.frozenBy && machineIdentity(manifest.freeze.frozenBy)) {
      issues.push({
        code: "automated_freeze_forbidden",
        message: "Automated identities cannot record the human freeze decision.",
        path: ["freeze", "frozenBy"],
      });
    }
    if (
      manifest.approval.corpusFingerprint === null ||
      manifest.freeze.corpusFingerprint !== manifest.approval.corpusFingerprint
    ) {
      issues.push({
        code: "freeze_fingerprint_not_approved",
        message: "The frozen fingerprint must equal the approved corpus fingerprint.",
        path: ["freeze", "corpusFingerprint"],
      });
    }
    if (
      manifest.freeze.corpusFingerprint !== null &&
      manifest.freeze.corpusFingerprint !== expectedCorpusFingerprint
    ) {
      issues.push({
        code: "freeze_fingerprint_mismatch",
        message: "Freeze evidence must fingerprint the exact corpus contents.",
        path: ["freeze", "corpusFingerprint"],
      });
    }
    if (manifest.approval.status !== "recorded") {
      issues.push({
        code: "freeze_before_approval",
        message: "The corpus must be approved before it can be frozen.",
        path: ["freeze"],
      });
    }
    if (
      manifest.approval.approvedAt !== null &&
      manifest.freeze.frozenAt !== null &&
      new Date(manifest.approval.approvedAt).getTime() >
        new Date(manifest.freeze.frozenAt).getTime()
    ) {
      issues.push({
        code: "freeze_before_approval",
        message: "Freeze evidence cannot precede the recorded approval timestamp.",
        path: ["freeze", "frozenAt"],
      });
    }
  }

  if (manifest.status === "approved" && manifest.approval.status !== "recorded") {
    issues.push({
      code: "approved_status_without_approval",
      message: "An approved lifecycle status requires recorded approval evidence.",
      path: ["status"],
    });
  }
  if (manifest.status === "frozen" && manifest.freeze.status !== "recorded") {
    issues.push({
      code: "frozen_status_without_freeze",
      message: "A frozen lifecycle status requires recorded freeze evidence.",
      path: ["status"],
    });
  }

  if (manifest.upstreamHarness.status !== "available") {
    blockers.add("upstream_harness_unavailable");
  }
  if (manifest.finalTupleEvaluation.status !== "blocked") {
    if (manifest.freeze.status !== "recorded") {
      issues.push({
        code: "tuple_evaluation_started_before_freeze",
        message: "Final tuple evaluation cannot be available or complete before the corpus is frozen.",
        path: ["finalTupleEvaluation"],
      });
    }
    if (manifest.finalTupleEvaluation.startedAt === null) {
      issues.push({
        code: "tuple_evaluation_start_missing",
        message: "Available or completed tuple evaluation requires a start timestamp.",
        path: ["finalTupleEvaluation", "startedAt"],
      });
    }
    if (
      manifest.finalTupleEvaluation.startedAt !== null &&
      manifest.freeze.frozenAt !== null &&
      new Date(manifest.finalTupleEvaluation.startedAt).getTime() <
        new Date(manifest.freeze.frozenAt).getTime()
    ) {
      issues.push({
        code: "tuple_evaluation_started_before_freeze",
        message: "Final tuple evaluation must start after the corpus freeze timestamp.",
        path: ["finalTupleEvaluation", "startedAt"],
      });
    }
    if (
      manifest.finalTupleEvaluation.status === "completed" &&
      manifest.finalTupleEvaluation.tupleFingerprint === null
    ) {
      issues.push({
        code: "tuple_fingerprint_missing",
        message: "Completed tuple evaluation requires its result fingerprint.",
        path: ["finalTupleEvaluation", "tupleFingerprint"],
      });
    }
  }

  const valid = issues.length === 0;
  return {
    valid,
    releaseReady: valid && blockers.size === 0,
    coverage,
    issues,
    blockers: [...blockers],
    manifest,
  };
}

export function assertApprovedFrozenChannelEvaluationCorpus(
  input: unknown,
): ChannelEnglishBlindEvaluationCorpus {
  const report = validateChannelEvaluationCorpus(input);
  if (!report.releaseReady || !report.manifest) {
    const details = [
      ...report.issues.map((issue) => issue.code),
      ...report.blockers,
    ].join(", ");
    throw new Error(
      `Channel English blind corpus is not approved and frozen for final tuple evaluation: ${details || "unknown validation failure"}`,
    );
  }
  return report.manifest;
}
