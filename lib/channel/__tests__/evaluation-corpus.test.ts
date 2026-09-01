import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ENGLISH_BLIND_CORPUS_MINIMUMS,
  PROTECTED_GROUP_CROSS_CUTS,
  ChannelEnglishBlindCorpusApprovalEvidenceSchema,
  ChannelEnglishBlindCorpusManifestDescriptorSchema,
  assertApprovedFrozenChannelEvaluationCorpus,
  channelEvaluationCorpusFingerprint,
  createEnglishBlindEvaluationCorpus,
  summarizeChannelEvaluationCorpus,
  validateChannelEvaluationCorpus,
} from "../evaluation-corpus-governance";

const REPOSITORY_ROOT = path.resolve(__dirname, "../../..");

const REVIEWED_AT = "2026-09-01T12:00:00.000Z";

function withConsensusReviews(
  corpus: ReturnType<typeof createEnglishBlindEvaluationCorpus>,
) {
  const items = corpus.items.map((item) => ({
    ...item,
    reviewerProvenance: {
      status: "complete" as const,
      independentLabels: [
        { reviewerId: "reviewer-a", label: item.category, labeledAt: REVIEWED_AT },
        { reviewerId: "reviewer-b", label: item.category, labeledAt: REVIEWED_AT },
      ],
      adjudication: null,
      finalLabel: item.category,
    },
  }));
  return {
    ...corpus,
    items,
    declaredCoverage: summarizeChannelEvaluationCorpus({ items }),
  };
}

function withRecordedApprovalAndFreeze(
  corpus: ReturnType<typeof withConsensusReviews>,
) {
  const corpusFingerprint = channelEvaluationCorpusFingerprint(corpus);
  return {
    ...corpus,
    status: "frozen" as const,
    approval: {
      status: "recorded" as const,
      corpusFingerprint,
      approvedAt: "2026-09-01T13:00:00.000Z",
      approvedBy: "named-human-approver",
      evidenceReference: "evidence://channel-483/approval",
    },
    freeze: {
      status: "recorded" as const,
      corpusFingerprint,
      frozenAt: "2026-09-01T14:00:00.000Z",
      frozenBy: "named-human-freeze-owner",
      evidenceReference: "evidence://channel-483/freeze",
    },
    finalTupleEvaluation: {
      status: "available" as const,
      startedAt: "2026-09-01T15:00:00.000Z",
      tupleFingerprint: null,
    },
    upstreamHarness: {
      issueNumber: 482 as const,
      status: "available" as const,
      sourceRevision: "b".repeat(40),
      evidenceReference: "evidence://channel-483/harness",
    },
  };
}

describe("English blind evaluation corpus governance", () => {
  it("materializes the required inventory without treating it as approved evidence", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const report = validateChannelEvaluationCorpus(corpus);

    expect(report.valid).toBe(true);
    expect(report.releaseReady).toBe(false);
    expect(report.coverage).toMatchObject({
      totalItems: ENGLISH_BLIND_CORPUS_MINIMUMS.totalItems,
      categoryCounts: {
        "Allowed Criticism": 300,
        "Actionable Abuse": 250,
        "Reviewable Interaction": 200,
        "Safety Flag": 250,
      },
      adversarialCount: 50,
      zeroToleranceValidatorCount: 250,
      minorSafetyCount: 200,
    });
    expect(
      PROTECTED_GROUP_CROSS_CUTS.every(
        (crossCut) =>
          report.coverage.protectedGroupCounts[crossCut] >=
          ENGLISH_BLIND_CORPUS_MINIMUMS.protectedGroupCrossCutItems,
      ),
    ).toBe(true);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "reviewer_provenance_incomplete",
        "approval_not_recorded",
        "freeze_not_recorded",
      ]),
    );
  });

  it("requires item-level provenance and rejects YouTube API comment origins", () => {
    const corpus = createEnglishBlindEvaluationCorpus();

    expect(
      corpus.items.every(
        (item) =>
          item.origin.reference.startsWith("synthetic://") &&
          item.rights.basis === "original_synthetic" &&
          item.deidentification.status === "not_applicable_synthetic" &&
          item.policyVersion === corpus.policyVersion &&
          item.reviewerProvenance.status === "pending",
      ),
    ).toBe(true);

    const apiOriginCorpus = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          origin: {
            ...corpus.items[0].origin,
            kind: "youtube_api_comment",
          },
        },
        ...corpus.items.slice(1),
      ],
    };
    const report = validateChannelEvaluationCorpus(apiOriginCorpus);

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "youtube_api_comment_origin_forbidden",
    );
  });

  it("requires separate consent, license, and de-identification evidence for Creator examples", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const creatorExampleCorpus = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          origin: {
            ...corpus.items[0].origin,
            kind: "creator_example",
            reference: "evidence://creator-example/pending",
          },
        },
        ...corpus.items.slice(1),
      ],
    };

    const report = validateChannelEvaluationCorpus(creatorExampleCorpus);

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "creator_rights_not_separately_evidenced",
        "creator_deidentification_not_evidenced",
      ]),
    );
  });

  it("requires two independent labels and a distinct third reviewer for disagreements", () => {
    const corpus = withConsensusReviews(createEnglishBlindEvaluationCorpus());
    const disagreement = {
      ...corpus.items[0].reviewerProvenance,
      independentLabels: [
        {
          reviewerId: "reviewer-a",
          label: "Allowed Criticism" as const,
          labeledAt: REVIEWED_AT,
        },
        {
          reviewerId: "reviewer-b",
          label: "Actionable Abuse" as const,
          labeledAt: REVIEWED_AT,
        },
      ],
      finalLabel: "Allowed Criticism" as const,
    };
    const withoutAdjudication = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          reviewerProvenance: disagreement,
        },
        ...corpus.items.slice(1),
      ],
    };
    const missingAdjudicatorReport = validateChannelEvaluationCorpus(
      withoutAdjudication,
    );
    expect(missingAdjudicatorReport.issues.map((issue) => issue.code)).toContain(
      "adjudication_missing",
    );

    const resolved = {
      ...withoutAdjudication,
      items: [
        {
          ...withoutAdjudication.items[0],
          reviewerProvenance: {
            ...disagreement,
            adjudication: {
              reviewerId: "reviewer-c",
              label: "Allowed Criticism" as const,
              labeledAt: REVIEWED_AT,
            },
          },
        },
        ...withoutAdjudication.items.slice(1),
      ],
    };
    const resolvedReport = validateChannelEvaluationCorpus(resolved);

    expect(resolvedReport.valid).toBe(true);
    expect(resolvedReport.blockers).not.toContain(
      "reviewer_provenance_incomplete",
    );
  });

  it("only releases a corpus after explicit approval, freeze, and harness evidence", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const readyReport = validateChannelEvaluationCorpus(readyCorpus);

    expect(readyReport.valid).toBe(true);
    expect(readyReport.releaseReady).toBe(true);
    expect(readyReport.blockers).toEqual([]);

    const evaluatedBeforeFreeze = {
      ...readyCorpus,
      finalTupleEvaluation: {
        ...readyCorpus.finalTupleEvaluation,
        startedAt: "2026-09-01T13:30:00.000Z",
      },
    };
    const orderingReport = validateChannelEvaluationCorpus(
      evaluatedBeforeFreeze,
    );

    expect(orderingReport.valid).toBe(false);
    expect(orderingReport.issues.map((issue) => issue.code)).toContain(
      "tuple_evaluation_started_before_freeze",
    );
  });

  it("cannot be enabled for tuning", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const report = validateChannelEvaluationCorpus({
      ...corpus,
      tuning: {
        allowed: true,
        prohibition: "not actually prohibited",
      },
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("schema_invalid");
  });

  it("keeps multilingual synthetic authoring and minor-safety labels explicit", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const firstItem = corpus.items[0];
    const invalidCorpus = {
      ...corpus,
      items: [
        {
          ...firstItem,
          origin: {
            ...firstItem.origin,
            authoringLanguages: ["en" as const],
          },
          minorSafety: true,
        },
        ...corpus.items.slice(1),
      ],
    };

    const report = validateChannelEvaluationCorpus(invalidCorpus);

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "synthetic_authoring_not_multilingual",
        "minor_safety_not_safety_flag",
      ]),
    );
  });

  it("exposes a fail-closed assertion for final tuple consumers", () => {
    expect(() =>
      assertApprovedFrozenChannelEvaluationCorpus(
        createEnglishBlindEvaluationCorpus(),
      ),
    ).toThrow(/not approved and frozen/);

    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    expect(assertApprovedFrozenChannelEvaluationCorpus(readyCorpus)).toEqual(
      readyCorpus,
    );
  });

  it("keeps the checked-in manifest and pending evidence machine-valid", () => {
    const manifest = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/channel-evaluation/english-blind-corpus-manifest.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const evidence = JSON.parse(
      readFileSync(
        path.join(
          REPOSITORY_ROOT,
          "docs/compliance/channel-english-blind-corpus-approval.json",
        ),
        "utf8",
      ),
    ) as unknown;
    const parsedManifest =
      ChannelEnglishBlindCorpusManifestDescriptorSchema.safeParse(manifest);
    const parsedEvidence =
      ChannelEnglishBlindCorpusApprovalEvidenceSchema.safeParse(evidence);
    const report = validateChannelEvaluationCorpus(
      createEnglishBlindEvaluationCorpus(),
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

  it("binds approval and freeze evidence to the exact corpus contents", () => {
    const corpus = createEnglishBlindEvaluationCorpus();
    const fingerprint = channelEvaluationCorpusFingerprint(corpus);
    const changedCorpus = {
      ...corpus,
      items: [
        {
          ...corpus.items[0],
          text: `${corpus.items[0].text} changed`,
        },
        ...corpus.items.slice(1),
      ],
    };

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(channelEvaluationCorpusFingerprint(corpus)).toBe(fingerprint);
    expect(channelEvaluationCorpusFingerprint(changedCorpus)).not.toBe(
      fingerprint,
    );
  });

  it("does not accept machine-like approval identities", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const report = validateChannelEvaluationCorpus({
      ...readyCorpus,
      approval: {
        ...readyCorpus.approval,
        approvedBy: "approval-bot",
      },
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "automated_approval_forbidden",
    );
  });

  it("does not accept machine-like item reviewers", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const report = validateChannelEvaluationCorpus({
      ...readyCorpus,
      items: [
        {
          ...readyCorpus.items[0],
          reviewerProvenance: {
            ...readyCorpus.items[0].reviewerProvenance,
            independentLabels: [
              {
                reviewerId: "reviewer-bot",
                label: readyCorpus.items[0].category,
                labeledAt: REVIEWED_AT,
              },
              readyCorpus.items[0].reviewerProvenance.independentLabels[1],
            ],
          },
        },
        ...readyCorpus.items.slice(1),
      ],
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "automated_reviewer_forbidden",
    );
  });

  it("requires a fingerprint for a completed tuple evaluation", () => {
    const readyCorpus = withRecordedApprovalAndFreeze(
      withConsensusReviews(createEnglishBlindEvaluationCorpus()),
    );
    const report = validateChannelEvaluationCorpus({
      ...readyCorpus,
      finalTupleEvaluation: {
        status: "completed",
        startedAt: "2026-09-01T15:00:00.000Z",
        tupleFingerprint: null,
      },
    });

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain(
      "tuple_fingerprint_missing",
    );
  });
});
