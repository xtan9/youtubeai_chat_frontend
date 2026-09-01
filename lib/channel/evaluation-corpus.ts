import { createHash } from "node:crypto";
import { z } from "zod";

export const CHANNEL_BLIND_CORPUS_MANIFEST_VERSION = 1 as const;
export const CHANNEL_BLIND_CORPUS_RECORD_TYPE =
  "channel-evaluation-corpus-manifest" as const;
export const SIMPLIFIED_CHINESE_CORPUS_LANGUAGE =
  "simplified_chinese" as const;
export const SIMPLIFIED_CHINESE_CORPUS_LANGUAGE_TAG = "zh-Hans" as const;

export const PROTECTED_GROUP_CROSS_CUTS = [
  "age",
  "caste_ethnicity_race",
  "disability",
  "immigration_status",
  "nationality",
  "religion",
  "sex_gender_or_sexual_orientation",
  "veteran_status",
  "major_violent_event_victims_or_kin",
] as const;

export type ProtectedGroupCrossCut =
  (typeof PROTECTED_GROUP_CROSS_CUTS)[number];

export const ZERO_TOLERANCE_VALIDATOR_CLASSES = [
  "privacy",
  "threat",
  "impersonation",
  "diagnosis",
  "spam",
  "malicious_link",
  "instruction_echo",
] as const;

export type ZeroToleranceValidatorClass =
  (typeof ZERO_TOLERANCE_VALIDATOR_CLASSES)[number];

export const CHANNEL_BLIND_CORPUS_REQUIREMENTS = {
  minimumBlindItems: 1_000,
  strata: {
    allowed_criticism: 300,
    actionable_abuse: 250,
    reviewable_interaction: 200,
    safety_flag: 200,
    prompt_injection_adversarial: 50,
  },
  minimumZeroToleranceValidatorItems: 250,
  minimumProtectedGroupCrossCutItems: 100,
  minimumMinorSafetyItems: 200,
} as const;

export const BlindCorpusStratumSchema = z.enum([
  "allowed_criticism",
  "actionable_abuse",
  "reviewable_interaction",
  "safety_flag",
  "prompt_injection_adversarial",
]);
export type BlindCorpusStratum = z.infer<typeof BlindCorpusStratumSchema>;

export const BlindCorpusClassificationSchema = z.enum([
  "allowed_criticism",
  "actionable_abuse",
  "reviewable_interaction",
  "safety_flag",
]);
export type BlindCorpusClassification = z.infer<
  typeof BlindCorpusClassificationSchema
>;

const CorpusReviewLabelSchema = z.union([
  BlindCorpusClassificationSchema,
  z.literal("reject"),
]);
type CorpusReviewLabel = z.infer<typeof CorpusReviewLabelSchema>;

const IdentifierSchema = z.string().trim().min(1).max(160);
const ReferenceSchema = z.string().trim().min(1).max(320);
const TimestampSchema = z.string().datetime({ offset: true });
const PolicyVersionSchema = z.string().trim().min(1).max(120);

export const ProtectedGroupCrossCutSchema = z.enum(
  PROTECTED_GROUP_CROSS_CUTS,
);

const ProtectedGroupCrossCutListSchema = z
  .array(ProtectedGroupCrossCutSchema)
  .max(PROTECTED_GROUP_CROSS_CUTS.length)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: "custom",
        message: "duplicate protected-group cross-cut",
      });
    }
  });

const OriginSchema = z
  .object({
    kind: z.enum([
      "authored_synthetic",
      "consented_deidentified",
      "licensed_deidentified",
    ]),
    reference: ReferenceSchema,
    youtubeApiData: z.boolean(),
  })
  .strict();

const RightsSchema = z
  .object({
    status: z.enum(["synthetic", "consented", "licensed"]),
    basis: ReferenceSchema,
    evidenceRef: ReferenceSchema.nullable(),
  })
  .strict();

const DeIdentificationSchema = z
  .object({
    status: z.enum(["not_applicable_synthetic", "verified"]),
    method: ReferenceSchema,
    evidenceRef: ReferenceSchema.nullable(),
  })
  .strict();

const IndependentReviewSchema = z
  .object({
    reviewerId: IdentifierSchema,
    assignmentId: IdentifierSchema,
    role: z.literal("independent"),
    label: CorpusReviewLabelSchema,
    reviewedAt: TimestampSchema,
  })
  .strict();

const AdjudicationSchema = z
  .object({
    reviewerId: IdentifierSchema,
    role: z.literal("adjudicator"),
    label: CorpusReviewLabelSchema,
    reviewedAt: TimestampSchema,
    rationaleRef: ReferenceSchema,
  })
  .strict();

export const CorpusReviewerProvenanceSchema = z
  .object({
    protocolVersion: IdentifierSchema,
    independentReviews: z.array(IndependentReviewSchema).length(2),
    adjudication: AdjudicationSchema.nullable(),
  })
  .strict();

const CommonCorpusItemSchema = z.object({
  id: IdentifierSchema,
  language: z.literal(SIMPLIFIED_CHINESE_CORPUS_LANGUAGE),
  text: z.string().trim().min(1).max(4_000),
  origin: OriginSchema,
  rights: RightsSchema,
  deIdentification: DeIdentificationSchema,
  policyVersion: PolicyVersionSchema,
  reviewerProvenance: CorpusReviewerProvenanceSchema,
});

export const BlindCorpusItemSchema = CommonCorpusItemSchema.extend({
  stratum: BlindCorpusStratumSchema,
  expectedClassification: BlindCorpusClassificationSchema,
  protectedGroupCrossCuts: ProtectedGroupCrossCutListSchema,
  minorSafety: z.boolean(),
}).strict();
export type BlindCorpusItem = z.infer<typeof BlindCorpusItemSchema>;

export const ZeroToleranceValidatorItemSchema = CommonCorpusItemSchema.extend({
  validatorClass: z.enum(ZERO_TOLERANCE_VALIDATOR_CLASSES),
  expectedOutcome: z.literal("reject"),
}).strict();
export type ZeroToleranceValidatorItem = z.infer<
  typeof ZeroToleranceValidatorItemSchema
>;

const BlindStratumCountsSchema = z
  .object({
    allowed_criticism: z.number().int().min(0),
    actionable_abuse: z.number().int().min(0),
    reviewable_interaction: z.number().int().min(0),
    safety_flag: z.number().int().min(0),
    prompt_injection_adversarial: z.number().int().min(0),
  })
  .strict();

const ValidatorClassCountsSchema = z
  .object({
    privacy: z.number().int().min(0),
    threat: z.number().int().min(0),
    impersonation: z.number().int().min(0),
    diagnosis: z.number().int().min(0),
    spam: z.number().int().min(0),
    malicious_link: z.number().int().min(0),
    instruction_echo: z.number().int().min(0),
  })
  .strict();

const ProtectedGroupCrossCutCountsSchema = z
  .object({
    age: z.number().int().min(0),
    caste_ethnicity_race: z.number().int().min(0),
    disability: z.number().int().min(0),
    immigration_status: z.number().int().min(0),
    nationality: z.number().int().min(0),
    religion: z.number().int().min(0),
    sex_gender_or_sexual_orientation: z.number().int().min(0),
    veteran_status: z.number().int().min(0),
    major_violent_event_victims_or_kin: z.number().int().min(0),
  })
  .strict();

const ReportedCountsSchema = z
  .object({
    blindTotal: z.number().int().min(0),
    blindByStratum: BlindStratumCountsSchema,
    zeroToleranceValidatorTotal: z.number().int().min(0),
    zeroToleranceByClass: ValidatorClassCountsSchema,
    protectedGroupCrossCuts: ProtectedGroupCrossCutCountsSchema,
    minorSafety: z.number().int().min(0),
  })
  .strict();

const StoragePolicySchema = z
  .object({
    content: z.string().trim().min(1).max(120),
    youtubeApiCommentsPermanentCorpus: z.string().trim().min(1).max(80),
    trainingUse: z.string().trim().min(1).max(80),
    allowedUse: z.string().trim().min(1).max(120),
  })
  .strict();

const ReviewProtocolSchema = z
  .object({
    protocolVersion: IdentifierSchema,
    independentReviewerCount: z.literal(2),
    adjudicatorCount: z.literal(1),
    adjudicationRequiredOnDisagreement: z.literal(true),
  })
  .strict();

const RequirementsSchema = z
  .object({
    minimumBlindItems: z.literal(
      CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumBlindItems,
    ),
    strata: z
      .object({
        allowed_criticism: z.literal(
          CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata.allowed_criticism,
        ),
        actionable_abuse: z.literal(
          CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata.actionable_abuse,
        ),
        reviewable_interaction: z.literal(
          CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata.reviewable_interaction,
        ),
        safety_flag: z.literal(
          CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata.safety_flag,
        ),
        prompt_injection_adversarial: z.literal(
          CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata
            .prompt_injection_adversarial,
        ),
      })
      .strict(),
    minimumZeroToleranceValidatorItems: z.literal(
      CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumZeroToleranceValidatorItems,
    ),
    minimumProtectedGroupCrossCutItems: z.literal(
      CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumProtectedGroupCrossCutItems,
    ),
    minimumMinorSafetyItems: z.literal(
      CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumMinorSafetyItems,
    ),
  })
  .strict();

const ApprovalSchema = z
  .object({
    status: z.enum(["pending_human_approval", "approved"]),
    approvedBy: z
      .object({
        kind: z.literal("human"),
        reviewerId: IdentifierSchema,
      })
      .strict()
      .nullable(),
    approvedAt: TimestampSchema.nullable(),
    evidenceRef: ReferenceSchema.nullable(),
  })
  .strict();

const FreezeSchema = z
  .object({
    status: z.enum(["not_frozen", "frozen"]),
    frozenBy: IdentifierSchema.nullable(),
    frozenAt: TimestampSchema.nullable(),
    manifestDigest: z.string().trim().nullable(),
    sourceRevision: z.string().trim().nullable(),
    frozenBeforeFinalTupleEvaluation: z.boolean(),
    evidenceRef: ReferenceSchema.nullable(),
  })
  .strict();

const UpstreamHarnessSchema = z
  .object({
    issueNumber: z.literal(482),
    status: z.enum(["blocked_by_issue_482", "available"]),
    evidenceRef: ReferenceSchema.nullable(),
  })
  .strict();

const NegativeControlsSchema = z
  .object({
    licensedExamplesCheckedIn: z.boolean(),
    humanApprovalsFabricated: z.literal(false),
    youtubeApiCommentsScrapedIntoPermanentCorpus: z.literal(false),
    blindCorpusAvailableForTuning: z.literal(false),
  })
  .strict();

export const SimplifiedChineseBlindCorpusApprovalFreezeEvidenceSchema = z
  .object({
    recordType: z.literal(
      "channel-evaluation-corpus-approval-freeze-evidence",
    ),
    recordVersion: z.literal(1),
    issueNumber: z.literal(484),
    language: z.literal(SIMPLIFIED_CHINESE_CORPUS_LANGUAGE),
    manifestPath: z.literal(
      "docs/evaluation/channel/simplified-chinese-blind-corpus.manifest.json",
    ),
    status: z.enum(["blocked", "ready"]),
    approval: z
      .object({
        status: z.enum(["not_evidenced", "evidenced"]),
        evidenceRef: ReferenceSchema.nullable(),
        reason: ReferenceSchema,
      })
      .strict(),
    freeze: z
      .object({
        status: z.enum(["not_evidenced", "evidenced"]),
        evidenceRef: ReferenceSchema.nullable(),
        reason: ReferenceSchema,
      })
      .strict(),
    upstreamHarness: UpstreamHarnessSchema,
    negativeControls: NegativeControlsSchema,
  })
  .strict();
export type SimplifiedChineseBlindCorpusApprovalFreezeEvidence = z.infer<
  typeof SimplifiedChineseBlindCorpusApprovalFreezeEvidenceSchema
>;

export const SimplifiedChineseBlindCorpusManifestSchema = z
  .object({
    recordType: z.literal(CHANNEL_BLIND_CORPUS_RECORD_TYPE),
    recordVersion: z.literal(CHANNEL_BLIND_CORPUS_MANIFEST_VERSION),
    issueNumber: z.literal(484),
    language: z.literal(SIMPLIFIED_CHINESE_CORPUS_LANGUAGE),
    languageTag: z.literal(SIMPLIFIED_CHINESE_CORPUS_LANGUAGE_TAG),
    policyVersion: PolicyVersionSchema,
    purpose: z.literal("blind_tuple_evaluation"),
    storage: StoragePolicySchema,
    reviewProtocol: ReviewProtocolSchema,
    requirements: RequirementsSchema,
    blindItems: z.array(BlindCorpusItemSchema).max(5_000),
    zeroToleranceValidatorItems: z
      .array(ZeroToleranceValidatorItemSchema)
      .max(2_000),
    reportedCounts: ReportedCountsSchema,
    approval: ApprovalSchema,
    freeze: FreezeSchema,
    upstreamHarness: UpstreamHarnessSchema,
  })
  .strict();

export type SimplifiedChineseBlindCorpusManifest = z.infer<
  typeof SimplifiedChineseBlindCorpusManifestSchema
>;

export type CorpusGovernanceIssueCode =
  | "manifest_schema_invalid"
  | "language_mismatch"
  | "policy_version_unavailable"
  | "corpus_storage_policy_invalid"
  | "duplicate_item_id"
  | "item_language_mismatch"
  | "item_policy_version_mismatch"
  | "item_stratum_label_mismatch"
  | "minor_safety_label_mismatch"
  | "youtube_api_data_prohibited"
  | "origin_rights_mismatch"
  | "rights_evidence_missing"
  | "de_identification_evidence_missing"
  | "review_protocol_version_mismatch"
  | "independent_reviewers_not_distinct"
  | "independent_assignments_not_distinct"
  | "review_label_mismatch"
  | "adjudication_required"
  | "adjudication_unexpected"
  | "adjudication_reviewer_not_distinct"
  | "adjudication_label_mismatch"
  | "reported_count_mismatch"
  | "blind_items_below_minimum"
  | "blind_stratum_below_minimum"
  | "zero_tolerance_items_below_minimum"
  | "protected_group_cross_cut_below_minimum"
  | "minor_safety_items_below_minimum"
  | "approval_not_evidenced"
  | "freeze_not_evidenced"
  | "freeze_requires_approval"
  | "freeze_order_not_evidenced"
  | "freeze_source_revision_invalid"
  | "freeze_digest_mismatch"
  | "upstream_harness_blocked"
  | "upstream_harness_evidence_missing";

export type CorpusGovernanceIssue = Readonly<{
  code: CorpusGovernanceIssueCode;
  path: readonly (string | number)[];
  message: string;
}>;

export type SimplifiedChineseBlindCorpusCounts = Readonly<{
  blindTotal: number;
  blindByStratum: Readonly<Record<BlindCorpusStratum, number>>;
  zeroToleranceValidatorTotal: number;
  zeroToleranceByClass: Readonly<
    Record<ZeroToleranceValidatorClass, number>
  >;
  protectedGroupCrossCuts: Readonly<Record<ProtectedGroupCrossCut, number>>;
  minorSafety: number;
}>;

export type SimplifiedChineseBlindCorpusValidation = Readonly<{
  status: "ready" | "blocked";
  counts: SimplifiedChineseBlindCorpusCounts;
  issues: readonly CorpusGovernanceIssue[];
}>;

export type SimplifiedChineseBlindCorpusUse =
  | "final_tuple_evaluation"
  | "tuning";

export type SimplifiedChineseBlindCorpusUseDecision = Readonly<{
  allowed: boolean;
  reason: string;
}>;

function emptyCounts(): SimplifiedChineseBlindCorpusCounts {
  return {
    blindTotal: 0,
    blindByStratum: {
      allowed_criticism: 0,
      actionable_abuse: 0,
      reviewable_interaction: 0,
      safety_flag: 0,
      prompt_injection_adversarial: 0,
    },
    zeroToleranceValidatorTotal: 0,
    zeroToleranceByClass: {
      privacy: 0,
      threat: 0,
      impersonation: 0,
      diagnosis: 0,
      spam: 0,
      malicious_link: 0,
      instruction_echo: 0,
    },
    protectedGroupCrossCuts: {
      age: 0,
      caste_ethnicity_race: 0,
      disability: 0,
      immigration_status: 0,
      nationality: 0,
      religion: 0,
      sex_gender_or_sexual_orientation: 0,
      veteran_status: 0,
      major_violent_event_victims_or_kin: 0,
    },
    minorSafety: 0,
  };
}

function addIssue(
  issues: CorpusGovernanceIssue[],
  code: CorpusGovernanceIssueCode,
  path: readonly (string | number)[],
  message: string,
): void {
  issues.push({ code, path, message });
}

function parseManifest(input: unknown):
  | { success: true; data: SimplifiedChineseBlindCorpusManifest }
  | { success: false; issues: readonly CorpusGovernanceIssue[] } {
  const parsed = SimplifiedChineseBlindCorpusManifestSchema.safeParse(input);
  if (parsed.success) return parsed;

  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      code: "manifest_schema_invalid" as const,
      path: issue.path.filter(
        (part): part is string | number =>
          typeof part === "string" || typeof part === "number",
      ),
      message: issue.message,
    })),
  };
}

function countItems(
  manifest: SimplifiedChineseBlindCorpusManifest,
): SimplifiedChineseBlindCorpusCounts {
  const counts = emptyCounts();
  const blindByStratum = { ...counts.blindByStratum };
  const zeroToleranceByClass = { ...counts.zeroToleranceByClass };
  const protectedGroupCrossCuts = { ...counts.protectedGroupCrossCuts };
  let minorSafety = 0;

  for (const item of manifest.blindItems) {
    blindByStratum[item.stratum] += 1;
    if (item.minorSafety) minorSafety += 1;
    for (const crossCut of item.protectedGroupCrossCuts) {
      protectedGroupCrossCuts[crossCut] += 1;
    }
  }

  for (const item of manifest.zeroToleranceValidatorItems) {
    zeroToleranceByClass[item.validatorClass] += 1;
  }

  return {
    blindTotal: manifest.blindItems.length,
    blindByStratum,
    zeroToleranceValidatorTotal: manifest.zeroToleranceValidatorItems.length,
    zeroToleranceByClass,
    protectedGroupCrossCuts,
    minorSafety,
  };
}

function compareCount(
  issues: CorpusGovernanceIssue[],
  path: readonly (string | number)[],
  reported: number,
  actual: number,
): void {
  if (reported !== actual) {
    addIssue(
      issues,
      "reported_count_mismatch",
      path,
      `Reported count ${reported} does not match computed count ${actual}.`,
    );
  }
}

function compareReportedCounts(
  issues: CorpusGovernanceIssue[],
  manifest: SimplifiedChineseBlindCorpusManifest,
  counts: SimplifiedChineseBlindCorpusCounts,
): void {
  const reported = manifest.reportedCounts;
  compareCount(issues, ["reportedCounts", "blindTotal"], reported.blindTotal, counts.blindTotal);
  compareCount(
    issues,
    ["reportedCounts", "zeroToleranceValidatorTotal"],
    reported.zeroToleranceValidatorTotal,
    counts.zeroToleranceValidatorTotal,
  );
  compareCount(
    issues,
    ["reportedCounts", "minorSafety"],
    reported.minorSafety,
    counts.minorSafety,
  );

  for (const stratum of Object.keys(counts.blindByStratum) as BlindCorpusStratum[]) {
    compareCount(
      issues,
      ["reportedCounts", "blindByStratum", stratum],
      reported.blindByStratum[stratum],
      counts.blindByStratum[stratum],
    );
  }
  for (const validatorClass of ZERO_TOLERANCE_VALIDATOR_CLASSES) {
    compareCount(
      issues,
      ["reportedCounts", "zeroToleranceByClass", validatorClass],
      reported.zeroToleranceByClass[validatorClass],
      counts.zeroToleranceByClass[validatorClass],
    );
  }
  for (const crossCut of PROTECTED_GROUP_CROSS_CUTS) {
    compareCount(
      issues,
      ["reportedCounts", "protectedGroupCrossCuts", crossCut],
      reported.protectedGroupCrossCuts[crossCut],
      counts.protectedGroupCrossCuts[crossCut],
    );
  }
}

function isPlaceholderPolicyVersion(policyVersion: string): boolean {
  return /^(?:pending|unknown|todo|tbd|unset|placeholder)/iu.test(
    policyVersion.trim(),
  );
}

function validateMetadata(
  issues: CorpusGovernanceIssue[],
  item: BlindCorpusItem | ZeroToleranceValidatorItem,
  path: readonly (string | number)[],
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  if (item.language !== manifest.language) {
    addIssue(
      issues,
      "item_language_mismatch",
      [...path, "language"],
      "Every corpus item must use the manifest language.",
    );
  }
  if (item.policyVersion !== manifest.policyVersion) {
    addIssue(
      issues,
      "item_policy_version_mismatch",
      [...path, "policyVersion"],
      "Every corpus item must record the manifest policy version.",
    );
  }
  if (item.origin.youtubeApiData) {
    addIssue(
      issues,
      "youtube_api_data_prohibited",
      [...path, "origin", "youtubeApiData"],
      "YouTube API comments must not enter the permanent corpus.",
    );
  }

  const expectedRightsStatus = {
    authored_synthetic: "synthetic",
    consented_deidentified: "consented",
    licensed_deidentified: "licensed",
  }[item.origin.kind];
  if (item.rights.status !== expectedRightsStatus) {
    addIssue(
      issues,
      "origin_rights_mismatch",
      [...path, "rights", "status"],
      "Origin kind and rights status must describe the same governed source.",
    );
  }
  if (item.rights.status !== "synthetic" && !item.rights.evidenceRef) {
    addIssue(
      issues,
      "rights_evidence_missing",
      [...path, "rights", "evidenceRef"],
      "Consented or licensed examples require an evidence reference.",
    );
  }

  if (
    item.origin.kind === "authored_synthetic" &&
    item.deIdentification.status !== "not_applicable_synthetic"
  ) {
    addIssue(
      issues,
      "de_identification_evidence_missing",
      [...path, "deIdentification", "status"],
      "Synthetic items must record that de-identification is not applicable.",
    );
  }
  if (
    item.origin.kind !== "authored_synthetic" &&
    (item.deIdentification.status !== "verified" ||
      !item.deIdentification.evidenceRef)
  ) {
    addIssue(
      issues,
      "de_identification_evidence_missing",
      [...path, "deIdentification"],
      "Non-synthetic examples require verified de-identification evidence.",
    );
  }

  validateReviewerProvenance(
    issues,
    item.reviewerProvenance,
    item.origin.kind === "authored_synthetic"
      ? "synthetic"
      : "governed",
    item,
    path,
    manifest,
  );
}

function validateReviewerProvenance(
  issues: CorpusGovernanceIssue[],
  provenance: SimplifiedChineseBlindCorpusManifest["blindItems"][number]["reviewerProvenance"],
  sourceKind: "synthetic" | "governed",
  item: BlindCorpusItem | ZeroToleranceValidatorItem,
  path: readonly (string | number)[],
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  if (provenance.protocolVersion !== manifest.reviewProtocol.protocolVersion) {
    addIssue(
      issues,
      "review_protocol_version_mismatch",
      [...path, "reviewerProvenance", "protocolVersion"],
      "Item review provenance must use the manifest review protocol version.",
    );
  }

  const [first, second] = provenance.independentReviews;
  if (first.reviewerId === second.reviewerId) {
    addIssue(
      issues,
      "independent_reviewers_not_distinct",
      [...path, "reviewerProvenance", "independentReviews"],
      "The two independent labels must come from distinct reviewers.",
    );
  }
  if (first.assignmentId === second.assignmentId) {
    addIssue(
      issues,
      "independent_assignments_not_distinct",
      [...path, "reviewerProvenance", "independentReviews"],
      "Independent labels must use distinct review assignments.",
    );
  }

  const expectedLabel: CorpusReviewLabel =
    "stratum" in item ? item.expectedClassification : "reject";
  if (first.label !== expectedLabel || second.label !== expectedLabel) {
    addIssue(
      issues,
      "review_label_mismatch",
      [...path, "reviewerProvenance", "independentReviews"],
      `Independent labels must resolve to the item's expected label for ${sourceKind} data.`,
    );
  }

  const labelsAgree = first.label === second.label;
  if (labelsAgree && provenance.adjudication !== null) {
    addIssue(
      issues,
      "adjudication_unexpected",
      [...path, "reviewerProvenance", "adjudication"],
      "An adjudication record is only present when independent labels disagree.",
    );
  }
  if (!labelsAgree && provenance.adjudication === null) {
    addIssue(
      issues,
      "adjudication_required",
      [...path, "reviewerProvenance", "adjudication"],
      "A third reviewer must resolve every disagreement.",
    );
  }
  if (provenance.adjudication !== null) {
    if (
      provenance.adjudication.reviewerId === first.reviewerId ||
      provenance.adjudication.reviewerId === second.reviewerId
    ) {
      addIssue(
        issues,
        "adjudication_reviewer_not_distinct",
        [...path, "reviewerProvenance", "adjudication", "reviewerId"],
        "The adjudicator must be distinct from both independent reviewers.",
      );
    }
    if (provenance.adjudication.label !== expectedLabel) {
      addIssue(
        issues,
        "adjudication_label_mismatch",
        [...path, "reviewerProvenance", "adjudication", "label"],
        "The adjudicator's resolved label must match the governed expected label.",
      );
    }
  }
}

function validateBlindItem(
  issues: CorpusGovernanceIssue[],
  item: BlindCorpusItem,
  index: number,
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  const path = ["blindItems", index] as const;
  validateMetadata(issues, item, path, manifest);

  if (
    item.stratum !== "prompt_injection_adversarial" &&
    item.expectedClassification !== item.stratum
  ) {
    addIssue(
      issues,
      "item_stratum_label_mismatch",
      [...path, "expectedClassification"],
      "A non-adversarial stratum must use its matching expected classification.",
    );
  }
  if (item.minorSafety && item.expectedClassification !== "safety_flag") {
    addIssue(
      issues,
      "minor_safety_label_mismatch",
      [...path, "minorSafety"],
      "Minor-safety items must resolve to Safety Flag.",
    );
  }
}

function validateValidatorItem(
  issues: CorpusGovernanceIssue[],
  item: ZeroToleranceValidatorItem,
  index: number,
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  validateMetadata(
    issues,
    item,
    ["zeroToleranceValidatorItems", index],
    manifest,
  );
}

function validateUniqueIds(
  issues: CorpusGovernanceIssue[],
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  const seen = new Map<string, readonly (string | number)[]>();
  const allItems = [
    ...manifest.blindItems.map((item, index) => ({
      item,
      path: ["blindItems", index] as const,
    })),
    ...manifest.zeroToleranceValidatorItems.map((item, index) => ({
      item,
      path: ["zeroToleranceValidatorItems", index] as const,
    })),
  ];

  for (const { item, path } of allItems) {
    const previousPath = seen.get(item.id);
    if (previousPath) {
      addIssue(
        issues,
        "duplicate_item_id",
        [...path, "id"],
        `Item ID is duplicated; the first occurrence is at ${previousPath.join(".")}.`,
      );
    } else {
      seen.set(item.id, path);
    }
  }
}

function validateCountsAndRequirements(
  issues: CorpusGovernanceIssue[],
  counts: SimplifiedChineseBlindCorpusCounts,
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  if (counts.blindTotal < CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumBlindItems) {
    addIssue(
      issues,
      "blind_items_below_minimum",
      ["blindItems"],
      `Blind corpus has ${counts.blindTotal} items; at least ${CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumBlindItems} are required.`,
    );
  }
  for (const stratum of Object.keys(
    CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata,
  ) as BlindCorpusStratum[]) {
    const minimum = CHANNEL_BLIND_CORPUS_REQUIREMENTS.strata[stratum];
    if (counts.blindByStratum[stratum] < minimum) {
      addIssue(
        issues,
        "blind_stratum_below_minimum",
        ["blindItems", "stratum", stratum],
        `Stratum ${stratum} has ${counts.blindByStratum[stratum]} items; at least ${minimum} are required.`,
      );
    }
  }
  if (
    counts.zeroToleranceValidatorTotal <
    CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumZeroToleranceValidatorItems
  ) {
    addIssue(
      issues,
      "zero_tolerance_items_below_minimum",
      ["zeroToleranceValidatorItems"],
      `Zero-tolerance validator corpus has ${counts.zeroToleranceValidatorTotal} items; at least ${CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumZeroToleranceValidatorItems} are required.`,
    );
  }
  for (const crossCut of PROTECTED_GROUP_CROSS_CUTS) {
    const count = counts.protectedGroupCrossCuts[crossCut];
    if (
      count < CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumProtectedGroupCrossCutItems
    ) {
      addIssue(
        issues,
        "protected_group_cross_cut_below_minimum",
        ["blindItems", "protectedGroupCrossCuts", crossCut],
        `Protected-group cross-cut ${crossCut} has ${count} items; at least ${CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumProtectedGroupCrossCutItems} are required.`,
      );
    }
  }
  if (
    counts.minorSafety < CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumMinorSafetyItems
  ) {
    addIssue(
      issues,
      "minor_safety_items_below_minimum",
      ["blindItems", "minorSafety"],
      `Minor-safety coverage has ${counts.minorSafety} items; at least ${CHANNEL_BLIND_CORPUS_REQUIREMENTS.minimumMinorSafetyItems} are required.`,
    );
  }

  compareReportedCounts(issues, manifest, counts);
}

function validateApprovalAndFreeze(
  issues: CorpusGovernanceIssue[],
  manifest: SimplifiedChineseBlindCorpusManifest,
): void {
  const approval = manifest.approval;
  const approvalComplete =
    approval.status === "approved" &&
    approval.approvedBy !== null &&
    approval.approvedAt !== null &&
    approval.evidenceRef !== null;
  if (!approvalComplete) {
    addIssue(
      issues,
      "approval_not_evidenced",
      ["approval"],
      "Human approval evidence is required before the corpus can be used.",
    );
  }

  const freeze = manifest.freeze;
  const freezeComplete =
    freeze.status === "frozen" &&
    freeze.frozenBy !== null &&
    freeze.frozenAt !== null &&
    freeze.manifestDigest !== null &&
    freeze.sourceRevision !== null &&
    freeze.evidenceRef !== null;
  if (!freezeComplete) {
    addIssue(
      issues,
      "freeze_not_evidenced",
      ["freeze"],
      "A frozen corpus requires immutable digest, revision, timestamp, and evidence.",
    );
  }
  if (freeze.status === "frozen" && !approvalComplete) {
    addIssue(
      issues,
      "freeze_requires_approval",
      ["freeze"],
      "Freeze evidence cannot authorize a corpus without human approval evidence.",
    );
  }
  if (freeze.status === "frozen" && !freeze.frozenBeforeFinalTupleEvaluation) {
    addIssue(
      issues,
      "freeze_order_not_evidenced",
      ["freeze", "frozenBeforeFinalTupleEvaluation"],
      "The corpus must be frozen before final tuple evaluation begins.",
    );
  }
  if (
    freeze.status === "frozen" &&
    freeze.sourceRevision !== null &&
    !/^[0-9a-f]{40}$/u.test(freeze.sourceRevision)
  ) {
    addIssue(
      issues,
      "freeze_source_revision_invalid",
      ["freeze", "sourceRevision"],
      "Freeze evidence must record a 40-character repository revision.",
    );
  }
  if (
    freeze.status === "frozen" &&
    freeze.manifestDigest !== null &&
    freeze.manifestDigest !== computeSimplifiedChineseBlindCorpusDigest(manifest)
  ) {
    addIssue(
      issues,
      "freeze_digest_mismatch",
      ["freeze", "manifestDigest"],
      "Freeze digest does not match the governed corpus manifest.",
    );
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Cannot canonicalize undefined");
  return serialized;
}

function digestBasis(
  manifest: SimplifiedChineseBlindCorpusManifest,
): Readonly<Record<string, unknown>> {
  return {
    recordType: manifest.recordType,
    recordVersion: manifest.recordVersion,
    issueNumber: manifest.issueNumber,
    language: manifest.language,
    languageTag: manifest.languageTag,
    policyVersion: manifest.policyVersion,
    purpose: manifest.purpose,
    storage: manifest.storage,
    reviewProtocol: manifest.reviewProtocol,
    requirements: manifest.requirements,
    blindItems: manifest.blindItems,
    zeroToleranceValidatorItems: manifest.zeroToleranceValidatorItems,
    reportedCounts: manifest.reportedCounts,
  };
}

export function computeSimplifiedChineseBlindCorpusDigest(input: unknown): string {
  const manifest = SimplifiedChineseBlindCorpusManifestSchema.parse(input);
  return createHash("sha256")
    .update(canonicalJson(digestBasis(manifest)), "utf8")
    .digest("hex");
}

export function validateSimplifiedChineseBlindCorpus(
  input: unknown,
): SimplifiedChineseBlindCorpusValidation {
  const parsed = parseManifest(input);
  if (!parsed.success) {
    return {
      status: "blocked",
      counts: emptyCounts(),
      issues: parsed.issues,
    };
  }

  const manifest = parsed.data;
  const issues: CorpusGovernanceIssue[] = [];
  const counts = countItems(manifest);

  if (manifest.language !== SIMPLIFIED_CHINESE_CORPUS_LANGUAGE) {
    addIssue(
      issues,
      "language_mismatch",
      ["language"],
      "This manifest must govern the Simplified Chinese slice.",
    );
  }
  if (isPlaceholderPolicyVersion(manifest.policyVersion)) {
    addIssue(
      issues,
      "policy_version_unavailable",
      ["policyVersion"],
      "The current policy version must be supplied before approval.",
    );
  }
  if (
    manifest.storage.content !== "controlled_external_store_not_checked_in" ||
    manifest.storage.youtubeApiCommentsPermanentCorpus !== "prohibited" ||
    manifest.storage.trainingUse !== "prohibited" ||
    manifest.storage.allowedUse !== "final_tuple_evaluation_only"
  ) {
    addIssue(
      issues,
      "corpus_storage_policy_invalid",
      ["storage"],
      "Permanent YouTube API comments and tuning use must remain prohibited; only final tuple evaluation is allowed.",
    );
  }
  if (manifest.upstreamHarness.status !== "available") {
    addIssue(
      issues,
      "upstream_harness_blocked",
      ["upstreamHarness"],
      "Final tuple evaluation remains blocked until issue #482 provides the upstream harness.",
    );
  } else if (!manifest.upstreamHarness.evidenceRef) {
    addIssue(
      issues,
      "upstream_harness_evidence_missing",
      ["upstreamHarness", "evidenceRef"],
      "Upstream harness availability must link to evidence from issue #482.",
    );
  }

  validateUniqueIds(issues, manifest);
  manifest.blindItems.forEach((item, index) =>
    validateBlindItem(issues, item, index, manifest),
  );
  manifest.zeroToleranceValidatorItems.forEach((item, index) =>
    validateValidatorItem(issues, item, index, manifest),
  );
  validateCountsAndRequirements(issues, counts, manifest);
  validateApprovalAndFreeze(issues, manifest);

  return {
    status: issues.length === 0 ? "ready" : "blocked",
    counts,
    issues,
  };
}

export function authorizeSimplifiedChineseBlindCorpusUse(
  input: unknown,
  use: SimplifiedChineseBlindCorpusUse,
): SimplifiedChineseBlindCorpusUseDecision {
  if (use === "tuning") {
    return {
      allowed: false,
      reason:
        "The blind corpus is permanently unavailable for tuning or development selection.",
    };
  }

  const validation = validateSimplifiedChineseBlindCorpus(input);
  if (validation.status !== "ready") {
    return {
      allowed: false,
      reason: `Final tuple evaluation is blocked by corpus governance: ${validation.issues
        .map((issue) => issue.code)
        .join(", ")}.`,
    };
  }

  return {
    allowed: true,
    reason:
      "The corpus is approved, frozen before final tuple evaluation, and governed for this use only.",
  };
}

export function parseSimplifiedChineseBlindCorpusManifest(
  input: unknown,
): SimplifiedChineseBlindCorpusManifest {
  return SimplifiedChineseBlindCorpusManifestSchema.parse(input);
}
