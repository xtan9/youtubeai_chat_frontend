import { describe, expect, it } from "vitest";

import manifestSummary from "../../../test-fixtures/channel-evaluation-corpus/traditional-chinese-blind.manifest.json";
import { TRADITIONAL_CHINESE_BLIND_MANIFEST } from "../../../test-fixtures/channel-evaluation-corpus/traditional-chinese-blind.manifest";
import {
  PROTECTED_GROUP_CROSS_CUTS,
  TRADITIONAL_CHINESE_BLIND_CORPUS_MINIMUMS,
  createTraditionalChineseBlindEvaluationCorpus,
  hashChannelEvaluationCorpusManifest,
  recordChannelEvaluationCorpusApproval,
  recordChannelEvaluationCorpusFreeze,
  validateChannelEvaluationCorpus,
  validateChannelEvaluationCorpusForTuning,
  verifyChannelEvaluationCorpusManifest,
} from "../traditional-chinese-evaluation-corpus-governance";

describe("Traditional Chinese blind evaluation corpus governance", () => {
  it("materializes the required inventory without treating it as approved evidence", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();
    const report = validateChannelEvaluationCorpus(corpus);

    expect(report.valid).toBe(true);
    expect(report.releaseReady).toBe(false);
    expect(report.coverage).toMatchObject({
      totalItems: TRADITIONAL_CHINESE_BLIND_CORPUS_MINIMUMS.totalItems,
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
    expect(
      PROTECTED_GROUP_CROSS_CUTS.every(
        (crossCut) =>
          report.coverage.protectedGroupCounts[crossCut] >=
          TRADITIONAL_CHINESE_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      ),
    ).toBe(true);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "reviewer_provenance_incomplete",
        "approval_not_recorded",
        "freeze_not_recorded",
        "upstream_harness_incomplete",
      ]),
    );
  });

  it("keeps every item traceable to synthetic data and rejects YouTube API origins", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();

    expect(corpus.items).toHaveLength(1_250);
    expect(verifyChannelEvaluationCorpusManifest(corpus)).toBe(true);
    expect(Object.isFrozen(corpus)).toBe(true);
    expect(Object.isFrozen(corpus.items)).toBe(true);
    expect(Object.isFrozen(corpus.items[0])).toBe(true);
    expect(
      corpus.items.every(
        (item) =>
          item.origin.kind === "synthetic_authored" &&
          item.rights.status === "synthetic_no_third_party_rights" &&
          item.deIdentification.status === "not_applicable_synthetic" &&
          item.policyVersion.length > 0 &&
          item.reviewerProvenance.protocol ===
            "two_independent_reviewers_third_resolves_disagreements",
      ),
    ).toBe(true);

    const apiItem = {
      ...corpus.items[0]!,
      origin: {
        kind: "youtube_api_comment" as const,
        reference: "provider-comment-id",
      },
    };
    const validation = validateChannelEvaluationCorpus({
      ...corpus,
      items: [apiItem, ...corpus.items.slice(1)],
    });

    expect(validation.valid).toBe(false);
    expect(validation.blockers).toContain("youtube_api_comments_prohibited");
    expect(verifyChannelEvaluationCorpusManifest({ ...corpus, items: [apiItem, ...corpus.items.slice(1)] })).toBe(false);
  });

  it("records approval and freeze as explicit missing evidence and rejects tuning use", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();

    expect(corpus).toMatchObject({
      state: "open",
      approvalEvidence: { status: "not_recorded" },
      freezeEvidence: { status: "not_recorded" },
      finalTupleEvaluation: { status: "not_started" },
      tuning: {
        allowed: false,
        reason: "blind_corpus_is_never_available_for_tuning",
      },
    });

    const validation = validateChannelEvaluationCorpusForTuning(corpus);

    expect(validation.valid).toBe(false);
    expect(validation.releaseReady).toBe(false);
    expect(validation.blockers).toContain("blind_corpus_not_tunable");
  });

  it("does not accept upstream harness completion without an evidence reference", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();
    const unsubstantiatedCompletion = {
      ...corpus,
      upstreamHarness: {
        blockedByIssue: 482 as const,
        status: "complete" as const,
        evidenceReference: null,
      },
    };
    const manifest = {
      ...unsubstantiatedCompletion,
      manifestHash: hashChannelEvaluationCorpusManifest(
        unsubstantiatedCompletion,
      ),
    };

    const validation = validateChannelEvaluationCorpus(manifest);

    expect(validation.valid).toBe(true);
    expect(validation.releaseReady).toBe(false);
    expect(validation.blockers).toContain("upstream_harness_incomplete");
  });

  it("fingerprints each input and the manifest so blind contents cannot drift silently", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();
    const firstItem = corpus.items[0]!;
    const tampered = {
      ...corpus,
      items: [
        {
          ...firstItem,
          input: {
            ...firstItem.input,
            commentText: "變更後的輸入不得沿用原始指紋。",
          },
        },
        ...corpus.items.slice(1),
      ],
    };

    const validation = validateChannelEvaluationCorpus(tampered);

    expect(validation.valid).toBe(false);
    expect(validation.blockers).toEqual(
      expect.arrayContaining(["input_hash_mismatch", "manifest_hash_mismatch"]),
    );
  });

  it("does not let the repository scaffold self-approve or freeze without human review evidence", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();
    const evidence = {
      reference: "review-ledger-entry",
      recordedBy: "reviewer-1",
      recordedAt: "2026-09-01T12:00:00.000Z",
    };

    expect(() =>
      recordChannelEvaluationCorpusApproval(corpus, evidence),
    ).toThrow(/reviewer provenance/iu);
    expect(() => recordChannelEvaluationCorpusFreeze(corpus, evidence)).toThrow(
      /approval evidence/iu,
    );
  });

  it("accepts the three-reviewer protocol only when every item carries independent labels and adjudication", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();
    const reviewed = {
      ...corpus,
      reviewerRegistry: {
        protocol:
          "two_independent_reviewers_third_resolves_disagreements" as const,
        primaryReviewerId: "reviewer-primary",
        secondaryReviewerId: "reviewer-secondary",
        adjudicatorId: "reviewer-adjudicator",
      },
      items: corpus.items.map((item) => {
        const label = item.expectedCategory ?? item.validatorCategory!;
        return {
          ...item,
          reviewerProvenance: {
            protocol:
              "two_independent_reviewers_third_resolves_disagreements" as const,
            status: "complete" as const,
            primary: {
              reviewerId: "reviewer-primary",
              label,
              labeledAt: "2026-09-01T12:00:00.000Z",
            },
            secondary: {
              reviewerId: "reviewer-secondary",
              label,
              labeledAt: "2026-09-01T12:01:00.000Z",
            },
            adjudicator: {
              reviewerId: "reviewer-adjudicator",
              label,
              labeledAt: "2026-09-01T12:02:00.000Z",
            },
          },
        };
      }),
    };
    const reviewedWithHash = {
      ...reviewed,
      manifestHash: hashChannelEvaluationCorpusManifest(reviewed),
    };
    const reviewedReport = validateChannelEvaluationCorpus(reviewedWithHash);

    expect(reviewedReport.valid).toBe(true);
    expect(reviewedReport.coverage.traceability.reviewerProvenanceComplete).toBe(
      1_250,
    );
    expect(reviewedReport.blockers).toEqual(
      expect.arrayContaining([
        "approval_not_recorded",
        "freeze_not_recorded",
        "upstream_harness_incomplete",
        "final_tuple_evaluation_missing",
      ]),
    );
    expect(reviewedReport.blockers).not.toContain(
      "reviewer_provenance_incomplete",
    );

    const approved = recordChannelEvaluationCorpusApproval(reviewedWithHash, {
      reference: "review-ledger-entry",
      recordedBy: "reviewer-adjudicator",
      recordedAt: "2026-09-01T12:03:00.000Z",
    });
    const frozen = recordChannelEvaluationCorpusFreeze(approved, {
      reference: "freeze-ledger-entry",
      recordedBy: "reviewer-adjudicator",
      recordedAt: "2026-09-01T12:04:00.000Z",
    });

    expect(frozen.state).toBe("frozen");
    expect(frozen.approvalEvidence.status).toBe("recorded");
    expect(frozen.freezeEvidence.status).toBe("recorded");
    expect(frozen.manifestHash).toBe(reviewedWithHash.manifestHash);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(validateChannelEvaluationCorpusForTuning(frozen).blockers).toContain(
      "blind_corpus_not_tunable",
    );

    const tupleBeforeFreeze = {
      ...frozen,
      finalTupleEvaluation: {
        status: "complete" as const,
        evaluatedAt: "2026-09-01T12:03:30.000Z",
        manifestHash: frozen.manifestHash,
      },
    };
    expect(
      validateChannelEvaluationCorpus(tupleBeforeFreeze).blockers,
    ).toContain("freeze_precedes_final_tuple_required");
  });

  it("keeps the checked-in manifest summary aligned with the materialized manifest", () => {
    const report = validateChannelEvaluationCorpus(
      TRADITIONAL_CHINESE_BLIND_MANIFEST,
    );

    expect(manifestSummary).toMatchObject({
      manifestVersion: TRADITIONAL_CHINESE_BLIND_MANIFEST.manifestVersion,
      corpusVersion: TRADITIONAL_CHINESE_BLIND_MANIFEST.corpusVersion,
      language: TRADITIONAL_CHINESE_BLIND_MANIFEST.language,
      split: TRADITIONAL_CHINESE_BLIND_MANIFEST.split,
      state: TRADITIONAL_CHINESE_BLIND_MANIFEST.state,
      policyVersion: TRADITIONAL_CHINESE_BLIND_MANIFEST.policyVersion,
      dataPolicy: TRADITIONAL_CHINESE_BLIND_MANIFEST.dataPolicy,
      inventory: {
        manifestItemCount: report.coverage.manifestItemCount,
        blindItemCount: report.coverage.totalItems,
        baseCategoryCounts: report.coverage.baseCategoryCounts,
        adversarialCount: report.coverage.adversarialCount,
        zeroToleranceValidatorCount:
          report.coverage.zeroToleranceValidatorCount,
      },
      traceableCrossCutCounts: {
        ...report.coverage.protectedGroupCounts,
        minor_safety: report.coverage.minorSafetyCount,
      },
      reviewProtocol: {
        protocol: TRADITIONAL_CHINESE_BLIND_MANIFEST.reviewProtocol,
        status: "not_recorded",
      },
      approvalEvidence: { status: "not_recorded", reference: null },
      freezeEvidence: { status: "not_recorded", reference: null },
      finalTupleEvaluation: "not_started",
      upstreamHarness: { blockedByIssue: 482, status: "blocked" },
      tuning: {
        allowed: false,
        reason: "blind_corpus_is_never_available_for_tuning",
      },
    });
  });

  it("fails closed when a required bucket is short or completed review data is fake", () => {
    const corpus = createTraditionalChineseBlindEvaluationCorpus();
    const underfilled = {
      ...corpus,
      items: corpus.items.slice(1),
    };
    const underfilledWithHash = {
      ...underfilled,
      manifestHash: hashChannelEvaluationCorpusManifest(underfilled),
    };

    const underfilledReport = validateChannelEvaluationCorpus(
      underfilledWithHash,
    );
    expect(underfilledReport.valid).toBe(false);
    expect(underfilledReport.blockers).toContain("minimum_sample_count");

    const fakeReview = {
      ...corpus,
      items: [
        {
          ...corpus.items[0]!,
          reviewerProvenance: {
            protocol:
              "two_independent_reviewers_third_resolves_disagreements" as const,
            status: "complete" as const,
            primary: { reviewerId: null, label: null, labeledAt: null },
            secondary: { reviewerId: null, label: null, labeledAt: null },
            adjudicator: { reviewerId: null, label: null, labeledAt: null },
          },
        },
        ...corpus.items.slice(1),
      ],
    };
    const fakeReviewReport = validateChannelEvaluationCorpus(fakeReview);

    expect(fakeReviewReport.valid).toBe(false);
    expect(fakeReviewReport.blockers).toContain("malformed_manifest");
  });
});
