import { createHash } from "node:crypto";
import { z } from "zod";

import {
  CHANNEL_QUALITY_CLASSIFICATIONS,
  CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
  CHANNEL_QUALITY_EVALUATOR_VERSION,
  CHANNEL_QUALITY_GATE_THRESHOLDS,
  CHANNEL_QUALITY_MINIMUMS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  ChannelQualityVersionTupleSchema,
  canonicalChannelQualityJson as canonicalJson,
  verifyChannelQualityEvaluationFingerprint,
} from "../channel-quality-evaluation";
import type { ChannelQualityEvaluationArtifact } from "../channel-quality-evaluation";

import {
  ADVERSARIAL_ITEM_KINDS,
  CHANNEL_ENGLISH_BLIND_CORPUS_ID,
  CHANNEL_EVALUATION_POLICY_VERSION,
  CHANNEL_EVALUATION_CATEGORIES,
  ChannelEnglishBlindEvaluationCorpusSchema,
  PROTECTED_GROUP_CROSS_CUTS,
  ZERO_TOLERANCE_VALIDATORS,
  channelEvaluationCorpusFingerprint,
  createEnglishBlindEvaluationCorpus,
  summarizeChannelEvaluationCorpus,
  validateChannelEvaluationCorpus,
} from "./evaluation-corpus-governance";
import type {
  ChannelEnglishBlindEvaluationCorpus,
  ChannelEvaluationCategory,
  ProtectedGroupCrossCut,
  ZeroToleranceValidator,
} from "./evaluation-corpus-governance";

export const CHANNEL_QUALITY_GATE_INPUT_VERSION =
  "channel-quality-gate-input-v1" as const;
export const CHANNEL_QUALITY_GATE_REPORT_VERSION =
  "channel-quality-gate-report-v1" as const;

export const CHANNEL_EVALUATION_LANGUAGES = CHANNEL_QUALITY_SUPPORTED_LANGUAGES;
export type ChannelQualityLanguage = (typeof CHANNEL_EVALUATION_LANGUAGES)[number];
export const ChannelQualityLanguageSchema = z.enum(CHANNEL_EVALUATION_LANGUAGES);

export const CHANNEL_EVALUATION_CORPORA = [
  {
    issueNumber: 483,
    language: "english",
    corpusId: CHANNEL_ENGLISH_BLIND_CORPUS_ID,
    corpusVersion: "v1",
    manifestPath: "docs/channel-evaluation/english-blind-corpus-manifest.json",
    approvalEvidencePath:
      "docs/compliance/channel-english-blind-corpus-approval.json",
  },
  {
    issueNumber: 484,
    language: "simplified_chinese",
    corpusId: "channel-simplified-chinese-blind-v1",
    corpusVersion: "v1",
    manifestPath:
      "docs/evaluation/channel/simplified-chinese-blind-corpus.manifest.json",
    approvalEvidencePath:
      "docs/evaluation/channel/simplified-chinese-blind-corpus-approval-freeze-evidence.json",
  },
  {
    issueNumber: 485,
    language: "traditional_chinese",
    corpusId: "channel-traditional-chinese-blind-v1",
    corpusVersion: "traditional-chinese-blind-evaluation-v1",
    manifestPath:
      "test-fixtures/channel-evaluation-corpus/traditional-chinese-blind.manifest.json",
    approvalEvidencePath:
      "test-fixtures/channel-evaluation-corpus/traditional-chinese-blind.manifest.json",
  },
  {
    issueNumber: 486,
    language: "chinese_english_code_switch",
    corpusId: "channel-chinese-english-code-switch-blind-v1",
    corpusVersion: "v1",
    manifestPath:
      "docs/channel-evaluation/chinese-english-code-switch-blind-corpus-manifest.json",
    approvalEvidencePath:
      "docs/compliance/channel-chinese-english-code-switch-blind-corpus-approval.json",
  },
] as const;

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const RevisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);
const NonEmptyStringSchema = z.string().trim().min(1).max(500);
const ConcreteVersionSchema = NonEmptyStringSchema.refine(
  (value) =>
    !["latest", "current", "unknown", "unversioned", "pending", "todo"].includes(
      value.toLowerCase(),
    ),
  "version must be concrete and non-placeholder",
);
const InstantSchema = z.string().datetime({ offset: true });
const NonnegativeIntegerSchema = z.number().int().nonnegative();
const ProportionSchema = z.number().min(0).max(1);

const strictKeyedObject = (
  keys: readonly string[],
  valueSchema: z.ZodTypeAny,
) =>
  z
    .object(
      Object.fromEntries(keys.map((key) => [key, valueSchema])),
    )
    .strict();

export const ChannelQualityGateTupleSchema = z
  .object({
    modelIdentifier: ConcreteVersionSchema,
    assessmentPromptVersion: ConcreteVersionSchema,
    assessmentSchemaVersion: ConcreteVersionSchema,
    taxonomyVersion: ConcreteVersionSchema,
    draftPromptVersion: ConcreteVersionSchema,
    draftSchemaVersion: ConcreteVersionSchema,
    draftValidatorVersion: ConcreteVersionSchema,
    tupleFingerprint: HashSchema,
  })
  .strict();
export type ChannelQualityGateTuple = z.infer<
  typeof ChannelQualityGateTupleSchema
>;
export type ChannelQualityGateTupleFields = Omit<
  ChannelQualityGateTuple,
  "tupleFingerprint"
>;

const HarnessRateSchema = z
  .object({
    successes: NonnegativeIntegerSchema,
    trials: z.number().int().positive(),
    estimate: ProportionSchema,
    interval95: z
      .object({
        lower: ProportionSchema,
        upper: ProportionSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((rate, context) => {
    if (rate.successes > rate.trials) {
      context.addIssue({
        code: "custom",
        path: ["successes"],
        message: "successes cannot exceed trials",
      });
    }
    if (rate.interval95.lower > rate.interval95.upper) {
      context.addIssue({
        code: "custom",
        path: ["interval95"],
        message: "the Wilson lower bound cannot exceed the upper bound",
      });
    }
  });
const HarnessValidatorRateSchema = HarnessRateSchema.extend({
  acceptedUnsafeCount: NonnegativeIntegerSchema,
  missingExpectedRejectionCount: NonnegativeIntegerSchema,
}).strict();
const HarnessMetricSetSchema = z
  .object({
    actionableAbusePrecision: HarnessRateSchema.nullable(),
    allowedCriticismFalsePositiveRate: HarnessRateSchema.nullable(),
    safetyFlagRecall: HarnessRateSchema.nullable(),
    safetyFlagDraftSuppression: HarnessRateSchema.nullable(),
    draftValidator: strictKeyedObject(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
      HarnessValidatorRateSchema.nullable(),
    ),
  })
  .strict();
const HarnessMetricsSchema = z
  .object({
    overall: HarnessMetricSetSchema,
    byLanguage: strictKeyedObject(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
      HarnessMetricSetSchema,
    ),
    byCrossCut: strictKeyedObject(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
      HarnessMetricSetSchema,
    ),
  })
  .strict();
const HarnessCompositionPerLanguageSchema = z
  .object({
    classification: NonnegativeIntegerSchema,
    classificationByLabel: strictKeyedObject(
      CHANNEL_QUALITY_CLASSIFICATIONS,
      NonnegativeIntegerSchema,
    ),
    adversarial: NonnegativeIntegerSchema,
    validator: NonnegativeIntegerSchema,
    validatorByCategory: strictKeyedObject(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
      NonnegativeIntegerSchema,
    ),
    totalClassificationAndAdversarial: NonnegativeIntegerSchema,
  })
  .strict();
const HarnessCompositionSchema = z
  .object({
    itemCount: NonnegativeIntegerSchema,
    perLanguage: strictKeyedObject(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
      HarnessCompositionPerLanguageSchema,
    ),
    crossCuts: strictKeyedObject(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
      NonnegativeIntegerSchema,
    ),
  })
  .strict();
const HarnessCorpusReferenceSchema = z
  .object({
    manifestVersion: ConcreteVersionSchema,
    corpusVersion: ConcreteVersionSchema,
    split: z.enum(["development", "blind"]),
    state: z.enum(["open", "frozen"]),
    frozenAt: InstantSchema.nullable(),
    manifestHash: HashSchema,
    itemCount: NonnegativeIntegerSchema,
    dataGovernance: z.enum(["synthetic", "separately_governed"]),
    governanceReference: NonEmptyStringSchema.nullable(),
    reviewerProvenance: z
      .object({
        protocol: z.literal(
          "two_independent_reviewers_third_resolves_disagreements",
        ),
        reviewerIds: z.array(NonEmptyStringSchema).min(1),
      })
      .strict(),
  })
  .strict();
const HarnessThresholdsSchema = z
  .object({
    actionableAbusePrecision: z
      .object({
        overallPointMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
            .overallPointMinimum,
        ),
        overallLowerWilsonMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
            .overallLowerWilsonMinimum,
        ),
        languagePointMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
            .languagePointMinimum,
        ),
        languageLowerWilsonMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
            .languageLowerWilsonMinimum,
        ),
      })
      .strict(),
    allowedCriticismFalsePositiveRate: z
      .object({
        overallPointMaximum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .overallPointMaximum,
        ),
        overallUpperWilsonMaximum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .overallUpperWilsonMaximum,
        ),
        languagePointMaximum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .languagePointMaximum,
        ),
        languageUpperWilsonMaximum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .languageUpperWilsonMaximum,
        ),
      })
      .strict(),
    safetyFlagRecall: z
      .object({
        overallPointMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall
            .overallPointMinimum,
        ),
        overallLowerWilsonMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall
            .overallLowerWilsonMinimum,
        ),
        languageLowerWilsonMinimum: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall
            .languageLowerWilsonMinimum,
        ),
      })
      .strict(),
    safetyFlagDraftSuppression: z
      .object({
        minimumSuccessRate: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagDraftSuppression
            .minimumSuccessRate,
        ),
      })
      .strict(),
    draftValidator: z
      .object({
        minimumRejectionRate: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.draftValidator.minimumRejectionRate,
        ),
        maximumAcceptedUnsafeCount: z.literal(
          CHANNEL_QUALITY_GATE_THRESHOLDS.draftValidator
            .maximumAcceptedUnsafeCount,
        ),
      })
      .strict(),
  })
  .strict();

export const ChannelQualityHarnessArtifactSchema = z
  .object({
    artifactVersion: z.literal(CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION),
    evaluatorVersion: z.literal(CHANNEL_QUALITY_EVALUATOR_VERSION),
    thresholds: HarnessThresholdsSchema,
    outcome: z.enum(["passed", "failed"]),
    evaluatedAt: InstantSchema.nullable(),
    tupleSelectedAt: InstantSchema.nullable(),
    sourceRevision: RevisionSchema.nullable(),
    policyVersion: ConcreteVersionSchema.nullable(),
    versions: ChannelQualityVersionTupleSchema.nullable(),
    corpora: z
      .object({
        development: HarnessCorpusReferenceSchema.nullable(),
        blind: HarnessCorpusReferenceSchema.nullable(),
      })
      .strict(),
    composition: z
      .object({
        development: HarnessCompositionSchema.nullable(),
        blind: HarnessCompositionSchema.nullable(),
      })
      .strict(),
    resultSetHash: HashSchema.nullable(),
    metrics: HarnessMetricsSchema.nullable(),
    reproducibility: z
      .object({
        status: z.enum(["verified", "not_verified"]),
        inputFingerprint: HashSchema.nullable(),
      })
      .strict(),
    gate: z
      .object({
        outcome: z.enum(["passed", "failed"]),
        failures: z.array(
          z
            .object({
              code: NonEmptyStringSchema,
              scope: NonEmptyStringSchema,
              detail: NonEmptyStringSchema,
              category: NonEmptyStringSchema.optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    evaluationFingerprint: HashSchema,
  })
  .strict();
export type ChannelQualityHarnessArtifact = z.infer<
  typeof ChannelQualityHarnessArtifactSchema
>;

export const ChannelQualityGateHarnessEvidenceSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        issueNumber: z.literal(482),
        status: z.literal("not_available"),
        blockers: z.array(NonEmptyStringSchema).min(1),
      })
      .strict(),
    z
      .object({
        issueNumber: z.literal(482),
        status: z.literal("available"),
        sourceRevision: RevisionSchema,
        artifact: ChannelQualityHarnessArtifactSchema,
      })
      .strict(),
  ],
);
export type ChannelQualityGateHarnessEvidence = z.infer<
  typeof ChannelQualityGateHarnessEvidenceSchema
>;

export const ChannelQualityGateCategorySchema = z.enum(
  CHANNEL_EVALUATION_CATEGORIES,
);
export const ChannelQualityGateValidatorSchema = z.enum(
  ZERO_TOLERANCE_VALIDATORS,
);
export const ChannelQualityGateAdversarialKindSchema = z.enum(
  ADVERSARIAL_ITEM_KINDS,
);
export const ChannelQualityGateCrossCutSchema = z.enum(
  PROTECTED_GROUP_CROSS_CUTS,
);

const CategoryCountsSchema = z
  .object({
    "Allowed Criticism": z.number().int().nonnegative(),
    "Actionable Abuse": z.number().int().nonnegative(),
    "Reviewable Interaction": z.number().int().nonnegative(),
    "Safety Flag": z.number().int().nonnegative(),
  })
  .strict();
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

export const ChannelQualityCorpusCoverageSchema = z
  .object({
    totalItems: z.number().int().nonnegative(),
    categoryCounts: CategoryCountsSchema,
    adversarialCount: z.number().int().nonnegative(),
    zeroToleranceValidatorCount: z.number().int().nonnegative(),
    protectedGroupCounts: ProtectedGroupCountsSchema,
    minorSafetyCount: z.number().int().nonnegative(),
    reviewerCompleteCount: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelQualityCorpusCoverage = z.infer<
  typeof ChannelQualityCorpusCoverageSchema
>;

const UniqueArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: "duplicate values" });
    }
  });

export const ChannelQualityGateSampleSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{2,119}$/u),
    language: ChannelQualityLanguageSchema,
    category: ChannelQualityGateCategorySchema,
    adversarialKind: ChannelQualityGateAdversarialKindSchema.nullable(),
    zeroToleranceValidator: ChannelQualityGateValidatorSchema.nullable(),
    protectedGroupCrossCuts: UniqueArray(ChannelQualityGateCrossCutSchema).max(
      PROTECTED_GROUP_CROSS_CUTS.length,
    ),
    minorSafety: z.boolean(),
    codeSwitchEvidence: z
      .object({
        englishClause: NonEmptyStringSchema,
        chineseClause: NonEmptyStringSchema,
        independentlyMeaningful: z.literal(true),
        reviewedBy: NonEmptyStringSchema,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((sample, context) => {
    if (sample.language === "chinese_english_code_switch") {
      if (sample.codeSwitchEvidence === null) {
        context.addIssue({
          code: "custom",
          path: ["codeSwitchEvidence"],
          message:
            "Code-switch samples require independently meaningful English and Chinese clause evidence",
        });
        return;
      }
      const englishWords =
        sample.codeSwitchEvidence.englishClause.match(/[A-Za-z]+/g) ?? [];
      const chineseCharacters =
        sample.codeSwitchEvidence.chineseClause.match(/[\u3400-\u9fff]/gu) ?? [];
      if (englishWords.length < 2 || chineseCharacters.length < 3) {
        context.addIssue({
          code: "custom",
          path: ["codeSwitchEvidence"],
          message:
            "Code-switch evidence must contain meaningful English and Chinese clauses",
        });
      }
    } else if (sample.codeSwitchEvidence !== null) {
      context.addIssue({
        code: "custom",
        path: ["codeSwitchEvidence"],
        message: "Code-switch evidence is only valid for the code-switch slice",
      });
    }
  });
export type ChannelQualityGateSample = z.infer<
  typeof ChannelQualityGateSampleSchema
>;

const GovernanceEvidenceSchema = z
  .object({
    status: z.enum(["passed", "blocked"]),
    issues: z.array(NonEmptyStringSchema),
    blockers: z.array(NonEmptyStringSchema),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.status === "passed" && evidence.issues.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["issues"],
        message: "Passed governance cannot contain issues",
      });
    }
    if (evidence.status === "passed" && evidence.blockers.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["blockers"],
        message: "Passed governance cannot contain blockers",
      });
    }
  });

const LifecycleEvidenceSchema = z
  .object({
    status: z.enum(["recorded", "not_recorded"]),
    corpusFingerprint: HashSchema.nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.status === "recorded" && evidence.corpusFingerprint === null) {
      context.addIssue({
        code: "custom",
        path: ["corpusFingerprint"],
        message: "Recorded lifecycle evidence requires a corpus fingerprint",
      });
    }
    if (evidence.status === "not_recorded" && evidence.corpusFingerprint !== null) {
      context.addIssue({
        code: "custom",
        path: ["corpusFingerprint"],
        message: "Unrecorded lifecycle evidence cannot contain a fingerprint",
      });
    }
  });

export const ChannelQualityGateCorpusSchema = z
  .object({
    issueNumber: z.union([
      z.literal(483),
      z.literal(484),
      z.literal(485),
      z.literal(486),
    ]),
    corpusId: NonEmptyStringSchema,
    language: ChannelQualityLanguageSchema,
    corpusVersion: ConcreteVersionSchema,
    policyVersion: ConcreteVersionSchema,
    fingerprint: HashSchema,
    blind: z.literal(true),
    developmentCorpus: z.literal(false),
    tuningAllowed: z.literal(false),
    governance: GovernanceEvidenceSchema,
    coverage: ChannelQualityCorpusCoverageSchema,
    approval: LifecycleEvidenceSchema,
    freeze: LifecycleEvidenceSchema,
    samples: z.array(ChannelQualityGateSampleSchema),
  })
  .strict();
export type ChannelQualityGateCorpus = z.infer<
  typeof ChannelQualityGateCorpusSchema
>;

const ObservationIdentitySchema = z.object({
  sampleId: z.string().trim().min(1).max(120),
  corpusId: NonEmptyStringSchema,
  corpusFingerprint: HashSchema,
  tupleFingerprint: HashSchema,
});

const CompletedObservationSchema = ObservationIdentitySchema.extend({
  status: z.literal("completed"),
  predictedCategory: ChannelQualityGateCategorySchema,
  draftProduced: z.boolean(),
  validatorFailures: UniqueArray(ChannelQualityGateValidatorSchema),
}).strict();
const FailedObservationSchema = ObservationIdentitySchema.extend({
  status: z.literal("failed"),
  errorCode: NonEmptyStringSchema,
}).strict();

export const ChannelQualityGateObservationSchema = z.discriminatedUnion(
  "status",
  [CompletedObservationSchema, FailedObservationSchema],
);
export type ChannelQualityGateObservation = z.infer<
  typeof ChannelQualityGateObservationSchema
>;

export const ChannelQualityGateInputSchema = z
  .object({
    recordType: z.literal(CHANNEL_QUALITY_GATE_INPUT_VERSION),
    recordVersion: z.literal(1),
    evaluatedAt: z.string().datetime({ offset: true }),
    harness: ChannelQualityGateHarnessEvidenceSchema,
    tuple: ChannelQualityGateTupleSchema,
    corpora: z.array(ChannelQualityGateCorpusSchema),
    observations: z.array(ChannelQualityGateObservationSchema),
  })
  .strict();
export type ChannelQualityGateInput = z.infer<typeof ChannelQualityGateInputSchema>;

export type ChannelQualityRateMetric = Readonly<{
  numerator: number;
  denominator: number;
  successes: number;
  failures: number;
  trials: number;
  rate: number | null;
  wilsonLower: number | null;
  wilsonUpper: number | null;
}>;

export type ChannelQualityGateFailure = Readonly<{
  code: string;
  scope: "prerequisite" | "corpus" | "evaluation" | "metric" | "validator";
  language?: ChannelQualityLanguage;
  sampleId?: string;
  category?: string;
  message: string;
  observed?: number;
  required?: number;
}>;

export type ChannelQualityGateMetrics = Readonly<{
  actionableAbusePrecision: Readonly<{
    overall: ChannelQualityRateMetric;
    byLanguage: Readonly<Record<ChannelQualityLanguage, ChannelQualityRateMetric>>;
  }>;
  allowedCriticismFalsePositive: Readonly<{
    overall: ChannelQualityRateMetric;
    byLanguage: Readonly<Record<ChannelQualityLanguage, ChannelQualityRateMetric>>;
  }>;
  safetyFlagRecall: Readonly<{
    overall: ChannelQualityRateMetric;
    byLanguage: Readonly<Record<ChannelQualityLanguage, ChannelQualityRateMetric>>;
  }>;
  safetyFlagDraftSuppression: Readonly<{
    overall: ChannelQualityRateMetric;
    byLanguage: Readonly<Record<ChannelQualityLanguage, ChannelQualityRateMetric>>;
  }>;
  zeroToleranceFailures: Readonly<{
    overall: Readonly<Record<ZeroToleranceValidator, number>>;
    byLanguage: Readonly<
      Record<ChannelQualityLanguage, Readonly<Record<ZeroToleranceValidator, number>>>
    >;
  }>;
}>;

export type ChannelQualityGateCorpusSummary = Readonly<{
  issueNumber: number | null;
  corpusId: string | null;
  language: ChannelQualityLanguage;
  status: "ready" | "blocked" | "missing";
  fingerprint: string | null;
  sampleCount: number;
  observedCount: number;
}>;

export type ChannelQualityGateReport = Readonly<{
  recordType: typeof CHANNEL_QUALITY_GATE_REPORT_VERSION;
  recordVersion: 1;
  evaluatedAt: string | null;
  decision: "passed" | "blocked";
  releaseReviewEligible: boolean;
  productionActivationPerformed: false;
  harnessStatus: "available" | "not_available" | "invalid";
  harness: ChannelQualityGateHarnessEvidence | null;
  evaluatedTuple: ChannelQualityGateTuple | null;
  tupleFingerprint: string | null;
  corpora: readonly ChannelQualityGateCorpusSummary[];
  observationCount: number;
  metrics: ChannelQualityGateMetrics;
  failures: readonly ChannelQualityGateFailure[];
  blockers: readonly string[];
  nonClaims: readonly string[];
  evaluationFingerprint: string;
}>;
export type ChannelQualityGateReportBody = Omit<
  ChannelQualityGateReport,
  "evaluationFingerprint"
>;

const CATEGORY_MINIMUMS: Readonly<
  Record<ChannelEvaluationCategory, number>
> = {
  "Allowed Criticism":
    CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.allowed_criticism,
  "Actionable Abuse":
    CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.actionable_abuse,
  "Reviewable Interaction":
    CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.reviewable_interaction,
  "Safety Flag":
    CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.safety_flag,
};
const TOTAL_MINIMUM =
  CHANNEL_QUALITY_MINIMUMS.perLanguage.totalClassificationAndAdversarial;
const ADVERSARIAL_MINIMUM = CHANNEL_QUALITY_MINIMUMS.perLanguage.adversarial;
const ZERO_TOLERANCE_MINIMUM =
  CHANNEL_QUALITY_MINIMUMS.perLanguage.validator;
const CROSS_CUT_MINIMUM = CHANNEL_QUALITY_MINIMUMS.eachRequiredCrossCut;
const MINOR_SAFETY_MINIMUM = CHANNEL_QUALITY_MINIMUMS.minorSafety;
const WILSON_Z = 1.959963984540054;
const NON_CLAIMS = [
  "A passing report is evidence for release review only; it does not activate production code.",
  "This repository-side gate does not claim external approvals, credentials, live YouTube access, or production readiness.",
] as const;

const EMPTY_CATEGORY_COUNTS: Record<ChannelEvaluationCategory, number> = {
  "Allowed Criticism": 0,
  "Actionable Abuse": 0,
  "Reviewable Interaction": 0,
  "Safety Flag": 0,
};
const EMPTY_CROSS_CUT_COUNTS: Record<ProtectedGroupCrossCut, number> = {
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

function emptyRateMetric(): ChannelQualityRateMetric {
  return {
    numerator: 0,
    denominator: 0,
    successes: 0,
    failures: 0,
    trials: 0,
    rate: null,
    wilsonLower: null,
    wilsonUpper: null,
  };
}

function languageRecord<T>(factory: () => T): Record<ChannelQualityLanguage, T> {
  return Object.fromEntries(
    CHANNEL_EVALUATION_LANGUAGES.map((language) => [language, factory()]),
  ) as Record<ChannelQualityLanguage, T>;
}

function validatorRecord(): Record<ZeroToleranceValidator, number> {
  return Object.fromEntries(
    ZERO_TOLERANCE_VALIDATORS.map((validator) => [validator, 0]),
  ) as Record<ZeroToleranceValidator, number>;
}

function emptyMetrics(): ChannelQualityGateMetrics {
  return {
    actionableAbusePrecision: {
      overall: emptyRateMetric(),
      byLanguage: languageRecord(emptyRateMetric),
    },
    allowedCriticismFalsePositive: {
      overall: emptyRateMetric(),
      byLanguage: languageRecord(emptyRateMetric),
    },
    safetyFlagRecall: {
      overall: emptyRateMetric(),
      byLanguage: languageRecord(emptyRateMetric),
    },
    safetyFlagDraftSuppression: {
      overall: emptyRateMetric(),
      byLanguage: languageRecord(emptyRateMetric),
    },
    zeroToleranceFailures: {
      overall: validatorRecord(),
      byLanguage: languageRecord(validatorRecord),
    },
  };
}

export function channelQualityGateReportFingerprint(
  report: ChannelQualityGateReportBody,
): string {
  return createHash("sha256")
    .update(canonicalJson(report), "utf8")
    .digest("hex");
}

export function channelQualityGateTupleFingerprint(
  tuple: ChannelQualityGateTupleFields,
): string {
  return createHash("sha256")
    .update(canonicalJson(tuple), "utf8")
    .digest("hex");
}

function addFailure(
  failures: ChannelQualityGateFailure[],
  failure: ChannelQualityGateFailure,
): void {
  failures.push(failure);
}

function schemaFailureMessage(
  path: readonly PropertyKey[],
  message: string,
): string {
  return `${path.map(String).join(".") || "record"}: ${message}`;
}

function summariesForMissingCorpora(): ChannelQualityGateCorpusSummary[] {
  return CHANNEL_EVALUATION_CORPORA.map((definition) => ({
    issueNumber: definition.issueNumber,
    corpusId: definition.corpusId,
    language: definition.language,
    status: "missing" as const,
    fingerprint: null,
    sampleCount: 0,
    observedCount: 0,
  }));
}

function buildReport(input: Readonly<{
  evaluatedAt: string | null;
  harnessStatus: ChannelQualityGateReport["harnessStatus"];
  harness?: ChannelQualityGateHarnessEvidence | null;
  evaluatedTuple?: ChannelQualityGateTuple | null;
  tupleFingerprint: string | null;
  corpora: readonly ChannelQualityGateCorpusSummary[];
  observationCount?: number;
  metrics?: ChannelQualityGateMetrics;
  failures: readonly ChannelQualityGateFailure[];
}>): ChannelQualityGateReport {
  const failures = [...input.failures];
  const blockers = [...new Set(failures.map((failure) => failure.code))];
  const passed = failures.length === 0;
  const report: ChannelQualityGateReportBody = {
    recordType: CHANNEL_QUALITY_GATE_REPORT_VERSION,
    recordVersion: 1,
    evaluatedAt: input.evaluatedAt,
    decision: passed ? "passed" : "blocked",
    releaseReviewEligible: passed,
    productionActivationPerformed: false,
    harnessStatus: input.harnessStatus,
    harness: input.harness ?? null,
    evaluatedTuple: input.evaluatedTuple ?? null,
    tupleFingerprint: input.tupleFingerprint,
    corpora: input.corpora,
    observationCount: input.observationCount ?? 0,
    metrics: input.metrics ?? emptyMetrics(),
    failures,
    blockers,
    nonClaims: NON_CLAIMS,
  };
  return {
    ...report,
    evaluationFingerprint: channelQualityGateReportFingerprint(report),
  };
}

export function buildMissingChannelQualityGateReport(
  inputPath = "docs/channel-evaluation/channel-quality-gate-input.json",
): ChannelQualityGateReport {
  const englishInventory = projectEnglishBlindCorpusForQualityGate(
    createEnglishBlindEvaluationCorpus(),
  );
  const failures: ChannelQualityGateFailure[] = [
    {
      code: "quality_gate_input_missing",
      scope: "prerequisite",
      message: `Frozen quality-gate input is not present at ${inputPath}.`,
    },
    {
      code: "harness_evidence_missing",
      scope: "prerequisite",
      message: "Issue #482 offline harness evidence is not available.",
    },
  ];
  for (const definition of CHANNEL_EVALUATION_CORPORA) {
    if (definition.language === "english") {
      failures.push(
        {
          code: "corpus_evidence_missing",
          scope: "corpus",
          language: definition.language,
          message: `Frozen corpus evidence for issue #${definition.issueNumber} is not available; the repository inventory remains pending review and freeze.`,
        },
        {
          code: "corpus_governance_blocked",
          scope: "corpus",
          language: definition.language,
          message: `English corpus governance remains blocked: ${englishInventory.governance.blockers.join(", ")}.`,
        },
        {
          code: "corpus_approval_missing",
          scope: "corpus",
          language: definition.language,
          message: "English corpus approval evidence is not recorded.",
        },
        {
          code: "corpus_freeze_missing",
          scope: "corpus",
          language: definition.language,
          message: "English corpus freeze evidence is not recorded.",
        },
      );
    } else {
      failures.push({
        code: "corpus_evidence_missing",
        scope: "corpus",
        language: definition.language,
        message: `Frozen corpus evidence for issue #${definition.issueNumber} is not available at ${definition.manifestPath}.`,
      });
    }
  }
  failures.push({
    code: "final_tuple_evaluation_missing",
    scope: "evaluation",
    message: "No completed final model/prompt/taxonomy/validator tuple evaluation is available.",
  });
  failures.push({
    code: "evaluation_observations_missing",
    scope: "evaluation",
    message: "No per-sample blind evaluation observations are available.",
  });
  return buildReport({
    evaluatedAt: null,
    harnessStatus: "not_available",
    harness: null,
    evaluatedTuple: null,
    tupleFingerprint: null,
    corpora: [
      {
        issueNumber: 483,
        corpusId: englishInventory.corpusId,
        language: "english",
        status: "blocked",
        fingerprint: englishInventory.fingerprint,
        sampleCount: englishInventory.samples.length,
        observedCount: 0,
      },
      ...summariesForMissingCorpora().filter(
        (summary) => summary.language !== "english",
      ),
    ],
    failures,
  });
}

export function buildChannelQualityGateInputErrorReport(
  code:
    | "quality_gate_input_json_invalid"
    | "quality_gate_input_unreadable",
  message: string,
): ChannelQualityGateReport {
  return buildReport({
    evaluatedAt: null,
    harnessStatus: "invalid",
    harness: null,
    evaluatedTuple: null,
    tupleFingerprint: null,
    corpora: summariesForMissingCorpora(),
    failures: [
      {
        code,
        scope: "prerequisite",
        message,
      },
    ],
  });
}

function derivedCoverage(
  samples: readonly ChannelQualityGateSample[],
): ChannelQualityCorpusCoverage {
  const categoryCounts = { ...EMPTY_CATEGORY_COUNTS };
  const protectedGroupCounts = { ...EMPTY_CROSS_CUT_COUNTS };
  let adversarialCount = 0;
  let zeroToleranceValidatorCount = 0;
  let minorSafetyCount = 0;
  for (const sample of samples) {
    categoryCounts[sample.category] += 1;
    if (sample.adversarialKind !== null) adversarialCount += 1;
    if (sample.zeroToleranceValidator !== null) {
      zeroToleranceValidatorCount += 1;
    }
    for (const crossCut of sample.protectedGroupCrossCuts) {
      protectedGroupCounts[crossCut] += 1;
    }
    if (sample.minorSafety) minorSafetyCount += 1;
  }
  return {
    totalItems: samples.length,
    categoryCounts,
    adversarialCount,
    zeroToleranceValidatorCount,
    protectedGroupCounts,
    minorSafetyCount,
    reviewerCompleteCount: 0,
  };
}

function compareCoverage(
  declared: ChannelQualityCorpusCoverage,
  derived: ChannelQualityCorpusCoverage,
): boolean {
  return (
    declared.totalItems === derived.totalItems &&
    canonicalJson(declared.categoryCounts) ===
      canonicalJson(derived.categoryCounts) &&
    declared.adversarialCount === derived.adversarialCount &&
    declared.zeroToleranceValidatorCount ===
      derived.zeroToleranceValidatorCount &&
    canonicalJson(declared.protectedGroupCounts) ===
      canonicalJson(derived.protectedGroupCounts) &&
    declared.minorSafetyCount === derived.minorSafetyCount
  );
}

function reportMetric(
  numerator: number,
  complement: number,
): ChannelQualityRateMetric {
  const trials = numerator + complement;
  if (trials === 0) return emptyRateMetric();
  const rate = numerator / trials;
  const zSquared = WILSON_Z ** 2;
  const denominator = 1 + zSquared / trials;
  const center = (rate + zSquared / (2 * trials)) / denominator;
  const spread =
    (WILSON_Z *
      Math.sqrt(
        (rate * (1 - rate)) / trials + zSquared / (4 * trials ** 2),
      )) /
    denominator;
  return {
    numerator,
    denominator: trials,
    successes: numerator,
    failures: complement,
    trials,
    rate,
    wilsonLower: Math.max(0, center - spread),
    wilsonUpper: Math.min(1, center + spread),
  };
}

type LanguageMetricAccumulator = {
  predictedActionableAbuse: number;
  actionableAbuseTrue: number;
  allowedCriticism: number;
  allowedCriticismFalsePositive: number;
  safetyFlag: number;
  safetyFlagTrue: number;
  safetyFlagDrafts: number;
  safetyFlagNoDraft: number;
};

function emptyAccumulator(): LanguageMetricAccumulator {
  return {
    predictedActionableAbuse: 0,
    actionableAbuseTrue: 0,
    allowedCriticism: 0,
    allowedCriticismFalsePositive: 0,
    safetyFlag: 0,
    safetyFlagTrue: 0,
    safetyFlagDrafts: 0,
    safetyFlagNoDraft: 0,
  };
}

function buildMetrics(
  accumulators: Readonly<Record<ChannelQualityLanguage, LanguageMetricAccumulator>>,
  zeroToleranceFailures: Readonly<
    Record<ChannelQualityLanguage, Record<ZeroToleranceValidator, number>>
  >,
): ChannelQualityGateMetrics {
  const all = emptyAccumulator();
  for (const language of CHANNEL_EVALUATION_LANGUAGES) {
    const accumulator = accumulators[language];
    for (const key of Object.keys(all) as (keyof LanguageMetricAccumulator)[]) {
      all[key] += accumulator[key];
    }
  }
  const precisionByLanguage = languageRecord(() => emptyRateMetric());
  const criticismByLanguage = languageRecord(() => emptyRateMetric());
  const safetyRecallByLanguage = languageRecord(() => emptyRateMetric());
  const safetyDraftByLanguage = languageRecord(() => emptyRateMetric());
  for (const language of CHANNEL_EVALUATION_LANGUAGES) {
    const accumulator = accumulators[language];
    precisionByLanguage[language] = reportMetric(
      accumulator.actionableAbuseTrue,
      accumulator.predictedActionableAbuse - accumulator.actionableAbuseTrue,
    );
    criticismByLanguage[language] = reportMetric(
      accumulator.allowedCriticismFalsePositive,
      accumulator.allowedCriticism - accumulator.allowedCriticismFalsePositive,
    );
    safetyRecallByLanguage[language] = reportMetric(
      accumulator.safetyFlagTrue,
      accumulator.safetyFlag - accumulator.safetyFlagTrue,
    );
    safetyDraftByLanguage[language] = reportMetric(
      accumulator.safetyFlagNoDraft,
      accumulator.safetyFlagDrafts,
    );
  }
  return {
    actionableAbusePrecision: {
      overall: reportMetric(
        all.actionableAbuseTrue,
        all.predictedActionableAbuse - all.actionableAbuseTrue,
      ),
      byLanguage: precisionByLanguage,
    },
    allowedCriticismFalsePositive: {
      overall: reportMetric(
        all.allowedCriticismFalsePositive,
        all.allowedCriticism - all.allowedCriticismFalsePositive,
      ),
      byLanguage: criticismByLanguage,
    },
    safetyFlagRecall: {
      overall: reportMetric(
        all.safetyFlagTrue,
        all.safetyFlag - all.safetyFlagTrue,
      ),
      byLanguage: safetyRecallByLanguage,
    },
    safetyFlagDraftSuppression: {
      overall: reportMetric(all.safetyFlagNoDraft, all.safetyFlagDrafts),
      byLanguage: safetyDraftByLanguage,
    },
    zeroToleranceFailures: {
      overall: ZERO_TOLERANCE_VALIDATORS.reduce(
        (result, validator) => {
          result[validator] = CHANNEL_EVALUATION_LANGUAGES.reduce(
            (count, language) => count + zeroToleranceFailures[language][validator],
            0,
          );
          return result;
        },
        validatorRecord(),
      ),
      byLanguage: zeroToleranceFailures,
    },
  };
}

function validateCorpus(
  corpus: ChannelQualityGateCorpus,
  definition: (typeof CHANNEL_EVALUATION_CORPORA)[number],
  failures: ChannelQualityGateFailure[],
): void {
  if (
    corpus.issueNumber !== definition.issueNumber ||
    corpus.corpusId !== definition.corpusId ||
    corpus.corpusVersion !== definition.corpusVersion
  ) {
    addFailure(failures, {
      code: "corpus_identity_mismatch",
      scope: "corpus",
      language: definition.language,
      message: `Corpus evidence does not match the governed issue #${definition.issueNumber} identity.`,
    });
  }
  if (corpus.policyVersion !== CHANNEL_EVALUATION_POLICY_VERSION) {
    addFailure(failures, {
      code: "corpus_policy_version_mismatch",
      scope: "corpus",
      language: definition.language,
      message: "Corpus policy version does not match the approved Channel policy.",
    });
  }
  if (corpus.governance.status !== "passed") {
    addFailure(failures, {
      code: "corpus_governance_blocked",
      scope: "corpus",
      language: definition.language,
      message: `Corpus governance for issue #${definition.issueNumber} is blocked: ${[
        ...corpus.governance.issues,
        ...corpus.governance.blockers,
      ].join(", ") || "no reason supplied"}.`,
    });
  }
  if (corpus.approval.status !== "recorded") {
    addFailure(failures, {
      code: "corpus_approval_missing",
      scope: "corpus",
      language: definition.language,
      message: "Corpus approval evidence is not recorded for the exact corpus fingerprint.",
    });
  } else if (corpus.approval.corpusFingerprint !== corpus.fingerprint) {
    addFailure(failures, {
      code: "corpus_approval_fingerprint_mismatch",
      scope: "corpus",
      language: definition.language,
      message: "Corpus approval is not bound to the supplied corpus fingerprint.",
    });
  }
  if (corpus.freeze.status !== "recorded") {
    addFailure(failures, {
      code: "corpus_freeze_missing",
      scope: "corpus",
      language: definition.language,
      message: "Corpus freeze evidence is not recorded for the exact corpus fingerprint.",
    });
  } else if (corpus.freeze.corpusFingerprint !== corpus.fingerprint) {
    addFailure(failures, {
      code: "corpus_freeze_fingerprint_mismatch",
      scope: "corpus",
      language: definition.language,
      message: "Corpus freeze is not bound to the supplied corpus fingerprint.",
    });
  }

  const derived = derivedCoverage(corpus.samples);
  if (!compareCoverage(corpus.coverage, derived)) {
    addFailure(failures, {
      code: "corpus_coverage_mismatch",
      scope: "corpus",
      language: definition.language,
      message: "Declared corpus coverage does not equal counts derived from sample records.",
    });
  }
  if (corpus.coverage.totalItems < TOTAL_MINIMUM) {
    addFailure(failures, {
      code: "corpus_total_items_below_minimum",
      scope: "corpus",
      language: definition.language,
      message: `The corpus has ${corpus.coverage.totalItems} samples; ${TOTAL_MINIMUM} are required.`,
      observed: corpus.coverage.totalItems,
      required: TOTAL_MINIMUM,
    });
  }
  for (const category of CHANNEL_EVALUATION_CATEGORIES) {
    const observed = corpus.coverage.categoryCounts[category];
    const required = CATEGORY_MINIMUMS[category];
    if (observed < required) {
      addFailure(failures, {
        code: "corpus_category_below_minimum",
        scope: "corpus",
        language: definition.language,
        category,
        message: `${category} has ${observed} samples; ${required} are required.`,
        observed,
        required,
      });
    }
  }
  if (corpus.coverage.adversarialCount < ADVERSARIAL_MINIMUM) {
    addFailure(failures, {
      code: "corpus_adversarial_below_minimum",
      scope: "corpus",
      language: definition.language,
      message: `The corpus has ${corpus.coverage.adversarialCount} adversarial samples; ${ADVERSARIAL_MINIMUM} are required.`,
      observed: corpus.coverage.adversarialCount,
      required: ADVERSARIAL_MINIMUM,
    });
  }
  if (corpus.coverage.zeroToleranceValidatorCount < ZERO_TOLERANCE_MINIMUM) {
    addFailure(failures, {
      code: "corpus_zero_tolerance_below_minimum",
      scope: "corpus",
      language: definition.language,
      message: `The corpus has ${corpus.coverage.zeroToleranceValidatorCount} zero-tolerance samples; ${ZERO_TOLERANCE_MINIMUM} are required.`,
      observed: corpus.coverage.zeroToleranceValidatorCount,
      required: ZERO_TOLERANCE_MINIMUM,
    });
  }
  for (const crossCut of PROTECTED_GROUP_CROSS_CUTS) {
    const observed = corpus.coverage.protectedGroupCounts[crossCut];
    if (observed < CROSS_CUT_MINIMUM) {
      addFailure(failures, {
        code: "corpus_protected_group_below_minimum",
        scope: "corpus",
        language: definition.language,
        category: crossCut,
        message: `${crossCut} has ${observed} samples; ${CROSS_CUT_MINIMUM} are required.`,
        observed,
        required: CROSS_CUT_MINIMUM,
      });
    }
  }
  if (corpus.coverage.minorSafetyCount < MINOR_SAFETY_MINIMUM) {
    addFailure(failures, {
      code: "corpus_minor_safety_below_minimum",
      scope: "corpus",
      language: definition.language,
      message: `The corpus has ${corpus.coverage.minorSafetyCount} minor-safety samples; ${MINOR_SAFETY_MINIMUM} are required.`,
      observed: corpus.coverage.minorSafetyCount,
      required: MINOR_SAFETY_MINIMUM,
    });
  }
  if (corpus.coverage.reviewerCompleteCount !== corpus.coverage.totalItems) {
    addFailure(failures, {
      code: "corpus_reviewer_provenance_incomplete",
      scope: "corpus",
      language: definition.language,
      message: "Every blind sample must have complete independent-review provenance before final evaluation.",
      observed: corpus.coverage.reviewerCompleteCount,
      required: corpus.coverage.totalItems,
    });
  }
  for (const validator of ZERO_TOLERANCE_VALIDATORS) {
    if (!corpus.samples.some((sample) => sample.zeroToleranceValidator === validator)) {
      addFailure(failures, {
        code: "corpus_zero_tolerance_category_missing",
        scope: "corpus",
        language: definition.language,
        category: validator,
        message: `The ${validator} zero-tolerance category has no sample in this language slice.`,
      });
    }
  }
  for (const sample of corpus.samples) {
    if (sample.language !== definition.language) {
      addFailure(failures, {
        code: "corpus_sample_language_mismatch",
        scope: "corpus",
        language: definition.language,
        sampleId: sample.id,
        message: "A corpus sample is assigned to a different language slice.",
      });
    }
    if (sample.minorSafety && sample.category !== "Safety Flag") {
      addFailure(failures, {
        code: "corpus_minor_safety_category_mismatch",
        scope: "corpus",
        language: definition.language,
        sampleId: sample.id,
        message: "Minor-safety samples must be Safety Flag samples.",
      });
    }
  }
}

type IndexedSample = Readonly<{
  corpus: ChannelQualityGateCorpus;
  sample: ChannelQualityGateSample;
  language: ChannelQualityLanguage;
}>;

export function evaluateChannelQualityGate(input: unknown): ChannelQualityGateReport {
  const parsed = ChannelQualityGateInputSchema.safeParse(input);
  if (!parsed.success) {
    const failures = parsed.error.issues.map((issue) => ({
      code: "quality_gate_input_schema_invalid",
      scope: "prerequisite" as const,
      message: schemaFailureMessage(issue.path, issue.message),
    }));
    return buildReport({
      evaluatedAt: null,
      harnessStatus: "invalid",
      harness: null,
      evaluatedTuple: null,
      tupleFingerprint: null,
      corpora: summariesForMissingCorpora(),
      failures,
    });
  }

  const value = parsed.data;
  const failures: ChannelQualityGateFailure[] = [];
  if (value.harness.status !== "available") {
    addFailure(failures, {
      code: "harness_unavailable",
      scope: "prerequisite",
      message: `Issue #482 offline harness is unavailable: ${value.harness.blockers.join(", ")}`,
    });
  } else {
    const artifact = value.harness.artifact;
    let artifactFingerprintValid = false;
    try {
      artifactFingerprintValid = verifyChannelQualityEvaluationFingerprint(
        artifact as unknown as ChannelQualityEvaluationArtifact,
      );
    } catch {
      artifactFingerprintValid = false;
    }
    if (!artifactFingerprintValid) {
      addFailure(failures, {
        code: "harness_artifact_fingerprint_mismatch",
        scope: "prerequisite",
        message:
          "Issue #482 harness evidence is not reproducible from its evaluation fingerprint.",
      });
    }
    if (
      canonicalJson(artifact.thresholds) !==
      canonicalJson(CHANNEL_QUALITY_GATE_THRESHOLDS)
    ) {
      addFailure(failures, {
        code: "harness_thresholds_mismatch",
        scope: "prerequisite",
        message:
          "Issue #482 harness evidence does not use the canonical release-gate thresholds.",
      });
    }
    if (
      artifact.outcome !== "passed" ||
      artifact.gate.outcome !== "passed" ||
      artifact.gate.failures.length > 0
    ) {
      addFailure(failures, {
        code: "harness_evaluation_failed",
        scope: "prerequisite",
        message:
          "Issue #482 harness evidence contains a failed release evaluation.",
      });
    }
    for (const gateFailure of artifact.gate.failures) {
      addFailure(failures, {
        code: `harness_${gateFailure.code}`,
        scope: "prerequisite",
        ...(gateFailure.category === undefined
          ? {}
          : { category: gateFailure.category }),
        message: `Issue #482 harness failure at ${gateFailure.scope}: ${gateFailure.detail}.`,
      });
    }
    if (
      artifact.reproducibility.status !== "verified" ||
      artifact.reproducibility.inputFingerprint === null
    ) {
      addFailure(failures, {
        code: "harness_evaluation_not_reproducible",
        scope: "prerequisite",
        message:
          "Issue #482 harness evidence does not report verified reproducibility.",
      });
    }
    if (artifact.outcome === "passed") {
      const missingFields = [
        artifact.evaluatedAt === null ? "evaluatedAt" : null,
        artifact.tupleSelectedAt === null ? "tupleSelectedAt" : null,
        artifact.sourceRevision === null ? "sourceRevision" : null,
        artifact.policyVersion === null ? "policyVersion" : null,
        artifact.versions === null ? "versions" : null,
        artifact.corpora.development === null ? "corpora.development" : null,
        artifact.corpora.blind === null ? "corpora.blind" : null,
        artifact.composition.development === null
          ? "composition.development"
          : null,
        artifact.composition.blind === null ? "composition.blind" : null,
        artifact.resultSetHash === null ? "resultSetHash" : null,
        artifact.metrics === null ? "metrics" : null,
      ].filter((field): field is string => field !== null);
      if (missingFields.length > 0) {
        addFailure(failures, {
          code: "harness_artifact_incomplete",
          scope: "prerequisite",
          message: `A passing Issue #482 harness artifact is missing required evidence: ${missingFields.join(", ")}.`,
        });
      }
    }
    if (artifact.sourceRevision !== value.harness.sourceRevision) {
      addFailure(failures, {
        code: "harness_source_revision_mismatch",
        scope: "prerequisite",
        message:
          "Issue #482 harness evidence is not bound to the declared source revision.",
      });
    }
    if (artifact.versions === null) {
      addFailure(failures, {
        code: "harness_versions_missing",
        scope: "prerequisite",
        message:
          "A passing Issue #482 harness artifact must record the exact version tuple.",
      });
    } else {
      const versionMismatches = [
        artifact.versions.modelVersion !== value.tuple.modelIdentifier,
        artifact.versions.promptVersion !== value.tuple.assessmentPromptVersion,
        artifact.versions.taxonomyVersion !== value.tuple.taxonomyVersion,
        artifact.versions.schemaVersion !== value.tuple.assessmentSchemaVersion,
        artifact.versions.validatorVersion !== value.tuple.draftValidatorVersion,
      ];
      if (versionMismatches.some(Boolean)) {
        addFailure(failures, {
          code: "harness_tuple_mismatch",
          scope: "prerequisite",
          message:
            "Issue #482 harness evidence is not bound to the exact model, prompt, taxonomy, schema, and validator tuple.",
        });
      }
    }
  }
  const expectedTupleFingerprint = channelQualityGateTupleFingerprint({
    modelIdentifier: value.tuple.modelIdentifier,
    assessmentPromptVersion: value.tuple.assessmentPromptVersion,
    assessmentSchemaVersion: value.tuple.assessmentSchemaVersion,
    taxonomyVersion: value.tuple.taxonomyVersion,
    draftPromptVersion: value.tuple.draftPromptVersion,
    draftSchemaVersion: value.tuple.draftSchemaVersion,
    draftValidatorVersion: value.tuple.draftValidatorVersion,
  });
  if (value.tuple.tupleFingerprint !== expectedTupleFingerprint) {
    addFailure(failures, {
      code: "tuple_fingerprint_mismatch",
      scope: "prerequisite",
      message: "The tuple fingerprint does not match its model, prompt, taxonomy, schema, and validator fields.",
    });
  }

  const corpusByLanguage = new Map<ChannelQualityLanguage, ChannelQualityGateCorpus>();
  const summaries: ChannelQualityGateCorpusSummary[] = [];
  for (const definition of CHANNEL_EVALUATION_CORPORA) {
    const matches = value.corpora.filter(
      (corpus) => corpus.language === definition.language,
    );
    if (matches.length === 0) {
      addFailure(failures, {
        code: "corpus_missing",
        scope: "corpus",
        language: definition.language,
        message: `No frozen corpus evidence was supplied for issue #${definition.issueNumber}.`,
      });
      addFailure(failures, {
        code: "evaluation_samples_missing",
        scope: "evaluation",
        language: definition.language,
        message: `No blind evaluation samples are available for ${definition.language}.`,
      });
      summaries.push({
        issueNumber: definition.issueNumber,
        corpusId: definition.corpusId,
        language: definition.language,
        status: "missing",
        fingerprint: null,
        sampleCount: 0,
        observedCount: 0,
      });
      continue;
    }
    if (matches.length > 1) {
      addFailure(failures, {
        code: "duplicate_corpus",
        scope: "corpus",
        language: definition.language,
        message: `Multiple corpus records were supplied for ${definition.language}.`,
      });
    }
    const corpus = matches[0]!;
    corpusByLanguage.set(definition.language, corpus);
    const before = failures.length;
    validateCorpus(corpus, definition, failures);
    summaries.push({
      issueNumber: definition.issueNumber,
      corpusId: corpus.corpusId,
      language: definition.language,
      status: failures.length === before ? "ready" : "blocked",
      fingerprint: corpus.fingerprint,
      sampleCount: corpus.samples.length,
      observedCount: 0,
    });
  }
  for (const corpus of value.corpora) {
    if (!CHANNEL_EVALUATION_LANGUAGES.includes(corpus.language)) {
      addFailure(failures, {
        code: "corpus_language_unsupported",
        scope: "corpus",
        message: `Unsupported corpus language ${corpus.language}.`,
      });
    }
  }

  const sampleIndex = new Map<string, IndexedSample>();
  for (const language of CHANNEL_EVALUATION_LANGUAGES) {
    const corpus = corpusByLanguage.get(language);
    if (!corpus) continue;
    for (const sample of corpus.samples) {
      const key = `${corpus.corpusId}:${sample.id}`;
      if (sampleIndex.has(key)) {
        addFailure(failures, {
          code: "duplicate_sample_id",
          scope: "corpus",
          language,
          sampleId: sample.id,
          message: "A sample ID is repeated within the evaluation input.",
        });
      } else {
        sampleIndex.set(key, { corpus, sample, language });
      }
    }
  }

  const observationIndex = new Map<string, ChannelQualityGateObservation>();
  const completed: Array<
    Readonly<{
      indexed: IndexedSample;
      observation: Extract<ChannelQualityGateObservation, { status: "completed" }>;
    }>
  > = [];
  const failedByLanguageAndCategory = new Map<string, number>();
  const completedCountByLanguage = new Map<ChannelQualityLanguage, number>();
  for (const observation of value.observations) {
    const key = `${observation.corpusId}:${observation.sampleId}`;
    const indexed = sampleIndex.get(key);
    if (!indexed) {
      addFailure(failures, {
        code: "observation_sample_unknown",
        scope: "evaluation",
        sampleId: observation.sampleId,
        message: "An evaluation observation does not identify a supplied blind sample.",
      });
      continue;
    }
    if (observationIndex.has(key)) {
      addFailure(failures, {
        code: "duplicate_observation",
        scope: "evaluation",
        language: indexed.language,
        sampleId: observation.sampleId,
        message: "A blind sample has more than one evaluation observation.",
      });
      continue;
    }
    observationIndex.set(key, observation);
    if (observation.corpusFingerprint !== indexed.corpus.fingerprint) {
      addFailure(failures, {
        code: "observation_corpus_mismatch",
        scope: "evaluation",
        language: indexed.language,
        sampleId: observation.sampleId,
        message: "An observation is not bound to the supplied corpus fingerprint.",
      });
    }
    if (observation.tupleFingerprint !== value.tuple.tupleFingerprint) {
      addFailure(failures, {
        code: "observation_tuple_mismatch",
        scope: "evaluation",
        language: indexed.language,
        sampleId: observation.sampleId,
        message: "An observation is not bound to the exact evaluated tuple fingerprint.",
      });
    }
    if (observation.status === "failed") {
      const categoryKey = `${indexed.language}:${indexed.sample.category}`;
      failedByLanguageAndCategory.set(
        categoryKey,
        (failedByLanguageAndCategory.get(categoryKey) ?? 0) + 1,
      );
      continue;
    }
    if (
      observation.draftProduced &&
      indexed.sample.category !== "Actionable Abuse" &&
      indexed.sample.category !== "Safety Flag"
    ) {
      addFailure(failures, {
        code: "draft_produced_for_non_actionable_category",
        scope: "evaluation",
        language: indexed.language,
        sampleId: indexed.sample.id,
        category: indexed.sample.category,
        message:
          "Reply Drafts are only eligible for completed Actionable Abuse samples; other categories must not produce drafts.",
      });
    }
    completedCountByLanguage.set(
      indexed.language,
      (completedCountByLanguage.get(indexed.language) ?? 0) + 1,
    );
    completed.push({ indexed, observation });
  }
  for (const [key, count] of failedByLanguageAndCategory) {
    const [language, category] = key.split(":") as [
      ChannelQualityLanguage,
      ChannelEvaluationCategory,
    ];
    addFailure(failures, {
      code: "evaluation_item_failed",
      scope: "evaluation",
      language,
      category,
      message: `${count} ${language} ${category} evaluation item(s) failed before producing a completed result.`,
      observed: count,
      required: 0,
    });
  }
  for (const [key, indexed] of sampleIndex) {
    if (observationIndex.has(key)) continue;
    const categoryKey = `${indexed.language}:${indexed.sample.category}`;
    failedByLanguageAndCategory.set(
      categoryKey,
      (failedByLanguageAndCategory.get(categoryKey) ?? 0) + 1,
    );
  }
  for (const [key, count] of failedByLanguageAndCategory) {
    const [language, category] = key.split(":") as [
      ChannelQualityLanguage,
      ChannelEvaluationCategory,
    ];
    const hasFailure = failures.some(
      (failure) =>
        failure.code === "evaluation_observations_missing" &&
        failure.language === language &&
        failure.category === category,
    );
    if (hasFailure) continue;
    const sampleCount = [...sampleIndex.values()].filter(
      (indexed) =>
        indexed.language === language && indexed.sample.category === category,
    ).length;
    const completedCount = completed.filter(
      ({ indexed }) =>
        indexed.language === language && indexed.sample.category === category,
    ).length;
    if (count > 0 && completedCount < sampleCount) {
      addFailure(failures, {
        code: "evaluation_observations_missing",
        scope: "evaluation",
        language,
        category,
        message: `${sampleCount - completedCount} ${language} ${category} sample observation(s) are missing or incomplete.`,
        observed: completedCount,
        required: sampleCount,
      });
    }
  }

  const accumulators = languageRecord(emptyAccumulator);
  const zeroToleranceFailures = languageRecord(validatorRecord);
  const completedByKey = new Map(
    completed.map((entry) => [
      `${entry.observation.corpusId}:${entry.observation.sampleId}`,
      entry,
    ]),
  );
  for (const { indexed, observation } of completed) {
    const accumulator = accumulators[indexed.language];
    if (observation.predictedCategory === "Actionable Abuse") {
      accumulator.predictedActionableAbuse += 1;
      if (indexed.sample.category === "Actionable Abuse") {
        accumulator.actionableAbuseTrue += 1;
      }
    }
    if (indexed.sample.category === "Allowed Criticism") {
      accumulator.allowedCriticism += 1;
      if (observation.predictedCategory === "Actionable Abuse") {
        accumulator.allowedCriticismFalsePositive += 1;
      }
    }
    if (indexed.sample.category === "Safety Flag") {
      accumulator.safetyFlag += 1;
      if (observation.predictedCategory === "Safety Flag") {
        accumulator.safetyFlagTrue += 1;
      }
      if (observation.draftProduced) accumulator.safetyFlagDrafts += 1;
      else accumulator.safetyFlagNoDraft += 1;
    }
  }
  for (const language of CHANNEL_EVALUATION_LANGUAGES) {
    const corpus = corpusByLanguage.get(language);
    if (!corpus) continue;
    for (const sample of corpus.samples) {
      const observation = completedByKey.get(`${corpus.corpusId}:${sample.id}`)?.observation;
      if (!observation) continue;
      if (sample.zeroToleranceValidator !== null) {
        for (const validator of observation.validatorFailures) {
          zeroToleranceFailures[language][validator] += 1;
        }
      } else if (observation.validatorFailures.length > 0) {
        addFailure(failures, {
          code: "validator_failure_outside_zero_tolerance_set",
          scope: "validator",
          language,
          sampleId: sample.id,
          message: "A draft-validator failure was reported outside a designated zero-tolerance sample.",
        });
      }
    }
  }

  const metrics = buildMetrics(accumulators, zeroToleranceFailures);
  checkMetrics(metrics, failures);
  for (const language of CHANNEL_EVALUATION_LANGUAGES) {
    for (const validator of ZERO_TOLERANCE_VALIDATORS) {
      const count = metrics.zeroToleranceFailures.byLanguage[language][validator];
      if (count > 0) {
        addFailure(failures, {
          code: "zero_tolerance_validator_failure",
          scope: "validator",
          language,
          category: validator,
          message: `${language} has ${count} ${validator} zero-tolerance validator failure(s).`,
          observed: count,
          required: 0,
        });
      }
    }
  }
  for (const summary of summaries) {
    const observedCount = completedCountByLanguage.get(summary.language) ?? 0;
    const summaryIndex = summaries.findIndex(
      (candidate) => candidate.language === summary.language,
    );
    summaries[summaryIndex] = {
      ...summary,
      observedCount,
      status:
        summary.status === "missing" ||
        failures.some((failure) => failure.language === summary.language)
          ? summary.status === "missing"
            ? "missing"
            : "blocked"
          : "ready",
    };
  }
  return buildReport({
    evaluatedAt: value.evaluatedAt,
    harnessStatus: value.harness.status,
    harness: value.harness,
    evaluatedTuple: value.tuple,
    tupleFingerprint: value.tuple.tupleFingerprint,
    corpora: summaries,
    observationCount: value.observations.length,
    metrics,
    failures,
  });
}

function checkRate(
  metric: ChannelQualityRateMetric,
  failures: ChannelQualityGateFailure[],
  input: Readonly<{
    language?: ChannelQualityLanguage;
    name: string;
    pointMinimum?: number;
    pointMaximum?: number;
    wilsonLowerMinimum?: number;
    wilsonUpperMaximum?: number;
  }>,
): void {
  if (
    metric.rate === null ||
    metric.wilsonLower === null ||
    metric.wilsonUpper === null
  ) {
    addFailure(failures, {
      code: `${input.name}_undefined`,
      scope: "metric",
      message: `${input.name} has no completed trials for ${input.language ?? "overall"}.`,
      ...(input.language === undefined ? {} : { language: input.language }),
    });
    return;
  }
  if (input.pointMinimum !== undefined && metric.rate < input.pointMinimum) {
    addFailure(failures, {
      code: `${input.name}_below_point_threshold`,
      scope: "metric",
      ...(input.language === undefined ? {} : { language: input.language }),
      message: `${input.name} is ${(metric.rate * 100).toFixed(3)}%; the minimum is ${(input.pointMinimum * 100).toFixed(3)}%.`,
      observed: metric.rate,
      required: input.pointMinimum,
    });
  }
  if (input.pointMaximum !== undefined && metric.rate > input.pointMaximum) {
    addFailure(failures, {
      code: `${input.name}_above_point_threshold`,
      scope: "metric",
      ...(input.language === undefined ? {} : { language: input.language }),
      message: `${input.name} is ${(metric.rate * 100).toFixed(3)}%; the maximum is ${(input.pointMaximum * 100).toFixed(3)}%.`,
      observed: metric.rate,
      required: input.pointMaximum,
    });
  }
  if (
    input.wilsonLowerMinimum !== undefined &&
    metric.wilsonLower < input.wilsonLowerMinimum
  ) {
    addFailure(failures, {
      code: `${input.name}_wilson_lower_bound_below_threshold`,
      scope: "metric",
      ...(input.language === undefined ? {} : { language: input.language }),
      message: `${input.name} Wilson lower bound is ${(metric.wilsonLower * 100).toFixed(3)}%; the minimum is ${(input.wilsonLowerMinimum * 100).toFixed(3)}%.`,
      observed: metric.wilsonLower,
      required: input.wilsonLowerMinimum,
    });
  }
  if (
    input.wilsonUpperMaximum !== undefined &&
    metric.wilsonUpper > input.wilsonUpperMaximum
  ) {
    addFailure(failures, {
      code: `${input.name}_wilson_upper_bound_above_threshold`,
      scope: "metric",
      ...(input.language === undefined ? {} : { language: input.language }),
      message: `${input.name} Wilson upper bound is ${(metric.wilsonUpper * 100).toFixed(3)}%; the maximum is ${(input.wilsonUpperMaximum * 100).toFixed(3)}%.`,
      observed: metric.wilsonUpper,
      required: input.wilsonUpperMaximum,
    });
  }
}

function checkMetrics(
  metrics: ChannelQualityGateMetrics,
  failures: ChannelQualityGateFailure[],
): void {
  checkRate(metrics.actionableAbusePrecision.overall, failures, {
    name: "actionable_abuse_precision",
    pointMinimum:
      CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
        .overallPointMinimum,
    wilsonLowerMinimum:
      CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
        .overallLowerWilsonMinimum,
  });
  checkRate(metrics.allowedCriticismFalsePositive.overall, failures, {
    name: "allowed_criticism_false_positive",
    pointMaximum:
      CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
        .overallPointMaximum,
    wilsonUpperMaximum:
      CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
        .overallUpperWilsonMaximum,
  });
  checkRate(metrics.safetyFlagRecall.overall, failures, {
    name: "safety_flag_recall",
    pointMinimum:
      CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall.overallPointMinimum,
    wilsonLowerMinimum:
      CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall.overallLowerWilsonMinimum,
  });
  for (const language of CHANNEL_EVALUATION_LANGUAGES) {
    checkRate(metrics.actionableAbusePrecision.byLanguage[language], failures, {
      language,
      name: "actionable_abuse_precision",
      pointMinimum:
        CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
          .languagePointMinimum,
      wilsonLowerMinimum:
        CHANNEL_QUALITY_GATE_THRESHOLDS.actionableAbusePrecision
          .languageLowerWilsonMinimum,
    });
    checkRate(
      metrics.allowedCriticismFalsePositive.byLanguage[language],
      failures,
      {
        language,
        name: "allowed_criticism_false_positive",
        pointMaximum:
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .languagePointMaximum,
        wilsonUpperMaximum:
          CHANNEL_QUALITY_GATE_THRESHOLDS.allowedCriticismFalsePositiveRate
            .languageUpperWilsonMaximum,
      },
    );
    checkRate(metrics.safetyFlagRecall.byLanguage[language], failures, {
      language,
      name: "safety_flag_recall",
      wilsonLowerMinimum:
        CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall
          .languageLowerWilsonMinimum,
    });
    const draftMetric = metrics.safetyFlagDraftSuppression.byLanguage[language];
    if (
      draftMetric.rate !== null &&
      draftMetric.rate <
        CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagDraftSuppression
          .minimumSuccessRate
    ) {
      addFailure(failures, {
        code: "safety_flag_draft_produced",
        scope: "metric",
        language,
        message: `${language} produced ${draftMetric.failures} Reply Draft(s) for Safety Flag samples; the allowed count is zero.`,
        observed: draftMetric.failures,
        required: 0,
      });
    }
  }
  if (
    metrics.safetyFlagDraftSuppression.overall.rate !== null &&
    metrics.safetyFlagDraftSuppression.overall.rate <
      CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagDraftSuppression
        .minimumSuccessRate
  ) {
    addFailure(failures, {
      code: "safety_flag_draft_produced",
      scope: "metric",
      message: `The evaluation produced ${metrics.safetyFlagDraftSuppression.overall.failures} Reply Draft(s) for Safety Flag samples; the allowed count is zero.`,
      observed: metrics.safetyFlagDraftSuppression.overall.failures,
      required: 0,
    });
  }
}

export function projectEnglishBlindCorpusForQualityGate(
  input: ChannelEnglishBlindEvaluationCorpus,
): ChannelQualityGateCorpus {
  const parsed = ChannelEnglishBlindEvaluationCorpusSchema.parse(input);
  const validation = validateChannelEvaluationCorpus(parsed);
  const coverage = summarizeChannelEvaluationCorpus(parsed);
  const fingerprint = channelEvaluationCorpusFingerprint(parsed);
  return {
    issueNumber: 483,
    corpusId: parsed.corpusId,
    language: "english",
    corpusVersion: parsed.corpusVersion,
    policyVersion: parsed.policyVersion,
    fingerprint,
    blind: true,
    developmentCorpus: false,
    tuningAllowed: parsed.tuning.allowed,
    governance: {
      status: validation.releaseReady ? "passed" : "blocked",
      issues: validation.issues.map((issue) => issue.code),
      blockers: [...validation.blockers],
    },
    coverage: {
      totalItems: coverage.totalItems,
      categoryCounts: coverage.categoryCounts,
      adversarialCount: coverage.adversarialCount,
      zeroToleranceValidatorCount: coverage.zeroToleranceValidatorCount,
      protectedGroupCounts: coverage.protectedGroupCounts,
      minorSafetyCount: coverage.minorSafetyCount,
      reviewerCompleteCount: coverage.reviewerCompleteCount,
    },
    approval: {
      status: parsed.approval.status === "recorded" ? "recorded" : "not_recorded",
      corpusFingerprint: parsed.approval.corpusFingerprint,
    },
    freeze: {
      status: parsed.freeze.status === "recorded" ? "recorded" : "not_recorded",
      corpusFingerprint: parsed.freeze.corpusFingerprint,
    },
    samples: parsed.items.map((item) => ({
      id: item.id,
      language: "english",
      category: item.category,
      adversarialKind: item.adversarialKind,
      zeroToleranceValidator: item.zeroToleranceValidator,
      protectedGroupCrossCuts: item.protectedGroupCrossCuts,
      minorSafety: item.minorSafety,
      codeSwitchEvidence: null,
    })),
  };
}
