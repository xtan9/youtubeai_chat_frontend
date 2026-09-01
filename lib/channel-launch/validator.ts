import {
  CHANNEL_QUALITY_GATE_THRESHOLDS,
  CHANNEL_QUALITY_MINIMUMS,
  CHANNEL_QUALITY_REQUIRED_CROSS_CUTS,
  CHANNEL_QUALITY_SUPPORTED_LANGUAGES,
  CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES,
  verifyChannelQualityEvaluationFingerprint,
  type ChannelQualityEvaluationArtifact,
} from "@/lib/channel-quality-evaluation";
import { evaluateYouTubeChannelAssessmentGate } from "@/lib/compliance/youtube-channel-clearance";
import { evaluateYouTubeChannelOAuthVerificationGate } from "@/lib/compliance/youtube-channel-oauth-verification";
import { CHANNEL_EVALUATION_CORPORA } from "@/lib/channel/quality-gate";

import {
  CHANNEL_LAUNCH_ACCESSIBILITY_EVIDENCE_IDS,
  CHANNEL_LAUNCH_DEPENDENCY_ISSUES,
  CHANNEL_LAUNCH_DISCLOSURE_URL_IDS,
  CHANNEL_LAUNCH_END_TO_END_EVIDENCE_IDS,
  CHANNEL_LAUNCH_QUOTA_LOAD_EVIDENCE_IDS,
  CHANNEL_LAUNCH_RETENTION_DELETION_EVIDENCE_IDS,
  ChannelLaunchPacketSchema,
  ChannelLaunchQualityReportSchema,
  deepFreeze,
  hashChannelLaunchValue,
  verifyChannelLaunchPacketFingerprint,
  type ChannelLaunchEvidence,
  type ChannelLaunchPacket,
  type ChannelLaunchQualityEvaluationArtifact,
  type ChannelLaunchQualityGateReport,
  type ChannelLaunchQualityReport,
} from "./contracts";

export type ChannelLaunchPacketFailure = Readonly<{
  code: string;
  path: string;
  detail: string;
}>;

export type ChannelLaunchPacketEvaluation = Readonly<{
  status: "passed" | "blocked";
  decision: "passed" | "blocked";
  releaseReviewEligible: boolean;
  packet: ChannelLaunchPacket | null;
  failures: readonly ChannelLaunchPacketFailure[];
}>;

export function evaluateChannelLaunchPacket(
  input: unknown,
): ChannelLaunchPacketEvaluation {
  const parsed = ChannelLaunchPacketSchema.safeParse(input);
  if (!parsed.success) {
    return evaluation(null, [
      failure(
        "malformed_packet",
        "$",
        "The launch packet does not match the strict versioned schema.",
      ),
    ]);
  }

  const packet = parsed.data;
  const failures: ChannelLaunchPacketFailure[] = [];

  if (!verifyChannelLaunchPacketFingerprint(packet)) {
    failures.push(
      failure(
        "packet_fingerprint_mismatch",
        "$.packetFingerprint",
        "The packet contents are not reproducible from its fingerprint.",
      ),
    );
  }

  validatePacketIdentity(packet, failures);
  validateDependencies(packet, failures);
  validateExternalGates(packet, failures);
  validateChecklists(packet, failures);
  validateProductionConfiguration(packet, failures);
  validatePacketDecision(packet, failures);

  return evaluation(deepFreeze(packet), failures);
}

export const validateChannelLaunchPacket = evaluateChannelLaunchPacket;

function validatePacketIdentity(
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  if (packet.decision === "passed" && packet.frozenAt === null) {
    failures.push(
      failure(
        "packet_not_frozen",
        "$.frozenAt",
        "A packet cannot pass until it has a recorded freeze timestamp.",
      ),
    );
  }
  if (packet.decision === "passed" && packet.sourceRevision === null) {
    failures.push(
      failure(
        "source_revision_missing",
        "$.sourceRevision",
        "A passing packet must identify the exact source revision under review.",
      ),
    );
  }
}

function validateDependencies(
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  const seen = new Set<number>();
  for (const dependency of packet.dependencies) {
    const path = `$.dependencies[issueNumber=${dependency.issueNumber}]`;
    if (seen.has(dependency.issueNumber)) {
      failures.push(
        failure(
          "dependency_duplicate",
          `${path}.issueNumber`,
          "Each launch dependency must appear exactly once.",
        ),
      );
    }
    seen.add(dependency.issueNumber);
    validateEvidence(dependency.evidence, `${path}.evidence`, packet, failures);
  }

  for (const issueNumber of CHANNEL_LAUNCH_DEPENDENCY_ISSUES) {
    if (!seen.has(issueNumber)) {
      failures.push(
        failure(
          "dependency_missing",
          "$.dependencies",
          `Evidence for issue #${issueNumber} is required before Channel release.`,
        ),
      );
    }
  }
}

function validateExternalGates(
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  const external = packet.externalGates;
  validateEvidence(
    external.youtubeClearance.evidence,
    "$.externalGates.youtubeClearance.evidence",
    packet,
    failures,
  );
  if (external.youtubeClearance.evidence.status === "passed") {
    if (external.youtubeClearance.clearance === null) {
      failures.push(
        failure(
          "youtube_clearance_missing",
          "$.externalGates.youtubeClearance.clearance",
          "A passing launch packet must embed the reviewed written YouTube determination.",
        ),
      );
    } else {
      const gate = evaluateYouTubeChannelAssessmentGate(
        external.youtubeClearance.clearance,
      );
      if (gate.status !== "open") {
        failures.push(
          failure(
            "youtube_clearance_blocked",
            "$.externalGates.youtubeClearance.clearance",
            gate.reason,
          ),
        );
      } else if (
        (external.youtubeClearance.clearance.decision === "permitted" ||
          external.youtubeClearance.clearance.decision === "conditional") &&
        external.youtubeClearance.evidence.evidenceRef !==
          external.youtubeClearance.clearance.determination.sourceReference
      ) {
        failures.push(
          failure(
            "youtube_clearance_evidence_reference_mismatch",
            "$.externalGates.youtubeClearance.evidence.evidenceRef",
            "The packet YouTube evidence must point to the written determination source reference.",
          ),
        );
      }
    }
  }

  const oauth = external.oauthVerification;
  validateEvidence(
    oauth.evidence,
    "$.externalGates.oauthVerification.evidence",
    packet,
    failures,
  );
  if (oauth.evidence.status === "passed") {
    if (oauth.verification === null) {
      failures.push(
        failure(
          "oauth_verification_record_missing",
          "$.externalGates.oauthVerification.verification",
          "A passing launch packet must embed the exact reviewed OAuth verification record.",
        ),
      );
    } else {
      const verificationGate = evaluateYouTubeChannelOAuthVerificationGate(
        oauth.verification,
      );
      if (verificationGate.status !== "open") {
        failures.push(
          failure(
            "oauth_verification_blocked",
            "$.externalGates.oauthVerification.verification",
            verificationGate.reason,
          ),
        );
      } else if (
        oauth.evidence.evidenceRef !== verificationGate.evidenceRef
      ) {
        failures.push(
          failure(
            "oauth_evidence_reference_mismatch",
            "$.externalGates.oauthVerification.evidence.evidenceRef",
            "The packet OAuth evidence must point to the reviewed verification record evidence.",
          ),
        );
      }
    }
    const scopes = oauth.verifiedScopes;
    const expectedScopes = new Set([
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ]);
    const actualScopes = scopes === null ? new Set<string>() : new Set(scopes);
    if (
      scopes === null ||
      scopes.length !== expectedScopes.size ||
      actualScopes.size !== expectedScopes.size ||
      [...expectedScopes].some((scope) => !actualScopes.has(scope))
    ) {
      failures.push(
        failure(
          "oauth_scopes_incomplete",
          "$.externalGates.oauthVerification.verifiedScopes",
          "OAuth evidence must verify exactly the approved incremental read and write scopes.",
        ),
      );
    }
    if (oauth.productionClientId === null) {
      failures.push(
        failure(
          "oauth_client_missing",
          "$.externalGates.oauthVerification.productionClientId",
          "Production OAuth verification must name the verified client without embedding a secret.",
        ),
      );
    }
    for (const [key, value] of [
      [
        "incrementalAuthorizationVerified",
        oauth.incrementalAuthorizationVerified,
      ],
      ["identityVerificationVerified", oauth.identityVerificationVerified],
      ["productionClientVerified", oauth.productionClientVerified],
    ] as const) {
      if (value !== true) {
        failures.push(
          failure(
            "oauth_verification_incomplete",
            `$.externalGates.oauthVerification.${key}`,
            "OAuth evidence must explicitly verify the production client, identity binding, and incremental consent flow.",
          ),
        );
      }
    }
  }

  const disclosures = external.liveDisclosureUrls;
  validateEvidence(
    disclosures.evidence,
    "$.externalGates.liveDisclosureUrls.evidence",
    packet,
    failures,
  );
  if (disclosures.evidence.status === "passed") {
    const seenUrls = new Set<string>();
    for (const id of CHANNEL_LAUNCH_DISCLOSURE_URL_IDS) {
      const url = disclosures.urls[id];
      const check = disclosures.checks[id];
      if (url === null) {
        failures.push(
          failure(
            "disclosure_url_missing",
            `$.externalGates.liveDisclosureUrls.urls.${id}`,
            "Every required disclosure must have a verified live HTTPS URL.",
          ),
        );
        continue;
      }
      let isHttps = false;
      try {
        isHttps = new URL(url).protocol === "https:";
      } catch {
        // The schema catches malformed URLs; keep this branch fail closed if
        // the runtime receives a value through an untyped adapter.
      }
      if (!isHttps) {
        failures.push(
          failure(
            "disclosure_url_not_https",
            `$.externalGates.liveDisclosureUrls.urls.${id}`,
            "Live disclosure URLs must use HTTPS.",
          ),
        );
      }
      if (seenUrls.has(url)) {
        failures.push(
          failure(
            "disclosure_url_duplicate",
            `$.externalGates.liveDisclosureUrls.urls.${id}`,
            "Each required disclosure must be independently addressable.",
          ),
        );
      }
      seenUrls.add(url);
      if (check === null || check.url !== url) {
        failures.push(
          failure(
            "disclosure_url_not_live",
            `$.externalGates.liveDisclosureUrls.checks.${id}`,
            "The packet must include a successful live check for the exact disclosure URL.",
          ),
        );
      }
    }
  }

  const quality = external.frozenQualityReport;
  validateEvidence(
    quality.evidence,
    "$.externalGates.frozenQualityReport.evidence",
    packet,
    failures,
  );
  if (quality.evidence.status === "passed") {
    if (quality.report === null) {
      failures.push(
        failure(
          "quality_report_missing",
          "$.externalGates.frozenQualityReport.report",
          "A passing launch packet must include the complete frozen quality report.",
        ),
      );
    } else {
      validateQualityReport(quality.report, packet, failures);
      if (quality.evidence.artifactSha256 !== quality.report.evaluationFingerprint) {
        failures.push(
          failure(
            "quality_report_artifact_mismatch",
            "$.externalGates.frozenQualityReport.evidence.artifactSha256",
            "The quality evidence hash must match the embedded evaluation fingerprint.",
          ),
        );
      }
    }
  }
}

function validateQualityReport(
  input: ChannelLaunchQualityReport,
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  const parsed = ChannelLaunchQualityReportSchema.safeParse(input);
  if (!parsed.success) {
    failures.push(
      failure(
        "quality_report_malformed",
        "$.externalGates.frozenQualityReport.report",
        "The quality report does not match the complete release-report schema.",
      ),
    );
    return;
  }
  const report = parsed.data;
  if ("artifactVersion" in report) {
    validateEvaluationQualityReport(report, packet, failures);
    return;
  }
  validateQualityGateReport(report, packet, failures);
}

function validateEvaluationQualityReport(
  report: ChannelLaunchQualityEvaluationArtifact,
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  if (report.outcome !== "passed") {
    failures.push(
      failure(
        "quality_report_failed",
        "$.externalGates.frozenQualityReport.report.outcome",
        "Only a passing quality report can authorize launch review.",
      ),
    );
  }
  if (report.evaluatedAt === null || report.tupleSelectedAt === null) {
    failures.push(
      failure(
        "quality_report_provenance_missing",
        "$.externalGates.frozenQualityReport.report",
        "The quality report must preserve evaluation and final-tuple timestamps.",
      ),
    );
  }
  if (report.sourceRevision === null || report.policyVersion === null) {
    failures.push(
      failure(
        "quality_report_provenance_missing",
        "$.externalGates.frozenQualityReport.report",
        "The quality report must preserve its source revision and policy version.",
      ),
    );
  }
  if (report.versions === null) {
    failures.push(
      failure(
        "quality_report_versions_missing",
        "$.externalGates.frozenQualityReport.report.versions",
        "The final model, prompt, taxonomy, schema, and validator tuple is required.",
      ),
    );
  }
  if (report.corpora.development === null || report.corpora.blind === null) {
    failures.push(
      failure(
        "quality_report_corpus_missing",
        "$.externalGates.frozenQualityReport.report.corpora",
        "Both development and blind corpus references are required.",
      ),
    );
  } else {
    if (report.corpora.blind.state !== "frozen" || report.corpora.blind.frozenAt === null) {
      failures.push(
        failure(
          "quality_report_blind_not_frozen",
          "$.externalGates.frozenQualityReport.report.corpora.blind",
          "The release quality report must bind to a frozen blind corpus.",
        ),
      );
    }
    if (report.corpora.development.split !== "development") {
      failures.push(
        failure(
          "quality_report_development_split",
          "$.externalGates.frozenQualityReport.report.corpora.development.split",
          "The development corpus reference must identify the development split.",
        ),
      );
    }
    if (report.corpora.blind.split !== "blind") {
      failures.push(
        failure(
          "quality_report_blind_split",
          "$.externalGates.frozenQualityReport.report.corpora.blind.split",
          "The release corpus reference must identify the blind split.",
        ),
      );
    }
    if (
      report.corpora.blind.frozenAt !== null &&
      report.tupleSelectedAt !== null &&
      Date.parse(report.corpora.blind.frozenAt) >=
        Date.parse(report.tupleSelectedAt)
    ) {
      failures.push(
        failure(
          "quality_report_blind_frozen_after_tuple",
          "$.externalGates.frozenQualityReport.report.corpora.blind.frozenAt",
          "The blind corpus must be frozen before the final evaluation tuple is selected.",
        ),
      );
    }
  }
  if (
    report.evaluatedAt !== null &&
    report.tupleSelectedAt !== null &&
    Date.parse(report.tupleSelectedAt) > Date.parse(report.evaluatedAt)
  ) {
    failures.push(
      failure(
        "quality_report_tuple_selected_after_evaluation",
        "$.externalGates.frozenQualityReport.report.tupleSelectedAt",
        "The final evaluation tuple cannot be selected after evaluation completes.",
      ),
    );
  }
  if (report.resultSetHash === null || report.metrics === null) {
    failures.push(
      failure(
        "quality_report_metrics_missing",
        "$.externalGates.frozenQualityReport.report",
        "A passing report must preserve its result-set hash and measured metrics.",
      ),
    );
  }
  if (
    report.composition.development === null ||
    report.composition.blind === null
  ) {
    failures.push(
      failure(
        "quality_report_composition_missing",
        "$.externalGates.frozenQualityReport.report.composition",
        "A passing report must preserve development and blind composition summaries.",
      ),
    );
  } else {
    validateQualityComposition(
      report.composition.development,
      "development",
      failures,
    );
    validateQualityComposition(report.composition.blind, "blind", failures);
    if (
      report.corpora.development !== null &&
      report.corpora.development.itemCount !==
        report.composition.development.itemCount
    ) {
      failures.push(
        failure(
          "quality_report_development_composition_mismatch",
          "$.externalGates.frozenQualityReport.report.composition.development.itemCount",
          "The development corpus reference and composition must describe the same item count.",
        ),
      );
    }
    if (
      report.corpora.blind !== null &&
      report.corpora.blind.itemCount !== report.composition.blind.itemCount
    ) {
      failures.push(
        failure(
          "quality_report_blind_composition_mismatch",
          "$.externalGates.frozenQualityReport.report.composition.blind.itemCount",
          "The blind corpus reference and composition must describe the same item count.",
        ),
      );
    }
  }
  if (
    report.reproducibility.status !== "verified" ||
    report.reproducibility.inputFingerprint === null
  ) {
    failures.push(
      failure(
        "quality_report_not_reproducible",
        "$.externalGates.frozenQualityReport.report.reproducibility",
        "The quality report must prove reproducibility from frozen inputs.",
      ),
    );
  }
  if (report.gate.outcome !== "passed" || report.gate.failures.length > 0) {
    failures.push(
      failure(
        "quality_report_gate_failed",
        "$.externalGates.frozenQualityReport.report.gate",
        "The frozen quality gate must pass with no recorded failures.",
      ),
    );
  }
  if (report.metrics !== null) {
    validateQualityMetricThresholds(report.metrics, failures);
  }
  if (
    hashChannelLaunchValue(report.thresholds) !==
    hashChannelLaunchValue(CHANNEL_QUALITY_GATE_THRESHOLDS)
  ) {
    failures.push(
      failure(
        "quality_report_thresholds_mismatch",
        "$.externalGates.frozenQualityReport.report.thresholds",
        "The report thresholds must match the approved repository quality gate.",
      ),
    );
  }
  if (
    !verifyChannelQualityEvaluationFingerprint(
      report as unknown as ChannelQualityEvaluationArtifact,
    )
  ) {
    failures.push(
      failure(
        "quality_report_fingerprint_mismatch",
        "$.externalGates.frozenQualityReport.report.evaluationFingerprint",
        "The quality report fingerprint does not match its immutable contents.",
      ),
    );
  }
  if (
    packet.sourceRevision !== null &&
    report.sourceRevision !== null &&
    packet.sourceRevision !== report.sourceRevision
  ) {
    failures.push(
      failure(
        "quality_report_source_mismatch",
        "$.externalGates.frozenQualityReport.report.sourceRevision",
        "The quality report must be evaluated against the packet source revision.",
      ),
    );
  }
}

type QualityComposition = NonNullable<
  ChannelLaunchQualityEvaluationArtifact["composition"]["development"]
>;
type QualityMetrics = NonNullable<
  ChannelLaunchQualityEvaluationArtifact["metrics"]
>;
type QualityMetricSet = QualityMetrics["overall"];
type QualityRate = NonNullable<QualityMetricSet["actionableAbusePrecision"]>;

function validateQualityComposition(
  composition: QualityComposition,
  split: "development" | "blind",
  failures: ChannelLaunchPacketFailure[],
): void {
  const minimums = CHANNEL_QUALITY_MINIMUMS.perLanguage;
  const minimumClassifications = [
    [
      "allowed_criticism",
      minimums.classifications.allowed_criticism,
    ],
    ["actionable_abuse", minimums.classifications.actionable_abuse],
    [
      "reviewable_interaction",
      minimums.classifications.reviewable_interaction,
    ],
    ["safety_flag", minimums.classifications.safety_flag],
  ] as const;
  let totalItems = 0;

  for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
    const summary = composition.perLanguage[language];
    totalItems += summary.classification + summary.adversarial + summary.validator;
    const classifiedItems = Object.values(summary.classificationByLabel).reduce(
      (total, count) => total + count,
      0,
    );
    if (classifiedItems !== summary.classification) {
      failures.push(
        failure(
          "quality_report_composition_inconsistent",
          `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}`,
          "Classification totals must equal the sum of their label counts.",
        ),
      );
    }
    const validatorItems = Object.values(summary.validatorByCategory).reduce(
      (total, count) => total + count,
      0,
    );
    if (validatorItems !== summary.validator) {
      failures.push(
        failure(
          "quality_report_composition_inconsistent",
          `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}`,
          "Validator totals must equal the sum of their category counts.",
        ),
      );
    }
    if (
      summary.totalClassificationAndAdversarial !==
      summary.classification + summary.adversarial
    ) {
      failures.push(
        failure(
          "quality_report_composition_inconsistent",
          `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}`,
          "The classification-plus-adversarial total must be internally consistent.",
        ),
      );
    }
    for (const [category, minimum] of minimumClassifications) {
      if (summary.classificationByLabel[category] < minimum) {
        failures.push(
          failure(
            "quality_report_composition_below_minimum",
            `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}.classificationByLabel.${category}`,
            `The frozen ${split} corpus does not meet the required ${category} minimum.`,
          ),
        );
      }
    }
    if (summary.adversarial < minimums.adversarial) {
      failures.push(
        failure(
          "quality_report_composition_below_minimum",
          `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}.adversarial`,
          `The frozen ${split} corpus does not meet the required adversarial minimum.`,
        ),
      );
    }
    if (summary.validator < minimums.validator) {
      failures.push(
        failure(
          "quality_report_composition_below_minimum",
          `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}.validator`,
          `The frozen ${split} corpus does not meet the required validator minimum.`,
        ),
      );
    }
    if (
      summary.totalClassificationAndAdversarial <
      minimums.totalClassificationAndAdversarial
    ) {
      failures.push(
        failure(
          "quality_report_composition_below_minimum",
          `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}.totalClassificationAndAdversarial`,
          `The frozen ${split} corpus does not meet the required classification and adversarial minimum.`,
        ),
      );
    }
    for (const category of CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES) {
      if (summary.validatorByCategory[category] < 1) {
        failures.push(
          failure(
            "quality_report_validator_category_missing",
            `$.externalGates.frozenQualityReport.report.composition.${split}.perLanguage.${language}.validatorByCategory.${category}`,
            "Every zero-tolerance validator category requires at least one measured sample.",
          ),
        );
      }
    }
  }

  if (totalItems !== composition.itemCount) {
    failures.push(
      failure(
        "quality_report_composition_inconsistent",
        `$.externalGates.frozenQualityReport.report.composition.${split}.itemCount`,
        "The corpus item count must equal the sum of its language compositions.",
      ),
    );
  }
  for (const crossCut of CHANNEL_QUALITY_REQUIRED_CROSS_CUTS) {
    const minimum =
      crossCut === "minor_safety"
        ? CHANNEL_QUALITY_MINIMUMS.minorSafety
        : CHANNEL_QUALITY_MINIMUMS.eachRequiredCrossCut;
    if (
      composition.crossCuts[crossCut] < minimum
    ) {
      failures.push(
        failure(
          "quality_report_cross_cut_below_minimum",
          `$.externalGates.frozenQualityReport.report.composition.${split}.crossCuts.${crossCut}`,
          `The frozen ${split} corpus does not meet the required protected cross-cut minimum.`,
        ),
      );
    }
  }
}

function validateQualityMetricThresholds(
  metrics: QualityMetrics,
  failures: ChannelLaunchPacketFailure[],
): void {
  const thresholds = CHANNEL_QUALITY_GATE_THRESHOLDS;
  checkQualityRate(
    metrics.overall.actionableAbusePrecision,
    "$.externalGates.frozenQualityReport.report.metrics.overall.actionableAbusePrecision",
    (rate) =>
      rate.estimate >= thresholds.actionableAbusePrecision.overallPointMinimum &&
      rate.interval95.lower >=
        thresholds.actionableAbusePrecision.overallLowerWilsonMinimum,
    "Actionable Abuse precision did not meet the overall point and Wilson gates.",
    failures,
  );
  checkQualityRate(
    metrics.overall.allowedCriticismFalsePositiveRate,
    "$.externalGates.frozenQualityReport.report.metrics.overall.allowedCriticismFalsePositiveRate",
    (rate) =>
      rate.estimate <=
        thresholds.allowedCriticismFalsePositiveRate.overallPointMaximum &&
      rate.interval95.upper <=
        thresholds.allowedCriticismFalsePositiveRate.overallUpperWilsonMaximum,
    "Allowed Criticism false-positive rate did not meet the overall point and Wilson gates.",
    failures,
  );
  checkQualityRate(
    metrics.overall.safetyFlagRecall,
    "$.externalGates.frozenQualityReport.report.metrics.overall.safetyFlagRecall",
    (rate) =>
      rate.estimate >= thresholds.safetyFlagRecall.overallPointMinimum &&
      rate.interval95.lower >= thresholds.safetyFlagRecall.overallLowerWilsonMinimum,
    "Safety Flag recall did not meet the overall point and Wilson gates.",
    failures,
  );
  checkQualityRate(
    metrics.overall.safetyFlagDraftSuppression,
    "$.externalGates.frozenQualityReport.report.metrics.overall.safetyFlagDraftSuppression",
    (rate) =>
      rate.estimate >= thresholds.safetyFlagDraftSuppression.minimumSuccessRate,
    "Safety Flag draft suppression did not meet its zero-draft gate.",
    failures,
  );
  validateDraftValidatorMetrics(metrics.overall, "overall", failures);

  for (const language of CHANNEL_QUALITY_SUPPORTED_LANGUAGES) {
    const languageMetrics = metrics.byLanguage[language];
    checkQualityRate(
      languageMetrics.actionableAbusePrecision,
      `$.externalGates.frozenQualityReport.report.metrics.byLanguage.${language}.actionableAbusePrecision`,
      (rate) =>
        rate.estimate >= thresholds.actionableAbusePrecision.languagePointMinimum &&
        rate.interval95.lower >=
          thresholds.actionableAbusePrecision.languageLowerWilsonMinimum,
      "Actionable Abuse precision did not meet the language point and Wilson gates.",
      failures,
    );
    checkQualityRate(
      languageMetrics.allowedCriticismFalsePositiveRate,
      `$.externalGates.frozenQualityReport.report.metrics.byLanguage.${language}.allowedCriticismFalsePositiveRate`,
      (rate) =>
        rate.estimate <=
          thresholds.allowedCriticismFalsePositiveRate.languagePointMaximum &&
        rate.interval95.upper <=
          thresholds.allowedCriticismFalsePositiveRate.languageUpperWilsonMaximum,
      "Allowed Criticism false-positive rate did not meet the language point and Wilson gates.",
      failures,
    );
    checkQualityRate(
      languageMetrics.safetyFlagRecall,
      `$.externalGates.frozenQualityReport.report.metrics.byLanguage.${language}.safetyFlagRecall`,
      (rate) =>
        rate.interval95.lower >=
        thresholds.safetyFlagRecall.languageLowerWilsonMinimum,
      "Safety Flag recall did not meet the language Wilson gate.",
      failures,
    );
    checkQualityRate(
      languageMetrics.safetyFlagDraftSuppression,
      `$.externalGates.frozenQualityReport.report.metrics.byLanguage.${language}.safetyFlagDraftSuppression`,
      (rate) =>
        rate.estimate >= thresholds.safetyFlagDraftSuppression.minimumSuccessRate,
      "Safety Flag draft suppression did not meet its language zero-draft gate.",
      failures,
    );
    validateDraftValidatorMetrics(languageMetrics, `language:${language}`, failures);
  }
}

function validateDraftValidatorMetrics(
  metrics: QualityMetricSet,
  scope: string,
  failures: ChannelLaunchPacketFailure[],
): void {
  for (const category of CHANNEL_QUALITY_ZERO_TOLERANCE_DRAFT_VALIDATOR_CATEGORIES) {
    const metric = metrics.draftValidator[category];
    checkQualityRate(
      metric,
      `$.externalGates.frozenQualityReport.report.metrics.${scope}.draftValidator.${category}`,
      (rate) =>
        rate.estimate >= CHANNEL_QUALITY_GATE_THRESHOLDS.draftValidator.minimumRejectionRate &&
        metric !== null &&
        metric.acceptedUnsafeCount <=
          CHANNEL_QUALITY_GATE_THRESHOLDS.draftValidator.maximumAcceptedUnsafeCount,
      "A zero-tolerance validator category must reject every unsafe sample.",
      failures,
    );
  }
}

function checkQualityRate(
  rate: QualityRate | null,
  path: string,
  passes: (rate: QualityRate) => boolean,
  detail: string,
  failures: ChannelLaunchPacketFailure[],
): void {
  if (rate === null) {
    failures.push(
      failure(
        "quality_metric_missing",
        path,
        "Every required quality metric must be estimable from the frozen evidence.",
      ),
    );
  } else if (!passes(rate)) {
    failures.push(failure("quality_metric_threshold_failed", path, detail));
  }
}

function validateQualityGateReport(
  report: ChannelLaunchQualityGateReport,
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  if (report.decision !== "passed" || !report.releaseReviewEligible) {
    failures.push(
      failure(
        "quality_gate_report_failed",
        "$.externalGates.frozenQualityReport.report.decision",
        "The frozen Channel quality-gate report must pass and be eligible for release review.",
      ),
    );
  }
  if (report.evaluatedAt === null) {
    failures.push(
      failure(
        "quality_gate_report_provenance_missing",
        "$.externalGates.frozenQualityReport.report.evaluatedAt",
        "The quality-gate report must preserve its evaluation timestamp.",
      ),
    );
  }
  if (
    report.harnessStatus !== "available" ||
    report.harness === null ||
    report.harness.status !== "available"
  ) {
    failures.push(
      failure(
        "quality_gate_harness_unavailable",
        "$.externalGates.frozenQualityReport.report.harness",
        "The frozen quality-gate report must include an available offline harness artifact.",
      ),
    );
  } else {
    if (
      packet.sourceRevision !== null &&
      report.harness.sourceRevision !== packet.sourceRevision
    ) {
      failures.push(
        failure(
          "quality_gate_harness_source_mismatch",
          "$.externalGates.frozenQualityReport.report.harness.sourceRevision",
          "The upstream quality harness must be evaluated against the packet source revision.",
        ),
      );
    }
    if (
      report.harness.artifact.sourceRevision !== report.harness.sourceRevision
    ) {
      failures.push(
        failure(
          "quality_gate_harness_source_mismatch",
          "$.externalGates.frozenQualityReport.report.harness.artifact.sourceRevision",
          "The embedded harness artifact must bind to the harness evidence revision.",
        ),
      );
    }
    validateEvaluationQualityReport(
      report.harness.artifact as unknown as ChannelLaunchQualityEvaluationArtifact,
      packet,
      failures,
    );
  }
  if (report.evaluatedTuple === null || report.tupleFingerprint === null) {
    failures.push(
      failure(
        "quality_gate_tuple_missing",
        "$.externalGates.frozenQualityReport.report.evaluatedTuple",
        "The quality-gate report must preserve the exact selected model and validator tuple.",
      ),
    );
  } else {
    const { tupleFingerprint, ...tupleBody } = report.evaluatedTuple;
    if (
      tupleFingerprint !== report.tupleFingerprint ||
      hashChannelLaunchValue(tupleBody) !== tupleFingerprint
    ) {
      failures.push(
        failure(
          "quality_gate_tuple_fingerprint_mismatch",
          "$.externalGates.frozenQualityReport.report.tupleFingerprint",
          "The quality-gate tuple fingerprint does not match the selected tuple.",
        ),
      );
    }
  }

  const requiredCorpora = CHANNEL_EVALUATION_CORPORA.map(
    ({ language, issueNumber, corpusId }) => ({
      language,
      issueNumber,
      corpusId,
    }),
  );
  const requiredLanguages = new Set(
    requiredCorpora.map(({ language }) => language),
  );
  const seenLanguages = new Set<string>();
  let observedTotal = 0;
  for (const [index, corpus] of report.corpora.entries()) {
    const duplicate = seenLanguages.has(corpus.language);
    const expected = requiredCorpora.find(
      ({ language }) => language === corpus.language,
    );
    observedTotal += corpus.observedCount;
    if (expected === undefined) {
      failures.push(
        failure(
          "quality_gate_corpus_unknown",
          `$.externalGates.frozenQualityReport.report.corpora[${index}].language`,
          "The quality-gate report contains a corpus outside the approved language set.",
        ),
      );
    }
    if (duplicate) {
      failures.push(
        failure(
          "quality_gate_corpus_duplicate",
          `$.externalGates.frozenQualityReport.report.corpora[${index}].language`,
          "Each supported language must have exactly one quality corpus summary.",
        ),
      );
    }
    seenLanguages.add(corpus.language);
    if (expected && corpus.issueNumber !== expected.issueNumber) {
      failures.push(
        failure(
          "quality_gate_corpus_issue_mismatch",
          `$.externalGates.frozenQualityReport.report.corpora[${index}].issueNumber`,
          `The ${corpus.language} corpus must bind to issue #${expected.issueNumber}.`,
        ),
      );
    }
    if (expected && corpus.corpusId !== expected.corpusId) {
      failures.push(
        failure(
          "quality_gate_corpus_identity_mismatch",
          `$.externalGates.frozenQualityReport.report.corpora[${index}].corpusId`,
          `The ${corpus.language} corpus must bind to the governed corpus ${expected.corpusId}.`,
        ),
      );
    }
    if (corpus.corpusId === null || corpus.sampleCount === 0) {
      failures.push(
        failure(
          "quality_gate_corpus_identity_missing",
          `$.externalGates.frozenQualityReport.report.corpora[${index}]`,
          "Every quality corpus must retain a concrete identity and non-empty sample count.",
        ),
      );
    }
    if (
      corpus.status !== "ready" ||
      corpus.fingerprint === null ||
      corpus.sampleCount !== corpus.observedCount
    ) {
      failures.push(
        failure(
          "quality_gate_corpus_not_ready",
          `$.externalGates.frozenQualityReport.report.corpora[${index}]`,
          "Every supported language corpus must be ready, fingerprinted, and completely observed.",
        ),
      );
    }
  }
  for (const language of requiredLanguages) {
    if (!seenLanguages.has(language)) {
      failures.push(
        failure(
          "quality_gate_corpus_missing",
          "$.externalGates.frozenQualityReport.report.corpora",
          `The frozen quality-gate report is missing the ${language} corpus.`,
        ),
      );
    }
  }
  if (report.corpora.length !== requiredCorpora.length) {
    failures.push(
      failure(
        "quality_gate_corpus_count_mismatch",
        "$.externalGates.frozenQualityReport.report.corpora",
        "The frozen quality-gate report must include exactly one summary for each supported language.",
      ),
    );
  }
  if (report.observationCount !== observedTotal) {
    failures.push(
      failure(
        "quality_gate_observation_count_mismatch",
        "$.externalGates.frozenQualityReport.report.observationCount",
        "The reported observation count must equal the sum of complete observations in every corpus summary.",
      ),
    );
  }
  if (
    report.evaluatedTuple !== null &&
    report.harness !== null &&
    report.harness.status === "available" &&
    report.harness.artifact.versions !== null
  ) {
    const versions = report.harness.artifact.versions;
    const tuple = report.evaluatedTuple;
    if (
      tuple.modelIdentifier !== versions.modelVersion ||
      tuple.assessmentPromptVersion !== versions.promptVersion ||
      tuple.assessmentSchemaVersion !== versions.schemaVersion ||
      tuple.taxonomyVersion !== versions.taxonomyVersion ||
      tuple.draftValidatorVersion !== versions.validatorVersion
    ) {
      failures.push(
        failure(
          "quality_gate_tuple_harness_mismatch",
          "$.externalGates.frozenQualityReport.report.evaluatedTuple",
          "The selected quality-gate tuple must match the embedded harness versions.",
        ),
      );
    }
  }
  if (report.failures.length > 0 || report.blockers.length > 0) {
    failures.push(
      failure(
        "quality_gate_failures_present",
        "$.externalGates.frozenQualityReport.report.failures",
        "A passing quality-gate report cannot retain failures or blockers.",
      ),
    );
  }

  const { evaluationFingerprint, ...reportBody } = report;
  if (hashChannelLaunchValue(reportBody) !== evaluationFingerprint) {
    failures.push(
      failure(
        "quality_gate_report_fingerprint_mismatch",
        "$.externalGates.frozenQualityReport.report.evaluationFingerprint",
        "The quality-gate report fingerprint does not match its immutable contents.",
      ),
    );
  }
}

function validateChecklists(
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  for (const id of CHANNEL_LAUNCH_END_TO_END_EVIDENCE_IDS) {
    validateEvidence(
      packet.endToEnd[id],
      `$.endToEnd.${id}`,
      packet,
      failures,
    );
  }
  for (const id of CHANNEL_LAUNCH_ACCESSIBILITY_EVIDENCE_IDS) {
    validateEvidence(
      packet.accessibility[id],
      `$.accessibility.${id}`,
      packet,
      failures,
    );
  }
  for (const id of CHANNEL_LAUNCH_QUOTA_LOAD_EVIDENCE_IDS) {
    validateEvidence(
      packet.quotaLoad[id],
      `$.quotaLoad.${id}`,
      packet,
      failures,
    );
  }
  for (const id of CHANNEL_LAUNCH_RETENTION_DELETION_EVIDENCE_IDS) {
    validateEvidence(
      packet.retentionDeletion[id],
      `$.retentionDeletion.${id}`,
      packet,
      failures,
    );
  }
}

function validateProductionConfiguration(
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  const configuration = packet.productionConfiguration;
  validateEvidence(
    configuration.evidence,
    "$.productionConfiguration.evidence",
    packet,
    failures,
  );
  for (const [id, state] of Object.entries(configuration.runtimeControls)) {
    if (state !== "absent") {
      failures.push(
        failure(
          state === "present"
            ? "production_control_present"
            : "production_control_unverified",
          `$.productionConfiguration.runtimeControls.${id}`,
          `The production configuration must prove that ${id} is absent; Channel has no runtime release control for this gate.`,
        ),
      );
    }
  }
}

function validateEvidence(
  evidence: ChannelLaunchEvidence,
  path: string,
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  if (evidence.status === "not_available") {
    failures.push(
      failure(
        "evidence_not_available",
        path,
        evidence.failureReason ?? "Required launch evidence is unavailable.",
      ),
    );
    return;
  }
  if (evidence.status === "failed") {
    failures.push(
      failure(
        "evidence_failed",
        path,
        evidence.failureReason ?? "Required launch evidence failed verification.",
      ),
    );
    return;
  }
  if (
    packet.sourceRevision !== null &&
    evidence.sourceRevision !== packet.sourceRevision
  ) {
    failures.push(
      failure(
        "evidence_source_mismatch",
        `${path}.sourceRevision`,
        "Every passing launch artifact must be verified against the packet source revision.",
      ),
    );
  }
}

function validatePacketDecision(
  packet: ChannelLaunchPacket,
  failures: ChannelLaunchPacketFailure[],
): void {
  const expectedDecision = failures.length === 0 ? "passed" : "blocked";
  if (packet.decision !== expectedDecision) {
    failures.push(
      failure(
        "packet_decision_mismatch",
        "$.decision",
        `The packet decision must be ${expectedDecision} when all required evidence is evaluated.`,
      ),
    );
  }
  const expectedEligibility = expectedDecision === "passed";
  if (packet.releaseReviewEligible !== expectedEligibility) {
    failures.push(
      failure(
        "packet_eligibility_mismatch",
        "$.releaseReviewEligible",
        "Release-review eligibility is derived from the complete evidence result and cannot be asserted independently.",
      ),
    );
  }
}

function evaluation(
  packet: ChannelLaunchPacket | null,
  failures: readonly ChannelLaunchPacketFailure[],
): ChannelLaunchPacketEvaluation {
  const blocked = failures.length > 0;
  return deepFreeze({
    status: blocked ? ("blocked" as const) : ("passed" as const),
    decision: blocked ? ("blocked" as const) : ("passed" as const),
    releaseReviewEligible: !blocked,
    packet,
    failures: [...failures],
  });
}

function failure(
  code: string,
  path: string,
  detail: string,
): ChannelLaunchPacketFailure {
  return { code, path, detail };
}

export const CHANNEL_LAUNCH_PACKET_DEFAULT_REASON =
  "Issue #492 has no verified production evidence.";
