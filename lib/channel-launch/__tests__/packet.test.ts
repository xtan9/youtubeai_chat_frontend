import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CHANNEL_QUALITY_GATE_THRESHOLDS,
  CHANNEL_QUALITY_MINIMUMS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
} from "@/lib/channel-quality-evaluation";
import {
  createUnavailableChannelLaunchPacket,
  createChannelLaunchPacket,
  evaluateChannelLaunchPacket,
  hashChannelLaunchValue,
  verifyChannelLaunchPacketFingerprint,
} from "../packet";

const SOURCE_REVISION = "a".repeat(40);
const VERIFIED_AT = "2026-09-01T12:00:00.000Z";
const QUALITY_POLICY_VERSION = "channel-comment-assistance-test-v1";
const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");
type QualityLanguage = (typeof CHANNEL_QUALITY_SUPPORTED_LANGUAGES)[number];
type QualityCrossCut = (typeof CHANNEL_QUALITY_REQUIRED_CROSS_CUTS)[number];
type QualityValidatorCategory =
  (typeof CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES)[number];

function passedEvidence(id: string) {
  return {
    status: "passed" as const,
    evidenceRef: `test://channel-launch/${id}`,
    artifactSha256: hashChannelLaunchValue({ id }),
    verifiedAt: VERIFIED_AT,
    sourceRevision: SOURCE_REVISION,
    failureReason: null,
  };
}

function qualityCorpusReference(
  split: "development" | "blind",
  frozen: boolean,
) {
  return {
    manifestVersion: "channel-quality-corpus-manifest-v1" as const,
    corpusVersion: "channel-comment-assistance-test-v1",
    split,
    state: frozen ? ("frozen" as const) : ("open" as const),
    frozenAt: frozen ? "2026-09-01T10:00:00.000Z" : null,
    manifestHash: "b".repeat(64),
    itemCount: 5_000,
    dataGovernance: "synthetic" as const,
    governanceReference: null,
    reviewerProvenance: {
      protocol: "two_independent_reviewers_third_resolves_disagreement",
      reviewerIds: ["reviewer-primary", "reviewer-secondary", "reviewer-adjudicator"],
    },
  };
}

function qualityRate() {
  return {
    successes: 1,
    trials: 1,
    estimate: 1,
    interval95: { lower: 1, upper: 1 },
  };
}

function zeroQualityRate() {
  return {
    successes: 0,
    trials: 1,
    estimate: 0,
    interval95: { lower: 0, upper: 0 },
  };
}

function qualityValidatorRate() {
  return {
    ...qualityRate(),
    acceptedUnsafeCount: 0,
    missingExpectedRejectionCount: 0,
  };
}

function qualityMetricSet() {
  return {
    actionableAbusePrecision: qualityRate(),
    allowedCriticismFalsePositiveRate: zeroQualityRate(),
    safetyFlagRecall: qualityRate(),
    safetyFlagDraftSuppression: qualityRate(),
    draftValidator: Object.fromEntries(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
        (category) => [category, qualityValidatorRate()],
      ),
    ) as Record<QualityValidatorCategory, ReturnType<typeof qualityValidatorRate>>,
  };
}

function qualityMetrics() {
  return {
    overall: qualityMetricSet(),
    byLanguage: Object.fromEntries(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => [
        language,
        qualityMetricSet(),
      ]),
    ) as Record<QualityLanguage, ReturnType<typeof qualityMetricSet>>,
    byCrossCut: Object.fromEntries(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS.map((crossCut) => [
        crossCut,
        qualityMetricSet(),
      ]),
    ) as Record<QualityCrossCut, ReturnType<typeof qualityMetricSet>>,
  };
}

function qualityCompositionPerLanguage() {
  return {
    classification: 950,
    classificationByLabel: {
      allowed_criticism: CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.allowed_criticism,
      actionable_abuse: CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.actionable_abuse,
      reviewable_interaction:
        CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.reviewable_interaction,
      safety_flag: CHANNEL_QUALITY_MINIMUMS.perLanguage.classifications.safety_flag,
    },
    adversarial: CHANNEL_QUALITY_MINIMUMS.perLanguage.adversarial,
    validator: CHANNEL_QUALITY_MINIMUMS.perLanguage.validator,
    validatorByCategory: Object.fromEntries(
      CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
        (category, index) => [category, index < 10 ? 21 : 20],
      ),
    ) as Record<QualityValidatorCategory, number>,
    totalClassificationAndAdversarial:
      CHANNEL_QUALITY_MINIMUMS.perLanguage.totalClassificationAndAdversarial,
  };
}

function qualityComposition() {
  return {
    itemCount: 5_000,
    perLanguage: Object.fromEntries(
      CHANNEL_QUALITY_SUPPORTED_LANGUAGES.map((language) => [
        language,
        qualityCompositionPerLanguage(),
      ]),
    ) as Record<QualityLanguage, ReturnType<typeof qualityCompositionPerLanguage>>,
    crossCuts: Object.fromEntries(
      CHANNEL_QUALITY_REQUIRED_CROSS_CUTS.map((crossCut) => [
        crossCut,
        crossCut === "minor_safety"
          ? CHANNEL_QUALITY_MINIMUMS.minorSafety
        : CHANNEL_QUALITY_MINIMUMS.eachRequiredCrossCut,
      ]),
    ) as Record<QualityCrossCut, number>,
  };
}

function passingQualityReport() {
  const body = {
    artifactVersion: "channel-quality-evaluation-v1" as const,
    evaluatorVersion: "channel-quality-evaluator-v1" as const,
    thresholds: CHANNEL_QUALITY_GATE_THRESHOLDS,
    outcome: "passed" as const,
    evaluatedAt: VERIFIED_AT,
    tupleSelectedAt: "2026-09-01T11:00:00.000Z",
    sourceRevision: SOURCE_REVISION,
    policyVersion: QUALITY_POLICY_VERSION,
    versions: {
      modelVersion: "channel-model-test-v1",
      promptVersion: "channel-prompt-test-v1",
      taxonomyVersion: "channel-taxonomy-test-v1",
      schemaVersion: "channel-schema-test-v1",
      validatorVersion: "channel-validator-test-v1",
    },
    corpora: {
      development: qualityCorpusReference("development", false),
      blind: qualityCorpusReference("blind", true),
    },
    composition: {
      development: qualityComposition(),
      blind: qualityComposition(),
    },
    resultSetHash: "c".repeat(64),
    metrics: qualityMetrics(),
    reproducibility: {
      status: "verified" as const,
      inputFingerprint: "d".repeat(64),
    },
    gate: { outcome: "passed" as const, failures: [] },
  };
  return {
    ...body,
    evaluationFingerprint: hashChannelLaunchValue(body),
  };
}

function passingQualityGateReport() {
  const tupleBody = {
    modelIdentifier: "channel-model-test-v1",
    assessmentPromptVersion: "channel-prompt-test-v1",
    assessmentSchemaVersion: "channel-schema-test-v1",
    taxonomyVersion: "channel-taxonomy-test-v1",
    draftPromptVersion: "channel-draft-prompt-test-v1",
    draftSchemaVersion: "channel-draft-schema-test-v1",
    draftValidatorVersion: "channel-validator-test-v1",
  };
  const tuple = {
    ...tupleBody,
    tupleFingerprint: hashChannelLaunchValue(tupleBody),
  };
  const languages = [
    "english",
    "simplified_chinese",
    "traditional_chinese",
    "chinese_english_code_switch",
  ] as const;
  const corpora = languages.map((language, index) => ({
    issueNumber: 483 + index,
    corpusId: `channel-${language}-test-v1`,
    language,
    status: "ready" as const,
    fingerprint: hashChannelLaunchValue({ language }),
    sampleCount: 1_000,
    observedCount: 1_000,
  }));
  const qualityGateRateMetric = {
    numerator: 1,
    denominator: 1,
    successes: 1,
    failures: 0,
    trials: 1,
    rate: 1,
    wilsonLower: 1,
    wilsonUpper: 1,
  };
  const qualityGateZeroRateMetric = {
    numerator: 0,
    denominator: 1,
    successes: 0,
    failures: 1,
    trials: 1,
    rate: 0,
    wilsonLower: 0,
    wilsonUpper: 0,
  };
  const qualityGateMetrics = {
    actionableAbusePrecision: {
      overall: qualityGateRateMetric,
      byLanguage: Object.fromEntries(
        languages.map((language) => [language, qualityGateRateMetric]),
      ) as Record<QualityLanguage, typeof qualityGateRateMetric>,
    },
    allowedCriticismFalsePositive: {
      overall: qualityGateZeroRateMetric,
      byLanguage: Object.fromEntries(
        languages.map((language) => [language, qualityGateZeroRateMetric]),
      ) as Record<QualityLanguage, typeof qualityGateZeroRateMetric>,
    },
    safetyFlagRecall: {
      overall: qualityGateRateMetric,
      byLanguage: Object.fromEntries(
        languages.map((language) => [language, qualityGateRateMetric]),
      ) as Record<QualityLanguage, typeof qualityGateRateMetric>,
    },
    safetyFlagDraftSuppression: {
      overall: qualityGateRateMetric,
      byLanguage: Object.fromEntries(
        languages.map((language) => [language, qualityGateRateMetric]),
      ) as Record<QualityLanguage, typeof qualityGateRateMetric>,
    },
    zeroToleranceFailures: {
      overall: Object.fromEntries(
        CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
          (category) => [category, 0],
        ),
      ) as Record<QualityValidatorCategory, number>,
      byLanguage: Object.fromEntries(
        languages.map((language) => [
          language,
          Object.fromEntries(
            CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES.map(
              (category) => [category, 0],
            ),
          ),
        ]),
      ) as Record<QualityLanguage, Record<QualityValidatorCategory, number>>,
    },
  };
  const body = {
    recordType: "channel-quality-gate-report-v1" as const,
    recordVersion: 1 as const,
    evaluatedAt: VERIFIED_AT,
    decision: "passed" as const,
    releaseReviewEligible: true,
    productionActivationPerformed: false as const,
    harnessStatus: "available" as const,
    harness: {
      issueNumber: 482 as const,
      status: "available" as const,
      sourceRevision: SOURCE_REVISION,
      artifact: passingQualityReport(),
    },
    evaluatedTuple: tuple,
    tupleFingerprint: tuple.tupleFingerprint,
    corpora,
    observationCount: 4_000,
    metrics: qualityGateMetrics,
    failures: [],
    blockers: [],
    nonClaims: ["This test-only report is not production evidence."],
  };
  return {
    ...body,
    evaluationFingerprint: hashChannelLaunchValue(body),
  };
}

function permittedClearance() {
  return {
    recordType: "youtube-channel-comment-assistance-compliance-clearance" as const,
    recordVersion: 1 as const,
    issueNumber: 470 as const,
    sourceSpec: {
      path: "docs/specs/2026-08-31-comment-assistance-discovery.md" as const,
      url: "https://github.com/xtan9/youtubeai_chat_frontend/blob/main/docs/specs/2026-08-31-comment-assistance-discovery.md",
    },
    decision: "permitted" as const,
    packet: {
      issueNumber: 469 as const,
      status: "reviewed" as const,
      artifactPath: "test://channel-launch/clearance-packet",
      revision: "clearance-packet-revision",
      reviewedAt: "2026-09-01",
      reviewedBy: "test-only fixture reviewer",
    },
    determination: {
      responseDate: "2026-09-01",
      reviewerOrAuthority: "test-only fixture authority",
      applicablePolicies: ["test-only policy reference"],
      permittedScope: "test-only permitted Channel scope",
      prohibitedScope: "test-only prohibited scope",
      sourceReference: "test://channel-launch/clearance-response",
      verbatimResponse: "Test-only written determination fixture.",
    },
    coverage: {
      customPerCommentBehavioralAssessment: true as const,
      modelProviderFlow: true as const,
      retentionApproach: true as const,
    },
    conditions: [],
  };
}

function passingDisclosureEvidence() {
  const urls = {
    privacy: "https://example.test/channel/privacy",
    youtubeData: "https://example.test/channel/youtube-data",
    provider: "https://example.test/channel/provider",
    deletion: "https://example.test/channel/deletion",
    revocation: "https://example.test/channel/revocation",
  };
  const checks = {
    privacy: {
      url: urls.privacy,
      statusCode: 200 as const,
      checkedAt: VERIFIED_AT,
      contentSha256: hashChannelLaunchValue({ id: "privacy", live: true }),
    },
    youtubeData: {
      url: urls.youtubeData,
      statusCode: 200 as const,
      checkedAt: VERIFIED_AT,
      contentSha256: hashChannelLaunchValue({ id: "youtubeData", live: true }),
    },
    provider: {
      url: urls.provider,
      statusCode: 200 as const,
      checkedAt: VERIFIED_AT,
      contentSha256: hashChannelLaunchValue({ id: "provider", live: true }),
    },
    deletion: {
      url: urls.deletion,
      statusCode: 200 as const,
      checkedAt: VERIFIED_AT,
      contentSha256: hashChannelLaunchValue({ id: "deletion", live: true }),
    },
    revocation: {
      url: urls.revocation,
      statusCode: 200 as const,
      checkedAt: VERIFIED_AT,
      contentSha256: hashChannelLaunchValue({ id: "revocation", live: true }),
    },
  };
  return { evidence: passedEvidence("live-disclosure-urls"), urls, checks };
}

function passingPacket() {
  const evidence = (id: string) => passedEvidence(id);
  return createChannelLaunchPacket({
    recordType: "channel-production-launch-packet",
    recordVersion: 1,
    issueNumber: 492,
    packetId: "channel-production-launch-v1",
    frozenAt: VERIFIED_AT,
    sourceRevision: SOURCE_REVISION,
    decision: "passed",
    releaseReviewEligible: true,
    productionActivationPerformed: false,
    dependencies: [479, 480, 481, 487, 491].map((issueNumber) => ({
      issueNumber: issueNumber as 479 | 480 | 481 | 487 | 491,
      evidence: evidence(`dependency-${issueNumber}`),
    })),
    externalGates: {
      youtubeClearance: {
        evidence: evidence("youtube-clearance"),
        clearance: permittedClearance(),
      },
      oauthVerification: {
        evidence: evidence("oauth-verification"),
        productionClientId: "test-client-id",
        verifiedScopes: [
          "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/youtube.force-ssl",
        ],
        incrementalAuthorizationVerified: true,
        identityVerificationVerified: true,
        productionClientVerified: true,
      },
      liveDisclosureUrls: passingDisclosureEvidence(),
      frozenQualityReport: {
        evidence: {
          ...evidence("frozen-quality-report"),
          artifactSha256: passingQualityReport().evaluationFingerprint,
        },
        report: passingQualityReport(),
      },
    },
    endToEnd: {
      onboarding: evidence("e2e-onboarding"),
      identity_switching: evidence("e2e-identity-switching"),
      scanning: evidence("e2e-scanning"),
      assessment: evidence("e2e-assessment"),
      safety_flags: evidence("e2e-safety-flags"),
      review: evidence("e2e-review"),
      drafting: evidence("e2e-drafting"),
      stale_drafts: evidence("e2e-stale-drafts"),
      publication: evidence("e2e-publication"),
      publication_uncertainty: evidence("e2e-publication-uncertainty"),
      deletion: evidence("e2e-deletion"),
      downgrade: evidence("e2e-downgrade"),
      disconnect: evidence("e2e-disconnect"),
      account_deletion: evidence("e2e-account-deletion"),
    },
    accessibility: {
      keyboard: evidence("a11y-keyboard"),
      screen_readers: evidence("a11y-screen-readers"),
      non_color_state: evidence("a11y-non-color-state"),
      live_progress: evidence("a11y-live-progress"),
      focus_restoration: evidence("a11y-focus-restoration"),
      privacy_reveal: evidence("a11y-privacy-reveal"),
      reduced_motion: evidence("a11y-reduced-motion"),
      layout_390px: evidence("a11y-layout-390px"),
    },
    quotaLoad: {
      scan_limits: evidence("quota-scan-limits"),
      daily_reply_limits: evidence("quota-daily-reply-limits"),
      shared_quota_exhaustion: evidence("quota-shared-quota-exhaustion"),
      concurrent_scan_runs: evidence("quota-concurrent-scan-runs"),
      atomic_publication_claims: evidence("quota-atomic-publication-claims"),
      cleanup_workers: evidence("quota-cleanup-workers"),
    },
    retentionDeletion: {
      thirty_day_refresh_or_deletion: evidence("retention-thirty-day"),
      seven_day_downgrade_cleanup: evidence("retention-seven-day-downgrade"),
      disconnect_cleanup: evidence("retention-disconnect"),
      account_deletion_cleanup: evidence("retention-account-deletion"),
      provider_outcome_tracking: evidence("retention-provider-outcomes"),
      public_reply_deletion_provenance: evidence("retention-reply-provenance"),
    },
    productionConfiguration: {
      evidence: evidence("production-configuration"),
      runtimeControls: {
        featureFlags: "absent",
        cohorts: "absent",
        betaEntitlements: "absent",
        killSwitches: "absent",
        rollbackContracts: "absent",
        globalOAuthRevocationControl: "absent",
      },
      channelReachability: "unreachable_until_packet_passes",
    },
    nonClaims: [
      "This test packet is not external approval evidence.",
    ],
  });
}

describe("Channel production launch packet", () => {
  it("creates an immutable, fingerprinted blocked inventory when evidence is unavailable", () => {
    const packet = createUnavailableChannelLaunchPacket();

    expect(packet.decision).toBe("blocked");
    expect(packet.productionActivationPerformed).toBe(false);
    expect(Object.isFrozen(packet)).toBe(true);
    expect(Object.isFrozen(packet.externalGates)).toBe(true);
    expect(verifyChannelLaunchPacketFingerprint(packet)).toBe(true);
    expect(evaluateChannelLaunchPacket(packet)).toMatchObject({
      status: "blocked",
      releaseReviewEligible: false,
    });
  });

  it("fails closed and names every unavailable release evidence family", () => {
    const result = evaluateChannelLaunchPacket(
      createUnavailableChannelLaunchPacket(),
    );

    expect(result.status).toBe("blocked");
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.externalGates.youtubeClearance.evidence",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.externalGates.oauthVerification.evidence",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.externalGates.liveDisclosureUrls.evidence",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.externalGates.frozenQualityReport.evidence",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.endToEnd.account_deletion",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.accessibility.layout_390px",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.quotaLoad.concurrent_scan_runs",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.retentionDeletion.seven_day_downgrade_cleanup",
        }),
        expect.objectContaining({
          code: "production_control_unverified",
          path: "$.productionConfiguration.runtimeControls.featureFlags",
        }),
      ]),
    );
  });

  it("rejects a packet whose contents changed after fingerprinting", () => {
    const packet = createUnavailableChannelLaunchPacket();
    const tampered = {
      ...packet,
      decision: "passed" as const,
    };

    expect(verifyChannelLaunchPacketFingerprint(tampered)).toBe(false);
    expect(evaluateChannelLaunchPacket(tampered)).toMatchObject({
      status: "blocked",
      failures: expect.arrayContaining([
        expect.objectContaining({ code: "packet_fingerprint_mismatch" }),
      ]),
    });
  });

  it("rejects missing checklist fields instead of evaluating a partial packet", () => {
    const { packetFingerprint, ...packetBody } =
      createUnavailableChannelLaunchPacket();
    expect(packetFingerprint).toHaveLength(64);
    const malformed = {
      ...packetBody,
      endToEnd: {
        ...packetBody.endToEnd,
        account_deletion: undefined,
      },
    };

    expect(evaluateChannelLaunchPacket(malformed)).toMatchObject({
      status: "blocked",
      packet: null,
      failures: [expect.objectContaining({ code: "malformed_packet" })],
    });
  });

  it("passes only a complete frozen packet with every gate and dependency verified", () => {
    const packet = passingPacket();
    const result = evaluateChannelLaunchPacket(packet);

    expect(result).toMatchObject({
      status: "passed",
      decision: "passed",
      releaseReviewEligible: true,
      failures: [],
    });
  });

  it("accepts the quality-gate report shape from the #487 dependency only when its harness also passes", () => {
    const packet = passingPacket();
    const { packetFingerprint: _packetFingerprint, ...packetBody } = packet;
    expect(_packetFingerprint).toHaveLength(64);
    const report = passingQualityGateReport();
    const withGateReport = createChannelLaunchPacket({
      ...packetBody,
      externalGates: {
        ...packet.externalGates,
        frozenQualityReport: {
          evidence: {
            ...packet.externalGates.frozenQualityReport.evidence,
            artifactSha256: report.evaluationFingerprint,
          },
          report,
        },
      },
    });

    expect(evaluateChannelLaunchPacket(withGateReport)).toMatchObject({
      status: "passed",
      failures: [],
    });
  });

  it("blocks a freshly fingerprinted packet when one required artifact fails", () => {
    const packet = passingPacket();
    const { packetFingerprint: _packetFingerprint, ...packetBody } = packet;
    expect(_packetFingerprint).toHaveLength(64);
    const failed = createChannelLaunchPacket({
      ...packetBody,
      endToEnd: {
        ...packet.endToEnd,
        publication: {
          status: "failed",
          evidenceRef: "test://channel-launch/publication-failure",
          artifactSha256: "e".repeat(64),
          verifiedAt: VERIFIED_AT,
          sourceRevision: SOURCE_REVISION,
          failureReason: "The publication evidence fixture failed.",
        },
      },
    });

    expect(evaluateChannelLaunchPacket(failed)).toMatchObject({
      status: "blocked",
      failures: expect.arrayContaining([
        expect.objectContaining({
          code: "evidence_failed",
          path: "$.endToEnd.publication",
        }),
      ]),
    });
  });

  it("blocks a packet when production controls are present", () => {
    const packet = passingPacket();
    const { packetFingerprint: _packetFingerprint, ...packetBody } = packet;
    expect(_packetFingerprint).toHaveLength(64);
    const withRuntimeControl = createChannelLaunchPacket({
      ...packetBody,
      productionConfiguration: {
        ...packet.productionConfiguration,
        runtimeControls: {
          ...packet.productionConfiguration.runtimeControls,
          featureFlags: "present",
        },
      },
    });

    expect(evaluateChannelLaunchPacket(withRuntimeControl)).toMatchObject({
      status: "blocked",
      failures: expect.arrayContaining([
        expect.objectContaining({
          code: "production_control_present",
          path: "$.productionConfiguration.runtimeControls.featureFlags",
        }),
      ]),
    });
  });

  it("blocks a fingerprinted quality report whose measured gate fails", () => {
    const packet = passingPacket();
    const { packetFingerprint: _packetFingerprint, ...packetBody } = packet;
    expect(_packetFingerprint).toHaveLength(64);
    const quality = passingQualityReport();
    const { evaluationFingerprint: _qualityFingerprint, ...qualityBody } = quality;
    expect(_qualityFingerprint).toHaveLength(64);
    const failedQualityBody = {
      ...qualityBody,
      metrics: {
        ...quality.metrics,
        overall: {
          ...quality.metrics.overall,
          safetyFlagRecall: {
            ...quality.metrics.overall.safetyFlagRecall,
            estimate: 0,
            interval95: { lower: 0, upper: 0 },
          },
        },
      },
    };
    const failedQuality = {
      ...failedQualityBody,
      evaluationFingerprint: hashChannelLaunchValue(failedQualityBody),
    };
    const withFailedQuality = createChannelLaunchPacket({
      ...packetBody,
      externalGates: {
        ...packet.externalGates,
        frozenQualityReport: {
          evidence: {
            ...packet.externalGates.frozenQualityReport.evidence,
            artifactSha256: failedQuality.evaluationFingerprint,
          },
          report: failedQuality,
        },
      },
    });

    expect(evaluateChannelLaunchPacket(withFailedQuality)).toMatchObject({
      status: "blocked",
      failures: expect.arrayContaining([
        expect.objectContaining({ code: "quality_metric_threshold_failed" }),
      ]),
    });
  });

  it("keeps the checked-in packet explicitly blocked without external claims", () => {
    const packet = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/compliance/channel-production-launch-packet.json",
        ),
        "utf8",
      ),
    );
    const result = evaluateChannelLaunchPacket(packet);

    expect(result).toMatchObject({
      status: "blocked",
      decision: "blocked",
      releaseReviewEligible: false,
    });
    expect(result.packet?.externalGates.youtubeClearance.clearance).toBeNull();
    expect(result.packet?.externalGates.liveDisclosureUrls.urls).toEqual({
      privacy: null,
      youtubeData: null,
      provider: null,
      deletion: null,
      revocation: null,
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.dependencies[issueNumber=487].evidence",
        }),
        expect.objectContaining({
          code: "evidence_not_available",
          path: "$.dependencies[issueNumber=491].evidence",
        }),
      ]),
    );
  });
});
