import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CHINESE_ENGLISH_CODE_SWITCH_BLIND_CORPUS_MINIMUMS,
  PROTECTED_GROUP_CROSS_CUTS,
  assertApprovedFrozenChineseEnglishCodeSwitchCorpus,
  ChineseEnglishCodeSwitchBlindCorpusApprovalEvidenceSchema,
  ChineseEnglishCodeSwitchBlindCorpusManifestDescriptorSchema,
  chineseEnglishCodeSwitchCorpusFingerprint,
  createChineseEnglishCodeSwitchBlindEvaluationCorpus,
  recordChineseEnglishCodeSwitchCorpusApproval,
  recordChineseEnglishCodeSwitchCorpusFreeze,
  inspectChineseEnglishCodeSwitchText,
  summarizeChineseEnglishCodeSwitchCorpus,
  validateChineseEnglishCodeSwitchBlindEvaluationCorpus,
  toChannelQualityBlindCorpusManifest,
} from "../code-switch-blind-corpus-governance";
import {
  validateChannelQualityCorpus,
  verifyChannelQualityCorpusFingerprint,
} from "../../channel-quality-evaluation";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");

describe("Chinese-English code-switch blind corpus governance", () => {
  it("materializes a deterministic bilingual slice with the required coverage", () => {
    const first = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
    const second = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
    const report = validateChineseEnglishCodeSwitchBlindEvaluationCorpus(first);

    expect(first).toEqual(second);
    expect(report.valid).toBe(true);
    expect(report.coverage).toMatchObject({
      manifestItemCount:
        CHINESE_ENGLISH_CODE_SWITCH_BLIND_CORPUS_MINIMUMS.totalItems +
        CHINESE_ENGLISH_CODE_SWITCH_BLIND_CORPUS_MINIMUMS.zeroToleranceValidatorItems,
      totalItems: CHINESE_ENGLISH_CODE_SWITCH_BLIND_CORPUS_MINIMUMS.totalItems,
      classificationItemCount: 950,
      codeSwitchEligibleCount: 1_250,
      categoryCounts: {
        "Allowed Criticism": 300,
        "Actionable Abuse": 250,
        "Reviewable Interaction": 200,
        "Safety Flag": 250,
      },
      baseCategoryCounts: {
        "Allowed Criticism": 300,
        "Actionable Abuse": 250,
        "Reviewable Interaction": 200,
        "Safety Flag": 200,
      },
      adversarialCount: 50,
      zeroToleranceValidatorCount: 250,
      minorSafetyCount: 200,
    });
    expect(first.items).toHaveLength(1_250);
    expect(
      first.items.every((item) => item.language === "chinese_english_code_switch"),
    ).toBe(true);
    expect(
      first.items.every(
        (item) =>
          item.codeSwitchEvidence.englishClause.length > 0 &&
          item.codeSwitchEvidence.chineseClause.length > 0,
      ),
    ).toBe(true);
    expect(summarizeChineseEnglishCodeSwitchCorpus(first)).toEqual(
      report.coverage,
    );
    expect(
      PROTECTED_GROUP_CROSS_CUTS.every(
        (crossCut) =>
          report.coverage.protectedGroupCounts[crossCut] >=
          CHINESE_ENGLISH_CODE_SWITCH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      ),
    ).toBe(true);
  });

  it("requires independent meaningful clauses instead of script-only evidence", () => {
    expect(
      inspectChineseEnglishCodeSwitchText("YouTube API. 北京大学。"),
    ).toMatchObject({
      eligible: false,
      failures: ["english_clause_missing", "chinese_clause_missing"],
    });
    expect(
      inspectChineseEnglishCodeSwitchText(
        "The explanation needs more detail. 这个解释需要更多细节。",
      ),
    ).toMatchObject({
      eligible: true,
      englishClause: "The explanation needs more detail",
      chineseClause: "这个解释需要更多细节",
    });

    const corpus = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
    const invalid = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          text: "YouTube API. 北京大学。",
        },
        ...corpus.items.slice(1),
      ],
    };
    const report = validateChineseEnglishCodeSwitchBlindEvaluationCorpus(
      invalid,
    );

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "code_switch_ineligible",
    );
  });

  it("keeps origin, rights, and de-identification evidence fail-closed", () => {
    const corpus = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
    expect(
      corpus.items.every(
        (item) =>
          item.origin.kind === "authored_synthetic" &&
          item.origin.reference.startsWith("synthetic://") &&
          item.rights.basis === "original_synthetic" &&
          item.rights.status === "not_applicable_synthetic" &&
          item.rights.consentReference === null &&
          item.rights.licenseReference === null &&
          item.deidentification.status === "not_applicable_synthetic" &&
          item.deidentification.evidenceReference === null,
      ),
    ).toBe(true);

    const creatorExample = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          origin: {
            ...corpus.items[0].origin,
            kind: "creator_example" as const,
            reference: "evidence://creator-example/pending",
          },
        },
        ...corpus.items.slice(1),
      ],
    };
    const report = validateChineseEnglishCodeSwitchBlindEvaluationCorpus(
      creatorExample,
    );

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "creator_rights_not_separately_evidenced",
        "creator_deidentification_not_evidenced",
      ]),
    );

    const youtubeReference = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          origin: {
            ...corpus.items[0].origin,
            reference: "https://youtube.com/comments/pending",
          },
        },
        ...corpus.items.slice(1),
      ],
    };
    const youtubeReport = validateChineseEnglishCodeSwitchBlindEvaluationCorpus(
      youtubeReference,
    );
    expect(youtubeReport.issues.map((issue) => issue.code)).toContain(
      "youtube_api_comment_origin_forbidden",
    );
  });

  it("requires two independent labels and a third reviewer for disagreement", () => {
    const corpus = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
    const reviewed = {
      ...corpus,
      items: corpus.items.map((item) => {
        const label =
          item.kind === "validator" ? item.zeroToleranceValidator! : item.category!;
        return {
          ...item,
          reviewerProvenance: {
            status: "complete" as const,
            independentLabels: [
              {
                reviewerId: "reviewer-a",
                label,
                labeledAt: "2026-09-01T12:00:00.000Z",
              },
              {
                reviewerId: "reviewer-b",
                label,
                labeledAt: "2026-09-01T12:01:00.000Z",
              },
            ],
            adjudication: null,
            finalLabel: label,
          },
        };
      }),
    };
    const reviewedWithCoverage = {
      ...reviewed,
      declaredCoverage: summarizeChineseEnglishCodeSwitchCorpus(reviewed),
    };
    const disagreement = {
      ...reviewedWithCoverage,
      items: [
        {
          ...reviewed.items[0],
          reviewerProvenance: {
            ...reviewed.items[0].reviewerProvenance,
            independentLabels: [
              {
                reviewerId: "reviewer-a",
                label: "Allowed Criticism" as const,
                labeledAt: "2026-09-01T12:00:00.000Z",
              },
              {
                reviewerId: "reviewer-b",
                label: "Actionable Abuse" as const,
                labeledAt: "2026-09-01T12:01:00.000Z",
              },
            ],
            finalLabel: "Allowed Criticism" as const,
          },
        },
        ...reviewed.items.slice(1),
      ],
    };

    const missingAdjudicator =
      validateChineseEnglishCodeSwitchBlindEvaluationCorpus(disagreement);
    expect(missingAdjudicator.issues.map((issue) => issue.code)).toContain(
      "adjudication_missing",
    );

    const resolved = {
      ...disagreement,
      items: [
        {
          ...disagreement.items[0],
          reviewerProvenance: {
            ...disagreement.items[0].reviewerProvenance,
            adjudication: {
              reviewerId: "reviewer-c",
              label: "Allowed Criticism" as const,
              labeledAt: "2026-09-01T12:02:00.000Z",
            },
          },
        },
        ...disagreement.items.slice(1),
      ],
    };
    const resolvedReport =
      validateChineseEnglishCodeSwitchBlindEvaluationCorpus(resolved);
    expect(resolvedReport.valid).toBe(true);
    expect(resolvedReport.blockers).not.toContain(
      "reviewer_provenance_incomplete",
    );

    const approved = recordChineseEnglishCodeSwitchCorpusApproval(resolved, {
      approvedBy: "named-human-approver",
      approvedAt: "2026-09-01T13:00:00.000Z",
      evidenceReference: "evidence://channel-486/approval",
    });
    expect(approved.status).toBe("approved");
    expect(approved.approval.status).toBe("recorded");

    const frozen = recordChineseEnglishCodeSwitchCorpusFreeze(approved, {
      frozenBy: "named-human-freeze-owner",
      frozenAt: "2026-09-01T14:00:00.000Z",
      evidenceReference: "evidence://channel-486/freeze",
    });
    expect(frozen.status).toBe("frozen");
    expect(frozen.freeze.status).toBe("recorded");
    expect(
      validateChineseEnglishCodeSwitchBlindEvaluationCorpus(frozen).blockers,
    ).not.toContain("approval_not_recorded");
    expect(
      validateChineseEnglishCodeSwitchBlindEvaluationCorpus(frozen).blockers,
    ).not.toContain("freeze_not_recorded");

    const releaseReady = {
      ...frozen,
      upstreamHarness: {
        issueNumber: 482 as const,
        status: "available" as const,
        sourceRevision: "a".repeat(40),
        evidenceReference: "evidence://channel-482/harness",
      },
    };
    const projected = toChannelQualityBlindCorpusManifest(releaseReady);
    const projectionReport = validateChannelQualityCorpus(projected, {
      expectedSplit: "blind",
      requireReleaseMinimums: false,
    });
    expect(projectionReport.ok).toBe(true);
    expect(verifyChannelQualityCorpusFingerprint(projected)).toBe(true);
    expect(projected.items).toHaveLength(1_250);
    expect(projected.items.every((item) => item.codeSwitchEvidence !== null)).toBe(
      true,
    );
  });

  it("does not expose a pending inventory as an approved frozen corpus", () => {
    const corpus = createChineseEnglishCodeSwitchBlindEvaluationCorpus();
    const fingerprint = chineseEnglishCodeSwitchCorpusFingerprint(corpus);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => assertApprovedFrozenChineseEnglishCodeSwitchCorpus(corpus)).toThrow(
      /not approved and frozen/u,
    );
    expect(() => toChannelQualityBlindCorpusManifest(corpus)).toThrow(
      /not approved and frozen/u,
    );
  });

  it("keeps the checked-in manifest and pending evidence machine-valid", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/channel-evaluation/chinese-english-code-switch-blind-corpus-manifest.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const evidence = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/compliance/channel-chinese-english-code-switch-blind-corpus-approval.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const parsedManifest =
      ChineseEnglishCodeSwitchBlindCorpusManifestDescriptorSchema.safeParse(
        manifest,
      );
    const parsedEvidence =
      ChineseEnglishCodeSwitchBlindCorpusApprovalEvidenceSchema.safeParse(
        evidence,
      );
    const report = validateChineseEnglishCodeSwitchBlindEvaluationCorpus(
      createChineseEnglishCodeSwitchBlindEvaluationCorpus(),
    );

    expect(parsedManifest.success).toBe(true);
    expect(parsedEvidence.success).toBe(true);
    if (!parsedManifest.success || !parsedEvidence.success) return;
    expect(parsedManifest.data.declaredCoverage).toEqual(report.coverage);
    expect(parsedEvidence.data.approval.status).toBe("not_recorded");
    expect(parsedEvidence.data.freeze.status).toBe("not_recorded");
    expect(parsedEvidence.data.finalTupleEvaluation.status).toBe("blocked");
    expect(parsedEvidence.data.originPolicy.creatorExamplesIncluded).toBe(0);
  });
});
