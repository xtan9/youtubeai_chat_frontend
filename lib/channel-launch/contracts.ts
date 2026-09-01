import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ChannelQualityGateHarnessEvidenceSchema,
  ChannelQualityGateTupleSchema,
} from "@/lib/channel/quality-gate";
import {
  CHANNEL_QUALITY_CLASSIFICATIONS,
  CHANNEL_QUALITY_CORPUS_MANIFEST_VERSION,
  CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION,
  CHANNEL_QUALITY_EVALUATOR_VERSION,
  CHANNEL_QUALITY_GATE_THRESHOLDS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  type ChannelQualityEvaluationArtifact,
} from "@/lib/channel-quality-evaluation";
import {
  YouTubeComplianceClearanceSchema,
  type YouTubeComplianceClearance,
} from "@/lib/compliance/youtube-channel-clearance";
import {
  YouTubeChannelOAuthVerificationSchema,
  type YouTubeChannelOAuthVerification,
} from "@/lib/compliance/youtube-channel-oauth-verification";

export const CHANNEL_LAUNCH_PACKET_RECORD_TYPE =
  "channel-production-launch-packet" as const;
export const CHANNEL_LAUNCH_PACKET_VERSION = 1 as const;
export const CHANNEL_LAUNCH_ISSUE_NUMBER = 492 as const;
export const CHANNEL_LAUNCH_PACKET_ID = "channel-production-launch-v1" as const;

export const CHANNEL_LAUNCH_DEPENDENCY_ISSUES = [
  479,
  480,
  481,
  487,
  491,
] as const;

export const CHANNEL_LAUNCH_EXTERNAL_GATE_IDS = [
  "youtube_clearance",
  "oauth_verification",
  "live_disclosure_urls",
  "frozen_quality_report",
] as const;

export const CHANNEL_LAUNCH_END_TO_END_EVIDENCE_IDS = [
  "onboarding",
  "identity_switching",
  "scanning",
  "assessment",
  "safety_flags",
  "review",
  "drafting",
  "stale_drafts",
  "publication",
  "publication_uncertainty",
  "deletion",
  "downgrade",
  "disconnect",
  "account_deletion",
] as const;

export const CHANNEL_LAUNCH_ACCESSIBILITY_EVIDENCE_IDS = [
  "keyboard",
  "screen_readers",
  "non_color_state",
  "live_progress",
  "focus_restoration",
  "privacy_reveal",
  "reduced_motion",
  "layout_390px",
] as const;

export const CHANNEL_LAUNCH_QUOTA_LOAD_EVIDENCE_IDS = [
  "scan_limits",
  "daily_reply_limits",
  "shared_quota_exhaustion",
  "concurrent_scan_runs",
  "atomic_publication_claims",
  "cleanup_workers",
] as const;

export const CHANNEL_LAUNCH_RETENTION_DELETION_EVIDENCE_IDS = [
  "thirty_day_refresh_or_deletion",
  "seven_day_downgrade_cleanup",
  "disconnect_cleanup",
  "account_deletion_cleanup",
  "provider_outcome_tracking",
  "public_reply_deletion_provenance",
] as const;

export const CHANNEL_LAUNCH_PRODUCTION_CONTROL_IDS = [
  "featureFlags",
  "cohorts",
  "betaEntitlements",
  "killSwitches",
  "rollbackContracts",
  "globalOAuthRevocationControl",
] as const;

export const YOUTUBE_READONLY_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly" as const;
export const YOUTUBE_FORCE_SSL_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl" as const;
export const CHANNEL_LAUNCH_OAUTH_SCOPES = [
  YOUTUBE_READONLY_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
] as const;

export const CHANNEL_LAUNCH_DISCLOSURE_URL_IDS = [
  "privacy",
  "youtubeData",
  "provider",
  "deletion",
  "revocation",
] as const;

export type ChannelLaunchExternalGateId =
  (typeof CHANNEL_LAUNCH_EXTERNAL_GATE_IDS)[number];
export type ChannelLaunchEndToEndEvidenceId =
  (typeof CHANNEL_LAUNCH_END_TO_END_EVIDENCE_IDS)[number];
export type ChannelLaunchAccessibilityEvidenceId =
  (typeof CHANNEL_LAUNCH_ACCESSIBILITY_EVIDENCE_IDS)[number];
export type ChannelLaunchQuotaLoadEvidenceId =
  (typeof CHANNEL_LAUNCH_QUOTA_LOAD_EVIDENCE_IDS)[number];
export type ChannelLaunchRetentionDeletionEvidenceId =
  (typeof CHANNEL_LAUNCH_RETENTION_DELETION_EVIDENCE_IDS)[number];
export type ChannelLaunchProductionControlId =
  (typeof CHANNEL_LAUNCH_PRODUCTION_CONTROL_IDS)[number];
export type ChannelLaunchDisclosureUrlId =
  (typeof CHANNEL_LAUNCH_DISCLOSURE_URL_IDS)[number];
export type ChannelLaunchOAuthScope = (typeof CHANNEL_LAUNCH_OAUTH_SCOPES)[number];

const NonEmptyStringSchema = z.string().trim().min(1).max(2_000);
const NullableNonEmptyStringSchema = NonEmptyStringSchema.nullable();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const RevisionSchema = z.string().regex(/^[a-f0-9]{40,64}$/u);
const InstantSchema = z.string().datetime({ offset: true });
const NullableInstantSchema = InstantSchema.nullable();
const NonnegativeIntegerSchema = z.number().int().nonnegative();
const ProportionSchema = z.number().min(0).max(1);
const ConcreteVersionSchema = NonEmptyStringSchema.refine(
  (value) =>
    !["latest", "current", "unknown", "unversioned", "pending", "todo"].includes(
      value.toLowerCase(),
    ),
  "Version values must be concrete and non-placeholder.",
);

const strictKeyedObject = <
  const Keys extends readonly string[],
  const ValueSchema extends z.ZodTypeAny,
>(
  keys: Keys,
  valueSchema: ValueSchema,
) =>
  z
    .object(
      Object.fromEntries(keys.map((key) => [key, valueSchema])) as {
        [Key in Keys[number]]: ValueSchema;
      },
    )
    .strict();

export const ChannelLaunchEvidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "not_available",
]);
export type ChannelLaunchEvidenceStatus = z.infer<
  typeof ChannelLaunchEvidenceStatusSchema
>;

export const ChannelLaunchEvidenceSchema = z
  .object({
    status: ChannelLaunchEvidenceStatusSchema,
    evidenceRef: NullableNonEmptyStringSchema,
    artifactSha256: Sha256Schema.nullable(),
    verifiedAt: NullableInstantSchema,
    sourceRevision: RevisionSchema.nullable(),
    failureReason: NullableNonEmptyStringSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.status === "passed") {
      for (const [key, value] of [
        ["evidenceRef", evidence.evidenceRef],
        ["artifactSha256", evidence.artifactSha256],
        ["verifiedAt", evidence.verifiedAt],
        ["sourceRevision", evidence.sourceRevision],
      ] as const) {
        if (value === null) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Passing evidence requires an immutable verification reference.",
          });
        }
      }
      if (evidence.failureReason !== null) {
        context.addIssue({
          code: "custom",
          path: ["failureReason"],
          message: "Passing evidence cannot carry a failure reason.",
        });
      }
    } else if (evidence.failureReason === null) {
      context.addIssue({
        code: "custom",
        path: ["failureReason"],
        message: "Unavailable or failed evidence must explain why it is blocked.",
      });
    }

    if (evidence.status === "not_available") {
      for (const [key, value] of [
        ["evidenceRef", evidence.evidenceRef],
        ["artifactSha256", evidence.artifactSha256],
        ["verifiedAt", evidence.verifiedAt],
        ["sourceRevision", evidence.sourceRevision],
      ] as const) {
        if (value !== null) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Unavailable evidence cannot claim a verified artifact.",
          });
        }
      }
    }
  });
export type ChannelLaunchEvidence = z.infer<typeof ChannelLaunchEvidenceSchema>;

const ChecklistEvidenceSchema = ChannelLaunchEvidenceSchema;

const DependencyIssueSchema = z.union([
  z.literal(479),
  z.literal(480),
  z.literal(481),
  z.literal(487),
  z.literal(491),
]);

export const ChannelLaunchDependencyEvidenceSchema = z
  .object({
    issueNumber: DependencyIssueSchema,
    evidence: ChannelLaunchEvidenceSchema,
  })
  .strict();
export type ChannelLaunchDependencyEvidence = z.infer<
  typeof ChannelLaunchDependencyEvidenceSchema
>;

export const ChannelLaunchYouTubeClearanceEvidenceSchema = z
  .object({
    evidence: ChannelLaunchEvidenceSchema,
    clearance: YouTubeComplianceClearanceSchema.nullable(),
  })
  .strict();

export const ChannelLaunchOAuthVerificationEvidenceSchema = z
  .object({
    evidence: ChannelLaunchEvidenceSchema,
    verification: YouTubeChannelOAuthVerificationSchema.nullable(),
    productionClientId: NullableNonEmptyStringSchema,
    verifiedScopes: z
      .array(z.enum(CHANNEL_LAUNCH_OAUTH_SCOPES))
      .max(CHANNEL_LAUNCH_OAUTH_SCOPES.length)
      .nullable(),
    incrementalAuthorizationVerified: z.boolean().nullable(),
    identityVerificationVerified: z.boolean().nullable(),
    productionClientVerified: z.boolean().nullable(),
  })
  .strict();

const LiveDisclosureCheckSchema = z
  .object({
    url: z.string().url(),
    statusCode: z.literal(200),
    checkedAt: InstantSchema,
    contentSha256: Sha256Schema,
  })
  .strict();

const DisclosureUrlSchema = z.string().url().nullable();
const DisclosureUrlsSchema = z
  .object({
    privacy: DisclosureUrlSchema,
    youtubeData: DisclosureUrlSchema,
    provider: DisclosureUrlSchema,
    deletion: DisclosureUrlSchema,
    revocation: DisclosureUrlSchema,
  })
  .strict();
const DisclosureChecksSchema = z
  .object({
    privacy: LiveDisclosureCheckSchema.nullable(),
    youtubeData: LiveDisclosureCheckSchema.nullable(),
    provider: LiveDisclosureCheckSchema.nullable(),
    deletion: LiveDisclosureCheckSchema.nullable(),
    revocation: LiveDisclosureCheckSchema.nullable(),
  })
  .strict();

export const ChannelLaunchLiveDisclosureEvidenceSchema = z
  .object({
    evidence: ChannelLaunchEvidenceSchema,
    urls: DisclosureUrlsSchema,
    checks: DisclosureChecksSchema,
  })
  .strict();

const QualityRateSchema = z
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
        message: "Successes cannot exceed trials.",
      });
    }
    if (rate.interval95.lower > rate.interval95.upper) {
      context.addIssue({
        code: "custom",
        path: ["interval95"],
        message: "The Wilson lower bound cannot exceed the upper bound.",
      });
    }
  });

const QualityValidatorRateSchema = QualityRateSchema.extend({
  acceptedUnsafeCount: NonnegativeIntegerSchema,
  missingExpectedRejectionCount: NonnegativeIntegerSchema,
}).strict();

const QualityMetricSetSchema = z
  .object({
    actionableAbusePrecision: QualityRateSchema.nullable(),
    allowedCriticismFalsePositiveRate: QualityRateSchema.nullable(),
    safetyFlagRecall: QualityRateSchema.nullable(),
    safetyFlagDraftSuppression: QualityRateSchema.nullable(),
    draftValidator: strictKeyedObject(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
      QualityValidatorRateSchema.nullable(),
    ),
  })
  .strict();

const QualityMetricsSchema = z
  .object({
    overall: QualityMetricSetSchema,
    byLanguage: strictKeyedObject(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
      QualityMetricSetSchema,
    ),
    byCrossCut: strictKeyedObject(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
      QualityMetricSetSchema,
    ),
  })
  .strict();

const QualityCompositionPerLanguageSchema = z
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

const QualityCompositionSchema = z
  .object({
    itemCount: NonnegativeIntegerSchema,
    perLanguage: strictKeyedObject(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
      QualityCompositionPerLanguageSchema,
    ),
    crossCuts: strictKeyedObject(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
      NonnegativeIntegerSchema,
    ),
  })
  .strict();

const QualityGateFailureSchema = z
  .object({
    code: NonEmptyStringSchema,
    scope: NonEmptyStringSchema,
    detail: NonEmptyStringSchema,
    category: NonEmptyStringSchema.optional(),
  })
  .strict();

const QualityThresholdsSchema = z
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
          CHANNEL_QUALITY_GATE_THRESHOLDS.safetyFlagRecall.overallPointMinimum,
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

const QualityCorpusReferenceSchema = z
  .object({
    manifestVersion: z.literal(CHANNEL_QUALITY_CORPUS_MANIFEST_VERSION),
    corpusVersion: ConcreteVersionSchema,
    split: z.enum(["development", "blind"]),
    state: z.enum(["open", "frozen"]),
    frozenAt: NullableInstantSchema,
    manifestHash: Sha256Schema,
    itemCount: z.number().int().nonnegative(),
    dataGovernance: z.enum(["synthetic", "separately_governed"]),
    governanceReference: NullableNonEmptyStringSchema,
    reviewerProvenance: z
      .object({
        protocol: z.literal(
          "two_independent_reviewers_third_resolves_disagreement",
        ),
        reviewerIds: z
          .array(NonEmptyStringSchema)
          .min(3)
          .max(20)
          .superRefine((reviewerIds, context) => {
            if (new Set(reviewerIds).size !== reviewerIds.length) {
              context.addIssue({
                code: "custom",
                message: "Reviewer provenance must list unique reviewers.",
              });
            }
          }),
      })
      .strict(),
  })
  .strict();

const QualityVersionTupleSchema = z
  .object({
    modelVersion: NonEmptyStringSchema,
    promptVersion: NonEmptyStringSchema,
    taxonomyVersion: NonEmptyStringSchema,
    schemaVersion: NonEmptyStringSchema,
    validatorVersion: NonEmptyStringSchema,
  })
  .strict();

export const ChannelLaunchQualityEvaluationArtifactSchema = z
  .object({
    artifactVersion: z.literal(CHANNEL_QUALITY_EVALUATION_ARTIFACT_VERSION),
    evaluatorVersion: z.literal(CHANNEL_QUALITY_EVALUATOR_VERSION),
    thresholds: QualityThresholdsSchema,
    outcome: z.enum(["passed", "failed"]),
    evaluatedAt: NullableInstantSchema,
    tupleSelectedAt: NullableInstantSchema,
    sourceRevision: RevisionSchema.nullable(),
    policyVersion: ConcreteVersionSchema.nullable(),
    versions: QualityVersionTupleSchema.nullable(),
    corpora: z
      .object({
        development: QualityCorpusReferenceSchema.nullable(),
        blind: QualityCorpusReferenceSchema.nullable(),
      })
      .strict(),
    composition: z
      .object({
        development: QualityCompositionSchema.nullable(),
        blind: QualityCompositionSchema.nullable(),
      })
      .strict(),
    resultSetHash: Sha256Schema.nullable(),
    metrics: QualityMetricsSchema.nullable(),
    reproducibility: z
      .object({
        status: z.enum(["verified", "not_verified"]),
        inputFingerprint: Sha256Schema.nullable(),
      })
      .strict(),
    gate: z
      .object({
        outcome: z.enum(["passed", "failed"]),
        failures: z.array(QualityGateFailureSchema),
      })
      .strict(),
    evaluationFingerprint: Sha256Schema,
  })
  .strict();
export type ChannelLaunchQualityEvaluationArtifact = z.infer<
  typeof ChannelLaunchQualityEvaluationArtifactSchema
>;

export const ChannelLaunchQualityGateTupleSchema = ChannelQualityGateTupleSchema;
export type ChannelLaunchQualityGateTuple = z.infer<
  typeof ChannelLaunchQualityGateTupleSchema
>;

export const ChannelLaunchQualityGateHarnessSchema =
  ChannelQualityGateHarnessEvidenceSchema;
export type ChannelLaunchQualityGateHarnessEvidence = z.infer<
  typeof ChannelLaunchQualityGateHarnessSchema
>;

export const ChannelLaunchQualityGateCorpusSummarySchema = z
  .object({
    issueNumber: z.number().int().positive().nullable(),
    corpusId: NullableNonEmptyStringSchema,
    language: z.enum(CHANNEL_QUALITY_SUPPORTED_LANGUAGES),
    status: z.enum(["ready", "blocked", "missing"]),
    fingerprint: Sha256Schema.nullable(),
    sampleCount: z.number().int().nonnegative(),
    observedCount: z.number().int().nonnegative(),
  })
  .strict();
export type ChannelLaunchQualityGateCorpusSummary = z.infer<
  typeof ChannelLaunchQualityGateCorpusSummarySchema
>;

const QualityGateRateMetricSchema = z
  .object({
    numerator: NonnegativeIntegerSchema,
    denominator: NonnegativeIntegerSchema,
    successes: NonnegativeIntegerSchema,
    failures: NonnegativeIntegerSchema,
    trials: NonnegativeIntegerSchema,
    rate: ProportionSchema.nullable(),
    wilsonLower: ProportionSchema.nullable(),
    wilsonUpper: ProportionSchema.nullable(),
  })
  .strict();

const QualityGateMetricsSchema = z
  .object({
    actionableAbusePrecision: z
      .object({
        overall: QualityGateRateMetricSchema,
        byLanguage: strictKeyedObject(
          CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
          QualityGateRateMetricSchema,
        ),
      })
      .strict(),
    allowedCriticismFalsePositive: z
      .object({
        overall: QualityGateRateMetricSchema,
        byLanguage: strictKeyedObject(
          CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
          QualityGateRateMetricSchema,
        ),
      })
      .strict(),
    safetyFlagRecall: z
      .object({
        overall: QualityGateRateMetricSchema,
        byLanguage: strictKeyedObject(
          CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
          QualityGateRateMetricSchema,
        ),
      })
      .strict(),
    safetyFlagDraftSuppression: z
      .object({
        overall: QualityGateRateMetricSchema,
        byLanguage: strictKeyedObject(
          CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
          QualityGateRateMetricSchema,
        ),
      })
      .strict(),
    zeroToleranceFailures: z
      .object({
        overall: strictKeyedObject(
          CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
          NonnegativeIntegerSchema,
        ),
        byLanguage: strictKeyedObject(
          CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
          strictKeyedObject(
            CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
            NonnegativeIntegerSchema,
          ),
        ),
      })
      .strict(),
  })
  .strict();

const QualityGateReportFailureSchema = z
  .object({
    code: NonEmptyStringSchema,
    scope: NonEmptyStringSchema,
    language: z.enum(CHANNEL_QUALITY_SUPPORTED_LANGUAGES).optional(),
    sampleId: NonEmptyStringSchema.optional(),
    category: NonEmptyStringSchema.optional(),
    message: NonEmptyStringSchema,
    observed: z.number().nonnegative().optional(),
    required: z.number().nonnegative().optional(),
  })
  .strict();

export const ChannelLaunchQualityGateReportSchema = z
  .object({
    recordType: z.literal("channel-quality-gate-report-v1"),
    recordVersion: z.literal(1),
    evaluatedAt: NullableInstantSchema,
    decision: z.enum(["passed", "blocked"]),
    releaseReviewEligible: z.boolean(),
    productionActivationPerformed: z.literal(false),
    harnessStatus: z.enum(["available", "not_available", "invalid"]),
    harness: ChannelLaunchQualityGateHarnessSchema.nullable(),
    evaluatedTuple: ChannelLaunchQualityGateTupleSchema.nullable(),
    tupleFingerprint: Sha256Schema.nullable(),
    corpora: z
      .array(ChannelLaunchQualityGateCorpusSummarySchema)
      .min(CHANNEL_QUALITY_SUPPORTED_LANGUAGES.length),
    observationCount: z.number().int().nonnegative(),
    metrics: QualityGateMetricsSchema,
    failures: z.array(QualityGateReportFailureSchema),
    blockers: z.array(NonEmptyStringSchema),
    nonClaims: z.array(NonEmptyStringSchema).min(1),
    evaluationFingerprint: Sha256Schema,
  })
  .strict();
export type ChannelLaunchQualityGateReport = z.infer<
  typeof ChannelLaunchQualityGateReportSchema
>;

export const ChannelLaunchQualityReportSchema = z.union([
  ChannelLaunchQualityEvaluationArtifactSchema,
  ChannelLaunchQualityGateReportSchema,
]);
export type ChannelLaunchQualityReport = z.infer<
  typeof ChannelLaunchQualityReportSchema
>;

export const ChannelLaunchProductionControlStateSchema = z.enum([
  "absent",
  "present",
  "unverified",
]);
export type ChannelLaunchProductionControlState = z.infer<
  typeof ChannelLaunchProductionControlStateSchema
>;

export const ChannelLaunchProductionConfigurationEvidenceSchema = z
  .object({
    evidence: ChannelLaunchEvidenceSchema,
    runtimeControls: z
      .object({
        featureFlags: ChannelLaunchProductionControlStateSchema,
        cohorts: ChannelLaunchProductionControlStateSchema,
        betaEntitlements: ChannelLaunchProductionControlStateSchema,
        killSwitches: ChannelLaunchProductionControlStateSchema,
        rollbackContracts: ChannelLaunchProductionControlStateSchema,
        globalOAuthRevocationControl: ChannelLaunchProductionControlStateSchema,
      })
      .strict(),
    channelReachability: z.literal("unreachable_until_packet_passes"),
  })
  .strict();

export const ChannelLaunchPacketBodySchema = z
  .object({
    recordType: z.literal(CHANNEL_LAUNCH_PACKET_RECORD_TYPE),
    recordVersion: z.literal(CHANNEL_LAUNCH_PACKET_VERSION),
    issueNumber: z.literal(CHANNEL_LAUNCH_ISSUE_NUMBER),
    packetId: z.literal(CHANNEL_LAUNCH_PACKET_ID),
    frozenAt: NullableInstantSchema,
    sourceRevision: RevisionSchema.nullable(),
    decision: z.enum(["blocked", "passed"]),
    releaseReviewEligible: z.boolean(),
    productionActivationPerformed: z.literal(false),
    dependencies: z.array(ChannelLaunchDependencyEvidenceSchema).min(
      CHANNEL_LAUNCH_DEPENDENCY_ISSUES.length,
    ),
    externalGates: z
      .object({
        youtubeClearance: ChannelLaunchYouTubeClearanceEvidenceSchema,
        oauthVerification: ChannelLaunchOAuthVerificationEvidenceSchema,
        liveDisclosureUrls: ChannelLaunchLiveDisclosureEvidenceSchema,
        frozenQualityReport: z
          .object({
            evidence: ChannelLaunchEvidenceSchema,
            report: ChannelLaunchQualityReportSchema.nullable(),
          })
          .strict(),
      })
      .strict(),
    endToEnd: z
      .object({
        onboarding: ChecklistEvidenceSchema,
        identity_switching: ChecklistEvidenceSchema,
        scanning: ChecklistEvidenceSchema,
        assessment: ChecklistEvidenceSchema,
        safety_flags: ChecklistEvidenceSchema,
        review: ChecklistEvidenceSchema,
        drafting: ChecklistEvidenceSchema,
        stale_drafts: ChecklistEvidenceSchema,
        publication: ChecklistEvidenceSchema,
        publication_uncertainty: ChecklistEvidenceSchema,
        deletion: ChecklistEvidenceSchema,
        downgrade: ChecklistEvidenceSchema,
        disconnect: ChecklistEvidenceSchema,
        account_deletion: ChecklistEvidenceSchema,
      })
      .strict(),
    accessibility: z
      .object({
        keyboard: ChecklistEvidenceSchema,
        screen_readers: ChecklistEvidenceSchema,
        non_color_state: ChecklistEvidenceSchema,
        live_progress: ChecklistEvidenceSchema,
        focus_restoration: ChecklistEvidenceSchema,
        privacy_reveal: ChecklistEvidenceSchema,
        reduced_motion: ChecklistEvidenceSchema,
        layout_390px: ChecklistEvidenceSchema,
      })
      .strict(),
    quotaLoad: z
      .object({
        scan_limits: ChecklistEvidenceSchema,
        daily_reply_limits: ChecklistEvidenceSchema,
        shared_quota_exhaustion: ChecklistEvidenceSchema,
        concurrent_scan_runs: ChecklistEvidenceSchema,
        atomic_publication_claims: ChecklistEvidenceSchema,
        cleanup_workers: ChecklistEvidenceSchema,
      })
      .strict(),
    retentionDeletion: z
      .object({
        thirty_day_refresh_or_deletion: ChecklistEvidenceSchema,
        seven_day_downgrade_cleanup: ChecklistEvidenceSchema,
        disconnect_cleanup: ChecklistEvidenceSchema,
        account_deletion_cleanup: ChecklistEvidenceSchema,
        provider_outcome_tracking: ChecklistEvidenceSchema,
        public_reply_deletion_provenance: ChecklistEvidenceSchema,
      })
      .strict(),
    productionConfiguration: ChannelLaunchProductionConfigurationEvidenceSchema,
    nonClaims: z.array(NonEmptyStringSchema).min(1).max(50),
  })
  .strict();

export const ChannelLaunchPacketSchema = ChannelLaunchPacketBodySchema.extend({
  packetFingerprint: Sha256Schema,
}).strict();

export type ChannelLaunchPacketBody = z.infer<
  typeof ChannelLaunchPacketBodySchema
>;
export type ChannelLaunchPacket = z.infer<typeof ChannelLaunchPacketSchema>;
export type ChannelLaunchPacketDraft = ChannelLaunchPacketBody;
export type ChannelLaunchYouTubeClearanceEvidence = z.infer<
  typeof ChannelLaunchYouTubeClearanceEvidenceSchema
>;
export type ChannelLaunchOAuthVerificationEvidence = z.infer<
  typeof ChannelLaunchOAuthVerificationEvidenceSchema
>;
export type ChannelLaunchLiveDisclosureEvidence = z.infer<
  typeof ChannelLaunchLiveDisclosureEvidenceSchema
>;
export type ChannelLaunchProductionConfigurationEvidence = z.infer<
  typeof ChannelLaunchProductionConfigurationEvidenceSchema
>;

export function createChannelLaunchPacket(
  input: ChannelLaunchPacketDraft,
): ChannelLaunchPacket {
  const parsed = ChannelLaunchPacketBodySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("ChannelLaunchPacketInvalid");
  }
  const body = parsed.data;
  return deepFreeze({
    ...body,
    packetFingerprint: hashChannelLaunchValue(body),
  });
}

export function parseChannelLaunchPacket(input: unknown): ChannelLaunchPacket {
  const parsed = ChannelLaunchPacketSchema.safeParse(input);
  if (!parsed.success) throw new Error("ChannelLaunchPacketInvalid");
  return deepFreeze(parsed.data);
}

export function verifyChannelLaunchPacketFingerprint(
  input: unknown,
): input is ChannelLaunchPacket {
  const parsed = ChannelLaunchPacketSchema.safeParse(input);
  if (!parsed.success) return false;
  const { packetFingerprint, ...body } = parsed.data;
  return hashChannelLaunchValue(body) === packetFingerprint;
}

export function hashChannelLaunchValue(value: unknown): string {
  return createHash("sha256")
    .update(canonicalChannelLaunchJson(value), "utf8")
    .digest("hex");
}

export function canonicalChannelLaunchJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("Cannot fingerprint an undefined Channel launch value");
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => canonicalChannelLaunchJson(entry))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => {
      if (record[key] === undefined) {
        throw new Error(`Cannot fingerprint undefined field ${key}`);
      }
      return `${JSON.stringify(key)}:${canonicalChannelLaunchJson(record[key])}`;
    })
    .join(",")}}`;
}

export function createUnavailableChannelLaunchPacket(
  reason = "Required launch evidence is not available in this repository.",
): ChannelLaunchPacket {
  const evidence = (): ChannelLaunchEvidence => ({
    status: "not_available",
    evidenceRef: null,
    artifactSha256: null,
    verifiedAt: null,
    sourceRevision: null,
    failureReason: reason,
  });
  const checklist = () => evidence();
  const nullUrls = {
    privacy: null,
    youtubeData: null,
    provider: null,
    deletion: null,
    revocation: null,
  } as const;
  const nullChecks = {
    privacy: null,
    youtubeData: null,
    provider: null,
    deletion: null,
    revocation: null,
  } as const;

  return createChannelLaunchPacket({
    recordType: CHANNEL_LAUNCH_PACKET_RECORD_TYPE,
    recordVersion: CHANNEL_LAUNCH_PACKET_VERSION,
    issueNumber: CHANNEL_LAUNCH_ISSUE_NUMBER,
    packetId: CHANNEL_LAUNCH_PACKET_ID,
    frozenAt: null,
    sourceRevision: null,
    decision: "blocked",
    releaseReviewEligible: false,
    productionActivationPerformed: false,
    dependencies: CHANNEL_LAUNCH_DEPENDENCY_ISSUES.map((issueNumber) => ({
      issueNumber,
      evidence: evidence(),
    })),
    externalGates: {
      youtubeClearance: {
        evidence: evidence(),
        clearance: null,
      },
      oauthVerification: {
        evidence: evidence(),
        verification: null,
        productionClientId: null,
        verifiedScopes: null,
        incrementalAuthorizationVerified: null,
        identityVerificationVerified: null,
        productionClientVerified: null,
      },
      liveDisclosureUrls: {
        evidence: evidence(),
        urls: nullUrls,
        checks: nullChecks,
      },
      frozenQualityReport: { evidence: evidence(), report: null },
    },
    endToEnd: {
      onboarding: checklist(),
      identity_switching: checklist(),
      scanning: checklist(),
      assessment: checklist(),
      safety_flags: checklist(),
      review: checklist(),
      drafting: checklist(),
      stale_drafts: checklist(),
      publication: checklist(),
      publication_uncertainty: checklist(),
      deletion: checklist(),
      downgrade: checklist(),
      disconnect: checklist(),
      account_deletion: checklist(),
    },
    accessibility: {
      keyboard: checklist(),
      screen_readers: checklist(),
      non_color_state: checklist(),
      live_progress: checklist(),
      focus_restoration: checklist(),
      privacy_reveal: checklist(),
      reduced_motion: checklist(),
      layout_390px: checklist(),
    },
    quotaLoad: {
      scan_limits: checklist(),
      daily_reply_limits: checklist(),
      shared_quota_exhaustion: checklist(),
      concurrent_scan_runs: checklist(),
      atomic_publication_claims: checklist(),
      cleanup_workers: checklist(),
    },
    retentionDeletion: {
      thirty_day_refresh_or_deletion: checklist(),
      seven_day_downgrade_cleanup: checklist(),
      disconnect_cleanup: checklist(),
      account_deletion_cleanup: checklist(),
      provider_outcome_tracking: checklist(),
      public_reply_deletion_provenance: checklist(),
    },
    productionConfiguration: {
      evidence: evidence(),
      runtimeControls: {
        featureFlags: "unverified",
        cohorts: "unverified",
        betaEntitlements: "unverified",
        killSwitches: "unverified",
        rollbackContracts: "unverified",
        globalOAuthRevocationControl: "unverified",
      },
      channelReachability: "unreachable_until_packet_passes",
    },
    nonClaims: [
      "This blocked inventory does not claim written YouTube clearance.",
      "This blocked inventory does not claim OAuth verification, live URLs, licensed data, human approval, or production evidence.",
      "A packet pass would make the release eligible for review only; it never activates Channel or changes entitlements.",
    ],
  });
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export type ChannelLaunchClearanceRecord = YouTubeComplianceClearance;
export type ChannelLaunchOAuthVerificationRecord =
  YouTubeChannelOAuthVerification;
export type ChannelLaunchQualityArtifact = ChannelQualityEvaluationArtifact;
